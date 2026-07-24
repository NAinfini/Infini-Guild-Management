import { CLASS_NAMES, type MemberProfile } from "@guild/shared";
import { isAllowedVideoUrl } from "@guild/shared/utils/video";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppError } from "./useAppError";
import { notifyWarning } from "../utils/notifications";

type UseProfileFormStateParams = {
  profile: MemberProfile | null | undefined;
};

export type ProfileFormStateController = ReturnType<typeof useProfileFormState>;

export function useProfileFormState({ profile }: UseProfileFormStateParams) {
  const { t } = useTranslation("profile");
  const { showError } = useAppError();

  const [bio, setBio] = useState("");
  const [titleHtml, setTitleHtml] = useState("");
  const [power, setPower] = useState(0);
  const [classDraft, setClassDraft] = useState("");
  const [classList, setClassList] = useState<Array<(typeof CLASS_NAMES)[number]>>([]);
  const [videoDraft, setVideoDraft] = useState("");
  const [videoList, setVideoList] = useState<string[]>([]);
  const [imageList, setImageList] = useState<string[]>([]);
  const [availabilityData, setAvailabilityData] = useState<Record<string, unknown> | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [currentPasswordForUsername, setCurrentPasswordForUsername] = useState("");
  const [newUsername, setNewUsername] = useState("");

  useEffect(() => {
    if (!profile) {
      return;
    }

    setBio(profile.bio ?? "");
    setTitleHtml(profile.title_html ?? "");
    setPower(profile.power);
    setClassList(profile.classes);
    setVideoList(profile.video_urls);
    setImageList(profile.images);
    setAvailabilityData((profile.availability ?? null) as Record<string, unknown> | null);
  }, [profile]);

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

  const isDirty = useMemo(() => {
    if (!profile) return false;
    return (
      bio !== (profile.bio ?? "") ||
      titleHtml !== (profile.title_html ?? "") ||
      power !== profile.power ||
      JSON.stringify(classList) !== JSON.stringify(profile.classes) ||
      JSON.stringify(videoList) !== JSON.stringify(profile.video_urls) ||
      JSON.stringify(imageList) !== JSON.stringify(profile.images) ||
      JSON.stringify(availabilityData ?? null) !== JSON.stringify(profile.availability ?? null)
    );
  }, [
    availabilityData,
    bio,
    classList,
    imageList,
    power,
    profile,
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
    addClass,
    addVideoUrl,
    handleClassDragEnd,
  };
}
