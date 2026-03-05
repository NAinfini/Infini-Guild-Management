import { CLASS_NAMES } from "@guild/shared";
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Button, Grid, Group, Tabs, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconGripVertical } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../../api/client";
import { queryKeys } from "../../api/query-keys";
import {
  changeMyPassword,
  changeMyUsername,
  deleteProfileAudio,
  deleteProfileImage,
  updateMyProfile,
  uploadProfileAudio,
  uploadProfileImages,
  verifyMyDiscordLink,
  unlinkMyDiscord,
} from "../../api/mutations/users";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useProfileData } from "../../hooks/data/useProfileData";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaUpload } from "../../hooks/useMediaUpload";
import { useAuthStore } from "../../stores/auth";
import { ProfileAccountTab } from "../feature/profile/ProfileAccountTab";
import { ProfileAvailabilityTab } from "../feature/profile/ProfileAvailabilityTab";
import { ProfileMediaTab } from "../feature/profile/ProfileMediaTab";
import { ProfilePreviewCard } from "../feature/profile/ProfilePreviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { PageLayout } from "../layout/PageLayout";
import "./MyProfilePage.css";

type SortableClassRowProps = {
  value: string;
  index: number;
  isPrimary: boolean;
  onRemove: () => void;
};

function SortableClassRow(props: SortableClassRowProps) {
  const { value, index, isPrimary, onRemove } = props;
  const { t } = useTranslation("profile");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: value });

  return (
    <Group
      ref={setNodeRef}
      wrap="wrap"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={`my-profile-sortable-row ${isDragging ? "my-profile-sortable-row--dragging" : ""}`.trim()}
    >
      <div {...attributes} {...listeners} style={{ cursor: "grab", display: "flex", alignItems: "center" }} aria-label={t("classRow.aria.drag", { value })}>
        <IconGripVertical size={18} />
      </div>
      <Badge color={isPrimary ? "yellow" : "gray"}>{value}</Badge>
      <Button size="xs" color="infini-danger" onClick={onRemove}>
        {t("classRow.remove")}
      </Button>
      <Text c="dimmed" size="sm" style={{ fontSize: 12 }}>
        #{index + 1}
      </Text>
    </Group>
  );
}
export function MyProfilePage() {
  const { t } = useTranslation("profile");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const setProfile = useAuthStore((state) => state.setProfile);
  const clearSession = useAuthStore((state) => state.clearSession);
  const queryClient = useQueryClient();
  const { showError } = useAppError();

  const { profileQuery } = useProfileData({
    userId: user?.id,
  });
  useLoadWarningToast(profileQuery.isError, t("common:loadErrorRetry"));

  const [bio, setBio] = useState("");
  const [titleHtml, setTitleHtml] = useState("");
  const [wechatName, setWechatName] = useState("");
  const [power, setPower] = useState(0);
  const [classDraft, setClassDraft] = useState("");
  const [classList, setClassList] = useState<string[]>([]);
  const [videoDraft, setVideoDraft] = useState("");
  const [videoList, setVideoList] = useState<string[]>([]);
  const [imageList, setImageList] = useState<string[]>([]);
  const [vacationStart, setVacationStart] = useState("");
  const [vacationEnd, setVacationEnd] = useState("");
  const [availabilityData, setAvailabilityData] = useState<Record<string, unknown> | null>(null);
  const [discordReminderOptOut, setDiscordReminderOptOut] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [currentPasswordForUsername, setCurrentPasswordForUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [discordCode, setDiscordCode] = useState("");
  const [isDiscordLinking, setIsDiscordLinking] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const classSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const imageUploader = useMediaUpload(
    async (files) => {
      if (!user) {
        throw new Error(t("message.sessionMissing"));
      }
      return uploadProfileImages(user.id, files);
    },
    {
      maxFiles: 10,
      maxFileSizeBytes: 5 * 1024 * 1024,
      mediaType: "image",
      convertImagesToWebp: true,
      imageWebpQuality: 0.8,
    },
  );

  const audioUploader = useMediaUpload(
    async (files) => {
      if (!user) {
        throw new Error(t("message.sessionMissing"));
      }
      const file = files[0];
      if (!file) {
        throw new Error(t("message.audioFileRequired"));
      }
      return uploadProfileAudio(user.id, file);
    },
    {
      maxFiles: 1,
      maxFileSizeBytes: 20 * 1024 * 1024,
      mediaType: "audio",
      convertAudioToOpus: true,
    },
  );

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }
    const profile = profileQuery.data.profile;
    setBio(profile.bio ?? "");
    setTitleHtml(profile.title_html ?? "");
    setWechatName(profile.wechat_name ?? "");
    setPower(profile.power);
    setClassList(profile.classes);
    setVideoList(profile.video_urls);
    setImageList(profile.images);
    setVacationStart(profile.vacation_start ?? "");
    setVacationEnd(profile.vacation_end ?? "");
    setAvailabilityData((profile.availability ?? null) as Record<string, unknown> | null);
    setDiscordReminderOptOut(profile.discord_reminder_opt_out);
  }, [profileQuery.data]);

  const isAllowedVideoUrl = (value: string): boolean => {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        host.includes("youtube.com") ||
        host.includes("youtu.be") ||
        host.includes("bilibili.com") ||
        host.includes("vimeo.com") ||
        host.includes("tiktok.com") ||
        host.includes("douyin.com")
      );
    } catch {
      return false;
    }
  };

  const classOptions = useMemo(
    () => CLASS_NAMES.map((className) => ({ value: className, label: className })),
    [],
  );

  const activeNowEstimate = useMemo(() => {
    const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
    const now = new Date();
    const dayKey = dayKeys[now.getUTCDay()];
    const raw = availabilityData && typeof availabilityData === "object"
      ? (availabilityData as Record<string, unknown>)[dayKey]
      : null;
    if (!Array.isArray(raw)) {
      return t("availability.none");
    }
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    let minutesUntilNext = Number.POSITIVE_INFINITY;
    for (const item of raw) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const startUtc = (item as Record<string, unknown>).start_utc;
      const endUtc = (item as Record<string, unknown>).end_utc;
      if (typeof startUtc !== "string" || typeof endUtc !== "string") {
        continue;
      }
      const [startHour, startMinute] = startUtc.split(":").map((value) => Number.parseInt(value, 10));
      const [endHour, endMinute] = endUtc.split(":").map((value) => Number.parseInt(value, 10));
      if (!Number.isFinite(startHour) || !Number.isFinite(startMinute) || !Number.isFinite(endHour) || !Number.isFinite(endMinute)) {
        continue;
      }
      const startTotal = startHour * 60 + startMinute;
      const endTotal = endHour * 60 + endMinute;
      if (currentMinutes >= startTotal && currentMinutes < endTotal) {
        return t("availability.activeNow");
      }
      if (startTotal > currentMinutes) {
        minutesUntilNext = Math.min(minutesUntilNext, startTotal - currentMinutes);
      }
    }
    if (Number.isFinite(minutesUntilNext)) {
      return t("availability.nextWindowMinutes", { minutes: Math.max(1, Math.round(minutesUntilNext)) });
    }
    return t("availability.noneToday");
  }, [availabilityData, t]);

  const moveListItem = <T,>(list: T[], index: number, delta: number): T[] => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= list.length) {
      return list;
    }
    const next = [...list];
    const current = next[index];
    if (current === undefined) {
      return list;
    }
    next[index] = next[nextIndex] as T;
    next[nextIndex] = current;
    return next;
  };

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Missing user session");
      return updateMyProfile(user.id, {
        bio: bio || null,
        title_html: titleHtml || null,
        wechat_name: wechatName || null,
        power,
        classes: classList,
        video_urls: videoList,
        images: imageList,
        vacation_start: vacationStart || null,
        vacation_end: vacationEnd || null,
        availability: availabilityData,
        discord_reminder_opt_out: discordReminderOptOut,
      });
    },
    onSuccess: async (updatedProfile) => {
      setProfile(updatedProfile);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.profileSaved") });
    },
    onError: (error) => {
      showError(error, t("message.profileSaveFailed"));
    },
  });

  const saveProfile = () => {
    if (!user) return;
    saveProfileMutation.mutate();
  };

  const uploadImages = async () => {
    if (!user) return;
    try {
      const uploaded = await imageUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "infini-success", message: t("message.imagesUploaded") });
    } catch (error) {
      showError(error, t("message.imageUploadFailed"));
    }
  };

  const uploadAudio = async () => {
    if (!user) return;
    try {
      const uploaded = await audioUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "infini-success", message: t("message.audioUploaded") });
    } catch (error) {
      showError(error, t("message.audioUploadFailed"));
    }
  };

  const addClass = () => {
    const next = classDraft.trim().toLowerCase();
    if (!next) {
      return;
    }
    const normalized = CLASS_NAMES.find((className) => className.toLowerCase() === next);
    if (!normalized) {
      notifications.show({ color: "infini-warning", message: t("message.classInvalid") });
      return;
    }
    if (classList.includes(normalized)) {
      notifications.show({ color: "infini-warning", message: t("message.classDuplicate") });
      return;
    }
    setClassList((current) => [...current, normalized]);
    setClassDraft("");
  };

  const addVideoUrl = () => {
    const next = videoDraft.trim();
    if (!next) {
      return;
    }
    if (!isAllowedVideoUrl(next)) {
      showError(new Error(t("message.videoHostUnsupported")), t("message.videoHostAllowedOnly"));
      return;
    }
    if (videoList.includes(next)) {
      notifications.show({ color: "infini-warning", message: t("message.videoUrlDuplicate") });
      return;
    }
    if (videoList.length >= 10) {
      notifications.show({ color: "infini-warning", message: t("message.videoUrlLimit") });
      return;
    }
    setVideoList((current) => [...current, next]);
    setVideoDraft("");
  };

  const handleClassDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }
    setClassList((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const removeImageMutation = useMutation({
    mutationFn: (key: string) => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileImage(user.id, key);
    },
    onSuccess: async (_data, key) => {
      setImageList((current) => current.filter((item) => item !== key));
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.imageRemoved") });
    },
    onError: (error) => {
      showError(error, t("message.imageRemoveFailed"));
    },
  });

  const removeImage = (key: string) => {
    if (!user) return;
    removeImageMutation.mutate(key);
  };

  const removeAudioMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return deleteProfileAudio(user.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      notifications.show({ color: "infini-success", message: t("message.audioRemoved") });
    },
    onError: (error) => {
      showError(error, t("message.audioRemoveFailed"));
    },
  });

  const removeAudio = () => {
    if (!user) return;
    removeAudioMutation.mutate();
  };

  const verifyDiscordMutation = useMutation({
    mutationFn: () => {
      if (!user || !discordCode.trim()) throw new Error("Missing user or code");
      return verifyMyDiscordLink(user.id, { code: discordCode.trim() });
    },
    onMutate: () => {
      setIsDiscordLinking(true);
    },
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      setDiscordCode("");
      notifications.show({ color: "infini-success", message: t("message.discordLinked", { discordId: response.discord_id }) });
    },
    onError: (error) => {
      showError(error, t("message.discordLinkFailed"));
    },
    onSettled: () => {
      setIsDiscordLinking(false);
    },
  });

  const verifyDiscordLink = () => {
    if (!user || !discordCode.trim()) return;
    verifyDiscordMutation.mutate();
  };

  const unlinkDiscordMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return unlinkMyDiscord(user.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user?.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      notifications.show({ color: "infini-success", message: t("message.discordUnlinked") });
    },
    onError: (error) => {
      showError(error, t("message.discordUnlinkFailed"));
    },
  });

  const unlinkDiscord = () => {
    if (!user) return;
    unlinkDiscordMutation.mutate();
  };

  const changePasswordMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return changeMyPassword(user.id, {
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      notifications.show({ color: "infini-success", message: t("message.passwordChanged") });
    },
    onError: (error) => {
      showError(error, t("message.passwordChangeFailed"));
    },
  });

  const changePassword = () => {
    if (!user) return;
    changePasswordMutation.mutate();
  };

  const changeUsernameMutation = useMutation({
    mutationFn: () => {
      if (!user) throw new Error("Missing user session");
      return changeMyUsername(user.id, {
        currentPassword: currentPasswordForUsername,
        newUsername,
      });
    },
    onSuccess: () => {
      notifications.show({ color: "infini-success", message: t("message.usernameChanged") });
      setCurrentPasswordForUsername("");
      setNewUsername("");
      clearSession();
      void navigate({ to: "/login" });
    },
    onError: (error) => {
      showError(error, t("message.usernameChangeFailed"));
    },
  });

  const changeUsername = () => {
    if (!user) return;
    changeUsernameMutation.mutate();
  };

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" }),
    onSettled: () => {
      clearSession();
      void navigate({ to: "/login" });
    },
  });

  const logout = () => {
    logoutMutation.mutate();
  };

  const profile = profileQuery.data?.profile;
  const isDirty = useMemo(() => {
    if (!profile) return false;
    return (
      bio !== (profile.bio ?? "") ||
      titleHtml !== (profile.title_html ?? "") ||
      wechatName !== (profile.wechat_name ?? "") ||
      power !== profile.power ||
      JSON.stringify(classList) !== JSON.stringify(profile.classes) ||
      JSON.stringify(videoList) !== JSON.stringify(profile.video_urls) ||
      JSON.stringify(imageList) !== JSON.stringify(profile.images) ||
      vacationStart !== (profile.vacation_start ?? "") ||
      vacationEnd !== (profile.vacation_end ?? "") ||
      JSON.stringify(availabilityData ?? null) !== JSON.stringify(profile.availability ?? null) ||
      discordReminderOptOut !== profile.discord_reminder_opt_out
    );
  }, [
    availabilityData,
    bio,
    classList,
    discordReminderOptOut,
    imageList,
    power,
    profile,
    titleHtml,
    vacationEnd,
    vacationStart,
    videoList,
    wechatName,
  ]);
  useBeforeUnloadPrompt(isDirty);

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("subtitle")}
      className="my-profile-page"
    >
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <div style={{ position: "sticky", top: 16 }}>
            <ProfilePreviewCard
              username={user?.username ?? "-"}
              wechatName={wechatName}
              power={power}
              primaryClass={classList[0] ?? "-"}
              imageCount={imageList.length}
              videoCount={videoList.length}
              hasAudio={Boolean(profile?.audio_key)}
              discordId={profile?.discord_id ?? null}
              activeNowEstimate={activeNowEstimate}
              bio={bio}
            />
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 9 }}>
          <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
            <Tabs.List>
              <Tabs.Tab value="profile">{t("tab.profile")}</Tabs.Tab>
              <Tabs.Tab value="media">{t("tab.media")}</Tabs.Tab>
              <Tabs.Tab value="availability">{t("tab.availability")}</Tabs.Tab>
              <Tabs.Tab value="account">{t("tab.account")}</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="profile" pt="sm">
              <ProfileProfileTab
                wechatName={wechatName}
                power={power}
                classDraft={classDraft}
                classOptions={classOptions}
                classList={classList}
                discordId={profile?.discord_id ?? null}
                titleHtml={titleHtml}
                onTitleHtmlChange={setTitleHtml}
                bio={bio}
                classSensors={classSensors}
                onWechatNameChange={setWechatName}
                onPowerChange={setPower}
                onClassDraftChange={setClassDraft}
                onAddClass={addClass}
                onClassDragEnd={handleClassDragEnd}
                renderSortableClassRow={(value, index) => (
                  <SortableClassRow
                    key={value}
                    value={value}
                    index={index}
                    isPrimary={index === 0}
                    onRemove={() =>
                      setClassList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                    }
                  />
                )}
                onBioChange={setBio}
                onSaveProfile={saveProfile}
                savePending={saveProfileMutation.isPending}
                isDirty={isDirty}
                fieldBioPlaceholder={t("field.bio")}
              />
            </Tabs.Panel>

            <Tabs.Panel value="media" pt="sm">
              <ProfileMediaTab
                videoDraft={videoDraft}
                videoList={videoList}
                imageList={imageList}
                profileAudioKey={profile?.audio_key ?? null}
                imageUploader={imageUploader}
                audioUploader={audioUploader}
                onVideoDraftChange={setVideoDraft}
                onAddVideoUrl={addVideoUrl}
                onMoveVideo={(index, delta) =>
                  setVideoList((current) => moveListItem(current, index, delta))
                }
                onRemoveVideo={(index) =>
                  setVideoList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                }
                onUploadImages={() => {
                  void uploadImages();
                }}
                onUploadAudio={() => {
                  void uploadAudio();
                }}
                onMoveImage={(index, delta) =>
                  setImageList((current) => moveListItem(current, index, delta))
                }
                onRemoveImage={(key) => {
                  void removeImage(key);
                }}
                onRemoveAudio={() => {
                  void removeAudio();
                }}
              />
            </Tabs.Panel>

            <Tabs.Panel value="availability" pt="sm">
              <ProfileAvailabilityTab
                availabilityData={availabilityData}
                vacationStart={vacationStart}
                vacationEnd={vacationEnd}
                onAvailabilityChange={setAvailabilityData}
                onVacationStartChange={setVacationStart}
                onVacationEndChange={setVacationEnd}
                onSaveAvailability={saveProfile}
              />
            </Tabs.Panel>

            <Tabs.Panel value="account" pt="sm">
              <ProfileAccountTab
                currentPassword={currentPassword}
                newPassword={newPassword}
                confirmNewPassword={confirmNewPassword}
                currentPasswordForUsername={currentPasswordForUsername}
                newUsername={newUsername}
                discordCode={discordCode}
                isDiscordLinking={isDiscordLinking}
                discordId={profile?.discord_id ?? null}
                discordReminderOptOut={discordReminderOptOut}
                onCurrentPasswordChange={setCurrentPassword}
                onNewPasswordChange={setNewPassword}
                onConfirmNewPasswordChange={setConfirmNewPassword}
                onCurrentPasswordForUsernameChange={setCurrentPasswordForUsername}
                onNewUsernameChange={setNewUsername}
                onDiscordCodeChange={setDiscordCode}
                onToggleDiscordReminder={(checked) => setDiscordReminderOptOut(!checked)}
                onChangePassword={changePassword}
                onChangeUsername={changeUsername}
                onVerifyDiscordLink={() => {
                  void verifyDiscordLink();
                }}
                onUnlinkDiscord={() => {
                  void unlinkDiscord();
                }}
                onSaveDiscordPreference={saveProfile}
                onLogout={() => {
                  void logout();
                }}
                changePasswordLabel={t("button.changePassword")}
                changeUsernameLabel={t("button.changeUsername")}
              />
            </Tabs.Panel>
          </Tabs>
        </Grid.Col>
      </Grid>
    </PageLayout>
  );
}
