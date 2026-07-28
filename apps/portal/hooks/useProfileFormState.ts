import { CLASS_NAMES, type MemberProfile } from "@guild/shared";
import { isAllowedVideoUrl } from "@guild/shared/utils/video";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { notifyWarning } from "../utils/notifications";

type UseProfileFormStateParams = {
  profile: MemberProfile | null | undefined;
};

type ProfileDraftBaseline = {
  identity: string;
  bio: string;
  titleHtml: string;
  power: number;
  classList: Array<(typeof CLASS_NAMES)[number]>;
  videoList: string[];
  imageList: string[];
  availabilityData: Record<string, unknown> | null;
};

function buildProfileDraftBaseline(profile: MemberProfile): ProfileDraftBaseline {
  return {
    identity: `${profile.user_id}:${profile.id}`,
    bio: profile.bio ?? "",
    titleHtml: profile.title_html ?? "",
    power: profile.power,
    classList: [...profile.classes],
    videoList: [...profile.video_urls],
    imageList: [...profile.images],
    availabilityData: (profile.availability ?? null) as Record<string, unknown> | null,
  };
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function reconcileProfileImages(
  draft: string[],
  previousBaseline: string[],
  nextBaseline: string[],
): string[] {
  if (stringArraysEqual(draft, previousBaseline)) {
    return [...nextBaseline];
  }

  const serverKeys = new Set(nextBaseline);
  const preservedDraft = draft.filter((key) => serverKeys.has(key));
  const preservedKeys = new Set(preservedDraft);
  return [
    ...preservedDraft,
    ...nextBaseline.filter((key) => !preservedKeys.has(key)),
  ];
}

export type ProfileFormStateController = ReturnType<typeof useProfileFormState>;

export function useProfileFormState({ profile }: UseProfileFormStateParams) {
  const { t } = useTranslation("profile");
  const { showError } = useAppError();

  const initialBaseline = useRef(profile ? buildProfileDraftBaseline(profile) : null).current;
  const [baseline, setBaseline] = useState<ProfileDraftBaseline | null>(initialBaseline);
  const baselineRef = useRef<ProfileDraftBaseline | null>(initialBaseline);
  const [bio, setBio] = useState(initialBaseline?.bio ?? "");
  const [titleHtml, setTitleHtml] = useState(initialBaseline?.titleHtml ?? "");
  const [power, setPower] = useState(initialBaseline?.power ?? 0);
  const [classDraft, setClassDraft] = useState("");
  const [classList, setClassList] = useState<Array<(typeof CLASS_NAMES)[number]>>(
    initialBaseline?.classList ?? [],
  );
  const [videoDraft, setVideoDraft] = useState("");
  const [videoList, setVideoList] = useState<string[]>(initialBaseline?.videoList ?? []);
  const [imageList, setImageList] = useState<string[]>(initialBaseline?.imageList ?? []);
  const [availabilityData, setAvailabilityData] = useState<Record<string, unknown> | null>(
    initialBaseline?.availabilityData ?? null,
  );
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [currentPasswordForUsername, setCurrentPasswordForUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");

  useEffect(() => {
    if (!profile) {
      return;
    }

    const nextBaseline = buildProfileDraftBaseline(profile);
    const previousBaseline = baselineRef.current;

    if (!previousBaseline || previousBaseline.identity !== nextBaseline.identity) {
      setBio(nextBaseline.bio);
      setTitleHtml(nextBaseline.titleHtml);
      setPower(nextBaseline.power);
      setClassList(nextBaseline.classList);
      setVideoList(nextBaseline.videoList);
      setImageList(nextBaseline.imageList);
      setAvailabilityData(nextBaseline.availabilityData);
    } else {
      setImageList((current) =>
        reconcileProfileImages(
          current,
          previousBaseline.imageList,
          nextBaseline.imageList,
        ),
      );
    }

    baselineRef.current = nextBaseline;
    setBaseline(nextBaseline);
  }, [profile]);

  const acceptServerProfile = useCallback((serverProfile: MemberProfile) => {
    const nextBaseline = buildProfileDraftBaseline(serverProfile);
    baselineRef.current = nextBaseline;
    setBaseline(nextBaseline);
  }, []);

  const classOptions = useMemo(() => CLASS_NAMES.map((className) => ({ value: className, label: className })), []);

  const activeNowEstimate = useMemo(() => {
    const dayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const now = new Date();
    const dayKey = dayKeys[now.getUTCDay()]!;
    const days =
      availabilityData && typeof availabilityData === "object" && "days" in availabilityData
        ? (availabilityData as Record<string, unknown>).days
        : null;
    const raw = days && typeof days === "object" ? (days as Record<string, unknown>)[dayKey] : null;
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
      const startParts = startUtc.split(":").map((value) => Number.parseInt(value, 10));
      const endParts = endUtc.split(":").map((value) => Number.parseInt(value, 10));
      const startHour = startParts[0];
      const startMinute = startParts[1];
      const endHour = endParts[0];
      const endMinute = endParts[1];
      if (
        startHour === undefined || startMinute === undefined ||
        endHour === undefined || endMinute === undefined ||
        !Number.isFinite(startHour) || !Number.isFinite(startMinute) ||
        !Number.isFinite(endHour) || !Number.isFinite(endMinute)
      ) {
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

  const addClass = () => {
    const next = classDraft.trim().toLowerCase();
    if (!next) {
      return;
    }

    const normalized = CLASS_NAMES.find((className) => className.toLowerCase() === next);
    if (!normalized) {
      notifyWarning(t("message.classInvalid"));
      return;
    }
    if (classList.includes(normalized)) {
      notifyWarning(t("message.classDuplicate"));
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
      notifyWarning(t("message.videoUrlDuplicate"));
      return;
    }
    if (videoList.length >= 10) {
      notifyWarning(t("message.videoUrlLimit"));
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
      const activeId = String(active.id) as (typeof CLASS_NAMES)[number];
      const overId = String(over.id) as (typeof CLASS_NAMES)[number];
      const oldIndex = current.indexOf(activeId);
      const newIndex = current.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  const removeClass = (index: number) => {
    setClassList((current) => current.filter((_, valueIndex) => valueIndex !== index));
  };

  const isDirty = useMemo(() => {
    if (!baseline) return false;
    return (
      bio !== baseline.bio ||
      titleHtml !== baseline.titleHtml ||
      power !== baseline.power ||
      JSON.stringify(classList) !== JSON.stringify(baseline.classList) ||
      JSON.stringify(videoList) !== JSON.stringify(baseline.videoList) ||
      JSON.stringify(imageList) !== JSON.stringify(baseline.imageList) ||
      JSON.stringify(availabilityData ?? null) !== JSON.stringify(baseline.availabilityData)
    );
  }, [
    availabilityData,
    baseline,
    bio,
    classList,
    imageList,
    power,
    titleHtml,
    videoList,
  ]);

  return {
    bio,
    setBio,
    titleHtml,
    setTitleHtml,
    power,
    setPower,
    classDraft,
    setClassDraft,
    classList,
    setClassList,
    videoDraft,
    setVideoDraft,
    videoList,
    setVideoList,
    imageList,
    setImageList,
    availabilityData,
    setAvailabilityData,
    currentPassword,
    setCurrentPassword,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    currentPasswordForUsername,
    setCurrentPasswordForUsername,
    newUsername,
    setNewUsername,
    classOptions,
    activeNowEstimate,
    isDirty,
    acceptServerProfile,
    addClass,
    removeClass,
    addVideoUrl,
    handleClassDragEnd,
  };
}
