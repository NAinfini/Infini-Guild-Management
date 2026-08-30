import type { ImageGridEditorItem } from "@portal/types/media";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMediaUpload, type UseMediaUploadState } from "../../../hooks/useMediaUpload";
import { notifySuccess } from "../../../utils/notifications";
import { resolveMediaUrl } from "../../../utils/media";
import { requireSiteMediaPolicy, useSiteConfigStore } from "../../../stores/site-config";
import {
  deleteAvatar,
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
  updateOwnProfile,
  uploadAvatar,
  uploadProfileAudio,
  uploadProfileImages,
  type ProfileAudioUploadResult,
  type ProfileImageUploadResult,
} from "../../../services/UserService";
import {
  requireMember,
  stringArraysEqual,
  videoBaselineFor,
  type AdminUserRow,
  type MediaUploadOwner,
  type MemberMediaSnapshot,
  type MemberMutationTarget,
  type ProfileRevisionBaseline,
  type VideoBaseline,
} from "./admin-member-media-state";

type UseAdminMemberMediaControllerParams = {
  member: AdminUserRow | null;
  currentUserId?: string;
  profileRevisionToken?: string | null;
  onProfileRevision?: (memberId: string, profileRevisionToken: string) => void;
  onMediaStateChange?: (state: AdminMemberMediaState) => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown, fallbackMessage: string) => void;
};

export type AdminMemberMediaState = Readonly<{
  memberId: string | null;
  hasPendingChanges: boolean;
  isInFlight: boolean;
  discardPendingChanges: () => void;
}>;

export function useAdminMemberMediaController({
  member: incomingMember,
  currentUserId,
  profileRevisionToken: incomingProfileRevisionToken,
  onProfileRevision,
  onMediaStateChange,
  onRefresh,
  onError,
}: UseAdminMemberMediaControllerParams) {
  const { t } = useTranslation(["admin", "common"]);
  const mediaPolicy = useSiteConfigStore(requireSiteMediaPolicy);
  const profileImageQuota = mediaPolicy.quotas.profile;
  const incomingMemberId = incomingMember?.user.id ?? null;
  const initialSnapshot = useRef<MemberMediaSnapshot>({
    member: incomingMember,
    profileRevisionToken: incomingProfileRevisionToken ?? null,
  }).current;
  const [memberSnapshot, setMemberSnapshot] = useState<MemberMediaSnapshot>(initialSnapshot);
  const memberSnapshotRef = useRef(memberSnapshot);
  memberSnapshotRef.current = memberSnapshot;
  const member = memberSnapshot.member;
  const memberId = member?.user.id ?? null;
  const memberVideoUrls = member?.profile.video_urls ?? [];
  const profileRevisionRef = useRef<ProfileRevisionBaseline>({
    memberId,
    profileRevisionToken: memberSnapshot.profileRevisionToken,
    supersededProfileRevisionTokens: [],
    deferredSnapshot: null,
  });
  const [videoUrls, setVideoUrls] = useState<string[]>(() => [...memberVideoUrls]);
  const [videoBaseline, setVideoBaseline] = useState<VideoBaseline>(() => videoBaselineFor(member));
  const videoBaselineRef = useRef(videoBaseline);
  const videoUrlsRef = useRef(videoUrls);
  videoBaselineRef.current = videoBaseline;
  videoUrlsRef.current = videoUrls;

  const adoptMemberSnapshot = useCallback((nextSnapshot: MemberMediaSnapshot) => {
    const nextBaseline = videoBaselineFor(nextSnapshot.member);
    memberSnapshotRef.current = nextSnapshot;
    videoBaselineRef.current = nextBaseline;
    setMemberSnapshot(nextSnapshot);
    setVideoBaseline(nextBaseline);
    setVideoUrls([...nextBaseline.urls]);
  }, []);

  const requireMemberProfileRevision = useCallback((targetMemberId: string): string => {
    const current = profileRevisionRef.current;
    if (current.memberId !== targetMemberId || !current.profileRevisionToken) {
      throw new Error("Missing profile revision token");
    }
    return current.profileRevisionToken;
  }, []);

  const captureMemberTarget = useCallback((): MemberMutationTarget => {
    const targetMember = requireMember(member);
    return {
      memberId: targetMember.user.id,
      profileRevisionToken: requireMemberProfileRevision(targetMember.user.id),
    };
  }, [member, requireMemberProfileRevision]);

  const rememberProfileRevision = useCallback((targetMemberId: string, nextProfileRevisionToken: string) => {
    const current = profileRevisionRef.current;
    if (current.memberId !== targetMemberId) {
      onProfileRevision?.(targetMemberId, nextProfileRevisionToken);
      return;
    }
    profileRevisionRef.current = {
      memberId: targetMemberId,
      profileRevisionToken: nextProfileRevisionToken,
      supersededProfileRevisionTokens: [
        ...new Set([
          current.profileRevisionToken,
          current.deferredSnapshot?.profileRevisionToken,
          ...current.supersededProfileRevisionTokens,
        ].filter((value): value is string => value !== null)),
      ].slice(0, 4),
      deferredSnapshot: null,
    };
    const snapshot = memberSnapshotRef.current;
    if (snapshot.member?.user.id === targetMemberId) {
      const nextSnapshot = { ...snapshot, profileRevisionToken: nextProfileRevisionToken };
      memberSnapshotRef.current = nextSnapshot;
      setMemberSnapshot(nextSnapshot);
    }
    onProfileRevision?.(targetMemberId, nextProfileRevisionToken);
  }, [onProfileRevision]);

  const saveMemberProfile = useCallback(async (
    target: MemberMutationTarget,
    payload: Parameters<typeof updateMyProfile>[1],
  ) => {
    const result = target.memberId === currentUserId
      ? await updateOwnProfile(target.memberId, payload, target.profileRevisionToken)
      : await updateMyProfile(target.memberId, payload, target.profileRevisionToken);
    rememberProfileRevision(target.memberId, result.profileRevisionToken);
    return result.profile;
  }, [currentUserId, rememberProfileRevision]);

  const acceptMediaRevision = useCallback((
    targetMemberId: string,
    result: Readonly<{ profileRevisionToken: string }>,
  ) => {
    rememberProfileRevision(targetMemberId, result.profileRevisionToken);
  }, [rememberProfileRevision]);

  const imageItems: ImageGridEditorItem[] = useMemo(
    () =>
      (member?.profile.images ?? []).map((mediaId) => ({
        id: mediaId,
        src: resolveMediaUrl(mediaId),
        alt: mediaId,
      })),
    [member?.profile.images],
  );

  const imageUploadOwnerRef = useRef<MediaUploadOwner | null>(null);
  const audioUploadOwnerRef = useRef<MediaUploadOwner | null>(null);
  const imageUploadState = useMediaUpload<ProfileImageUploadResult>(
    async (files) => {
      const owner = imageUploadOwnerRef.current;
      if (!owner) throw new Error("Missing image upload owner");
      return uploadProfileImages(owner.memberId, files, owner.profileRevisionToken);
    },
    {
      maxFiles: profileImageQuota,
      mediaType: "image",
    },
  );

  const audioUploadState = useMediaUpload<ProfileAudioUploadResult>(
    async (canonicalAudioFiles) => {
      const file = canonicalAudioFiles[0];
      if (!file) {
        throw new Error(t("media.audioFileRequired"));
      }
      const owner = audioUploadOwnerRef.current;
      if (!owner) throw new Error("Missing audio upload owner");
      return uploadProfileAudio(owner.memberId, file, owner.profileRevisionToken);
    },
    {
      maxFiles: 1,
      mediaType: "audio",
    },
  );

  const selectImageFiles = useCallback((source: FileList | File[] | null) => {
    if (imageUploadState.isUploading) return;
    const files = source ? Array.from(source) : [];
    imageUploadOwnerRef.current = files.length === 0
      ? null
      : {
          memberId: requireMember(member).user.id,
          profileRevisionToken: requireMemberProfileRevision(requireMember(member).user.id),
        };
    imageUploadState.selectFiles(source);
  }, [imageUploadState, member, requireMemberProfileRevision]);

  const selectAudioFiles = useCallback((source: FileList | File[] | null) => {
    if (audioUploadState.isUploading) return;
    const files = source ? Array.from(source) : [];
    audioUploadOwnerRef.current = files.length === 0
      ? null
      : {
          memberId: requireMember(member).user.id,
          profileRevisionToken: requireMemberProfileRevision(requireMember(member).user.id),
        };
    audioUploadState.selectFiles(source);
  }, [audioUploadState, member, requireMemberProfileRevision]);

  const clearImageFiles = useCallback(() => {
    imageUploadOwnerRef.current = null;
    imageUploadState.clearFiles();
  }, [imageUploadState]);

  const clearAudioFiles = useCallback(() => {
    audioUploadOwnerRef.current = null;
    audioUploadState.clearFiles();
  }, [audioUploadState]);

  const resetImageUploader = useCallback(() => {
    imageUploadOwnerRef.current = null;
    imageUploadState.reset();
  }, [imageUploadState]);

  const resetAudioUploader = useCallback(() => {
    audioUploadOwnerRef.current = null;
    audioUploadState.reset();
  }, [audioUploadState]);

  const imageUploader = useMemo<UseMediaUploadState<ProfileImageUploadResult>>(() => ({
    ...imageUploadState,
    selectFiles: selectImageFiles,
    clearFiles: clearImageFiles,
    reset: resetImageUploader,
  }), [clearImageFiles, imageUploadState, resetImageUploader, selectImageFiles]);

  const audioUploader = useMemo<UseMediaUploadState<ProfileAudioUploadResult>>(() => ({
    ...audioUploadState,
    selectFiles: selectAudioFiles,
    clearFiles: clearAudioFiles,
    reset: resetAudioUploader,
  }), [audioUploadState, clearAudioFiles, resetAudioUploader, selectAudioFiles]);

  const deleteImageMutation = useMutation({
    mutationFn: ({ target, mediaId }: { target: MemberMutationTarget; mediaId: string }) => {
      return deleteProfileImage(target.memberId, mediaId, target.profileRevisionToken);
    },
    onSuccess: async (result, { target }) => {
      acceptMediaRevision(target.memberId, result);
      notifySuccess(t("message.mediaImageRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageRemoveFailed")),
  });

  const reorderImagesMutation = useMutation({
    mutationFn: ({ target, newOrder }: { target: MemberMutationTarget; newOrder: string[] }) =>
      saveMemberProfile(target, { images: newOrder }),
    onSuccess: async () => {
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaImageReorderFailed")),
  });

  const deleteAudioMutation = useMutation({
    mutationFn: (target: MemberMutationTarget) => {
      return deleteProfileAudio(target.memberId, target.profileRevisionToken);
    },
    onSuccess: async (result, target) => {
      acceptMediaRevision(target.memberId, result);
      notifySuccess(t("message.mediaAudioRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAudioRemoveFailed")),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: ({ target, file }: { target: MemberMutationTarget; file: File }) => {
      return uploadAvatar(target.memberId, file, target.profileRevisionToken);
    },
    onSuccess: async (result, { target }) => {
      acceptMediaRevision(target.memberId, result);
      notifySuccess(t("message.mediaAvatarUploaded"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAvatarUploadFailed")),
  });

  const deleteAvatarMutation = useMutation({
    mutationFn: (target: MemberMutationTarget) => {
      return deleteAvatar(target.memberId, target.profileRevisionToken);
    },
    onSuccess: async (result, target) => {
      acceptMediaRevision(target.memberId, result);
      notifySuccess(t("message.mediaAvatarRemoved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaAvatarRemoveFailed")),
  });

  const saveVideosMutation = useMutation({
    mutationFn: async ({ target, urls }: { target: MemberMutationTarget; urls: string[] }) => {
      const submitted = urls.filter((url) => url.trim() !== "");
      const profile = await saveMemberProfile(target, {
        video_urls: submitted,
      });
      return { profile, submitted };
    },
    onSuccess: async ({ profile, submitted }, { target }) => {
      if (memberSnapshotRef.current.member?.user.id !== target.memberId) {
        await onRefresh();
        return;
      }
      const nextBaseline: VideoBaseline = { memberId: profile.user_id, urls: [...profile.video_urls] };
      videoBaselineRef.current = nextBaseline;
      setVideoBaseline(nextBaseline);
      setVideoUrls((current) => (
        stringArraysEqual(current, submitted) ? [...nextBaseline.urls] : current
      ));
      notifySuccess(t("message.mediaVideosSaved"));
      await onRefresh();
    },
    onError: (error) => onError(error, t("message.mediaVideosSaveFailed")),
  });

  const changeVideoUrl = useCallback((index: number, value: string) => {
    setVideoUrls((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }, []);

  const addVideoUrl = useCallback(() => {
    setVideoUrls((current) => (current.length >= 10 ? current : [...current, ""]));
  }, []);

  const removeVideoUrl = useCallback((index: number) => {
    setVideoUrls((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }, []);

  const hasVideoChanges = useMemo(
    () => !stringArraysEqual(videoUrls, videoBaseline.urls),
    [videoBaseline.urls, videoUrls],
  );
  const isMediaMutationInFlight = imageUploadState.isUploading
    || audioUploadState.isUploading
    || reorderImagesMutation.isPending
    || deleteImageMutation.isPending
    || deleteAudioMutation.isPending
    || uploadAvatarMutation.isPending
    || deleteAvatarMutation.isPending
    || saveVideosMutation.isPending;
  const hasLocalMediaDraft = hasVideoChanges
    || imageUploadState.files.length > 0
    || audioUploadState.files.length > 0
    || isMediaMutationInFlight;

  const discardPendingChanges = useCallback(() => {
    if (isMediaMutationInFlight) return;
    resetImageUploader();
    resetAudioUploader();
    setVideoUrls([...videoBaselineRef.current.urls]);
  }, [isMediaMutationInFlight, resetAudioUploader, resetImageUploader]);

  useEffect(() => {
    const current = profileRevisionRef.current;
    const incomingSnapshot: MemberMediaSnapshot = {
      member: incomingMember,
      profileRevisionToken: incomingProfileRevisionToken ?? null,
    };
    if (current.memberId !== incomingMemberId) {
      profileRevisionRef.current = {
        memberId: incomingMemberId,
        profileRevisionToken: incomingSnapshot.profileRevisionToken,
        supersededProfileRevisionTokens: [],
        deferredSnapshot: null,
      };
      adoptMemberSnapshot(incomingSnapshot);
      return;
    }
    if (!incomingSnapshot.profileRevisionToken) return;
    if (current.supersededProfileRevisionTokens.includes(incomingSnapshot.profileRevisionToken)) return;
    if (hasLocalMediaDraft) {
      if (current.profileRevisionToken === incomingSnapshot.profileRevisionToken) return;
      profileRevisionRef.current = { ...current, deferredSnapshot: incomingSnapshot };
      return;
    }
    const nextSnapshot = current.deferredSnapshot
      ?? (current.profileRevisionToken === incomingSnapshot.profileRevisionToken ? null : incomingSnapshot);
    if (!nextSnapshot) return;
    profileRevisionRef.current = {
      memberId: incomingMemberId,
      profileRevisionToken: nextSnapshot.profileRevisionToken,
      supersededProfileRevisionTokens: [
        ...new Set([
          current.profileRevisionToken,
          ...current.supersededProfileRevisionTokens,
        ].filter((value): value is string => value !== null)),
      ].slice(0, 4),
      deferredSnapshot: null,
    };
    adoptMemberSnapshot(nextSnapshot);
  }, [
    adoptMemberSnapshot,
    hasLocalMediaDraft,
    incomingMember,
    incomingMemberId,
    incomingProfileRevisionToken,
  ]);

  useEffect(() => {
    onMediaStateChange?.({
      memberId,
      hasPendingChanges: hasLocalMediaDraft,
      isInFlight: isMediaMutationInFlight,
      discardPendingChanges,
    });
  }, [discardPendingChanges, hasLocalMediaDraft, isMediaMutationInFlight, memberId, onMediaStateChange]);

  const saveVideoUrls = useCallback(
    async () => {
      await saveVideosMutation.mutateAsync({ target: captureMemberTarget(), urls: videoUrls });
    },
    [captureMemberTarget, saveVideosMutation, videoUrls],
  );

  const reorderImages = useCallback(
    (items: ImageGridEditorItem[]) => {
      reorderImagesMutation.mutate({
        target: captureMemberTarget(),
        newOrder: items.map((item) => item.id),
      });
    },
    [captureMemberTarget, reorderImagesMutation],
  );

  const deleteImage = useCallback(
    (item: ImageGridEditorItem) => {
      deleteImageMutation.mutate({ target: captureMemberTarget(), mediaId: item.id });
    },
    [captureMemberTarget, deleteImageMutation],
  );

  const uploadImages = useCallback(async () => {
    const owner = imageUploadOwnerRef.current;
    if (!owner || owner.memberId !== memberId) {
      if (!imageUploadState.isUploading) resetImageUploader();
      return;
    }
    try {
      const result = await imageUploadState.upload();
      if (!result) {
        return;
      }
      acceptMediaRevision(owner.memberId, result);
      notifySuccess(t("message.mediaImagesUploaded"));
      await onRefresh();
      if (imageUploadOwnerRef.current === owner) resetImageUploader();
    } catch (error) {
      onError(error, t("message.mediaImagesUploadFailed"));
    }
  }, [acceptMediaRevision, imageUploadState, memberId, onError, onRefresh, resetImageUploader, t]);

  const uploadAudio = useCallback(async () => {
    const owner = audioUploadOwnerRef.current;
    if (!owner || owner.memberId !== memberId) {
      if (!audioUploadState.isUploading) resetAudioUploader();
      return;
    }
    try {
      const result = await audioUploadState.upload();
      if (!result) {
        return;
      }
      acceptMediaRevision(owner.memberId, result);
      notifySuccess(t("message.mediaAudioUploaded"));
      await onRefresh();
      if (audioUploadOwnerRef.current === owner) resetAudioUploader();
    } catch (error) {
      onError(error, t("message.mediaAudioUploadFailed"));
    }
  }, [acceptMediaRevision, audioUploadState, memberId, onError, onRefresh, resetAudioUploader, t]);

  const deleteAudio = useCallback(() => {
    deleteAudioMutation.mutate(captureMemberTarget());
  }, [captureMemberTarget, deleteAudioMutation]);

  const handleUploadAvatar = useCallback(
    (file: File) => {
      uploadAvatarMutation.mutate({ target: captureMemberTarget(), file });
    },
    [captureMemberTarget, uploadAvatarMutation],
  );

  const handleDeleteAvatar = useCallback(() => {
    deleteAvatarMutation.mutate(captureMemberTarget());
  }, [captureMemberTarget, deleteAvatarMutation]);

  return {
    profileImageQuota,
    imageItems,
    imageUploader,
    imageReorderPending: reorderImagesMutation.isPending,
    imageDeletePending: deleteImageMutation.isPending,
    reorderImages,
    deleteImage,
    uploadImages,
    videoUrls,
    hasVideoChanges,
    saveVideosPending: saveVideosMutation.isPending,
    changeVideoUrl,
    addVideoUrl,
    removeVideoUrl,
    saveVideoUrls,
    audioUploader,
    deleteAudioPending: deleteAudioMutation.isPending,
    uploadAudio,
    deleteAudio,
    uploadAvatar: handleUploadAvatar,
    deleteAvatar: handleDeleteAvatar,
    avatarUploadPending: uploadAvatarMutation.isPending,
    avatarDeletePending: deleteAvatarMutation.isPending,
  };
}
