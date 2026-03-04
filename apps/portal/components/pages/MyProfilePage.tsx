import { CLASS_NAMES } from "@guild/shared";
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Button, Grid, Group, Tabs, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
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
import { usePageHeaderActions } from "../../context/PageHeaderContext";
import { useAppError } from "../../hooks/useAppError";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useProfileData } from "../../hooks/data/useProfileData";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaUpload } from "../../hooks/useMediaUpload";
import { useAuthStore } from "../../stores/auth";
import { ProfileAccountTab } from "../feature/profile/ProfileAccountTab";
import { ProfileAvailabilityTab } from "../feature/profile/ProfileAvailabilityTab";
import { ProfilePreviewCard } from "../feature/profile/ProfilePreviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { PageLayout } from "../layout/PageLayout";
import "./MyProfilePage.css";

const LazyTipTapEditor = lazy(() =>
  import("../shared/TipTapEditor").then((mod) => ({ default: mod.TipTapEditor })),
);

type SortableClassRowProps = {
  value: string;
  index: number;
  isPrimary: boolean;
  onSetPrimary: () => void;
  onRemove: () => void;
};

function SortableClassRow(props: SortableClassRowProps) {
  const { value, index, isPrimary, onSetPrimary, onRemove } = props;
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
      <Button size="xs" {...attributes} {...listeners} aria-label={`Drag class ${value}`}>
        Drag
      </Button>
      <Badge color={isPrimary ? "yellow" : "gray"}>{value}</Badge>
      <Button size="xs" onClick={onSetPrimary} disabled={isPrimary}>
        Set Primary
      </Button>
      <Button size="xs" color="red" onClick={onRemove}>
        Remove
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
        throw new Error("Missing user session");
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
        throw new Error("Missing user session");
      }
      const file = files[0];
      if (!file) {
        throw new Error("Audio file is required");
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
      return "No availability blocks";
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
        return "Active now";
      }
      if (startTotal > currentMinutes) {
        minutesUntilNext = Math.min(minutesUntilNext, startTotal - currentMinutes);
      }
    }
    if (Number.isFinite(minutesUntilNext)) {
      return `Next active window in ${Math.max(1, Math.round(minutesUntilNext))} min`;
    }
    return "No more active windows today";
  }, [availabilityData]);

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

  const saveProfile = async () => {
    if (!user) return;

    const payload = {
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
    };

    try {
      const updatedProfile = await updateMyProfile(user.id, payload);
      setProfile(updatedProfile);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "green", message: "Profile saved" });
    } catch (error) {
      showError(error, "Failed to save profile");
    }
  };

  const uploadImages = async () => {
    if (!user) return;
    try {
      const uploaded = await imageUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "green", message: "Images uploaded" });
    } catch (error) {
      showError(error, "Image upload failed");
    }
  };

  const uploadAudio = async () => {
    if (!user) return;
    try {
      const uploaded = await audioUploader.upload();
      if (!uploaded) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "green", message: "Audio uploaded" });
    } catch (error) {
      showError(error, "Audio upload failed");
    }
  };

  const addClass = () => {
    const next = classDraft.trim().toLowerCase();
    if (!next) {
      return;
    }
    const normalized = CLASS_NAMES.find((className) => className.toLowerCase() === next);
    if (!normalized) {
      notifications.show({ color: "yellow", message: "Please select a valid class" });
      return;
    }
    if (classList.includes(normalized)) {
      notifications.show({ color: "yellow", message: "Class already exists" });
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
      showError(new Error("Unsupported video host"), "Only YouTube/Bilibili/Vimeo/TikTok/Douyin URLs are allowed");
      return;
    }
    if (videoList.includes(next)) {
      notifications.show({ color: "yellow", message: "Video URL already exists" });
      return;
    }
    if (videoList.length >= 10) {
      notifications.show({ color: "yellow", message: "Maximum 10 video URLs" });
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

  const removeImage = async (key: string) => {
    if (!user) {
      return;
    }
    try {
      await deleteProfileImage(user.id, key);
      setImageList((current) => current.filter((item) => item !== key));
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "green", message: "Image removed" });
    } catch (error) {
      showError(error, "Failed to remove image");
    }
  };

  const removeAudio = async () => {
    if (!user) {
      return;
    }
    try {
      await deleteProfileAudio(user.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      notifications.show({ color: "green", message: "Audio removed" });
    } catch (error) {
      showError(error, "Failed to remove audio");
    }
  };

  const verifyDiscordLink = async () => {
    if (!user || !discordCode.trim()) return;
    try {
      setIsDiscordLinking(true);
      const response = await verifyMyDiscordLink(user.id, { code: discordCode.trim() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      setDiscordCode("");
      notifications.show({ color: "green", message: `Discord linked: ${response.discord_id}` });
    } catch (error) {
      showError(error, "Discord link failed");
    } finally {
      setIsDiscordLinking(false);
    }
  };

  const unlinkDiscord = async () => {
    if (!user) return;
    try {
      await unlinkMyDiscord(user.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.myProfile.detail(user.id) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
      notifications.show({ color: "green", message: "Discord unlinked" });
    } catch (error) {
      showError(error, "Discord unlink failed");
    }
  };

  const changePassword = async () => {
    if (!user) return;
    try {
      await changeMyPassword(user.id, {
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      notifications.show({ color: "green", message: "Password changed" });
    } catch (error) {
      showError(error, "Password change failed");
    }
  };

  const changeUsername = async () => {
    if (!user) return;
    try {
      await changeMyUsername(user.id, {
        currentPassword: currentPasswordForUsername,
        newUsername,
      });
      notifications.show({ color: "green", message: "Username changed. Please log in again." });
      setCurrentPasswordForUsername("");
      setNewUsername("");
      clearSession();
      void navigate({ to: "/login" });
    } catch (error) {
      showError(error, "Username change failed");
    }
  };

  const logout = async () => {
    try {
      await apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
    } catch {
      // Keep client state deterministic even if backend session has expired.
    } finally {
      clearSession();
      void navigate({ to: "/login" });
    }
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
  const pageHeaderActions = useMemo(
    () => (isDirty ? <Badge color="yellow">Unsaved changes</Badge> : <Badge color="green">Saved</Badge>),
    [isDirty],
  );
  usePageHeaderActions(pageHeaderActions);

  return (
    <PageLayout
      title={t("title")}
      subtitle="Account Workspace"
      className="my-profile-page"
    >
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 4 }}>
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
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
            <Tabs.List>
              <Tabs.Tab value="profile">{t("tab.profile")}</Tabs.Tab>
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
                videoDraft={videoDraft}
                videoList={videoList}
                imageList={imageList}
                profileAudioKey={profile?.audio_key ?? null}
                discordId={profile?.discord_id ?? null}
                titleEditor={(
                  <Suspense fallback={null}>
                    <LazyTipTapEditor
                      value={titleHtml}
                      onChange={setTitleHtml}
                      placeholder={t("field.titleHtml")}
                      mode="html"
                    />
                  </Suspense>
                )}
                bio={bio}
                imageUploader={imageUploader}
                audioUploader={audioUploader}
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
                    onSetPrimary={() =>
                      setClassList((current) => {
                        const picked = current[index];
                        if (!picked) return current;
                        return [picked, ...current.filter((_, valueIndex) => valueIndex !== index)];
                      })
                    }
                    onRemove={() =>
                      setClassList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                    }
                  />
                )}
                onVideoDraftChange={setVideoDraft}
                onAddVideoUrl={addVideoUrl}
                onMoveVideo={(index, delta) =>
                  setVideoList((current) => moveListItem(current, index, delta))
                }
                onRemoveVideo={(index) =>
                  setVideoList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                }
                onBioChange={setBio}
                onSaveProfile={saveProfile}
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
                fieldBioPlaceholder={t("field.bio")}
                buttonUploadImagesLabel={t("button.uploadImages")}
                buttonUploadAudioLabel={t("button.uploadAudio")}
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


