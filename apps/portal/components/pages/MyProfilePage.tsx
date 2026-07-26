import { PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Grid, Group, Skeleton, Stack, Tabs, Text } from "@mantine/core";
import { DepthButton } from "@portal/components/shared/DepthButton";
import { TrashIcon, UserCircleIcon } from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CLASS_COLOR_GROUP } from "@guild/shared/constants/classes";
import { uploadProfileAudio, uploadProfileImages } from "../../services/UserService";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useProfileData } from "../../hooks/data/useProfileData";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaUpload } from "../../hooks/useMediaUpload";
import { useProfileFormState } from "../../hooks/useProfileFormState";
import { useProfileMutations } from "../../hooks/useProfileMutations";
import { useProfileAvatarMutations } from "../../hooks/useProfileAvatarMutations";
import { useMemberOnboardingData } from "../../hooks/data/useSiteConfigData";
import { useMemberOnboardingMutations } from "../../hooks/useSiteConfigMutations";
import { useAuthStore } from "../../stores/auth";
import { useAppError } from "../../hooks/useAppError";
import { ProfileAccountTab } from "../feature/profile/ProfileAccountTab";
import { ProfileAvailabilityTab } from "../feature/profile/ProfileAvailabilityTab";
import { ProfilePreviewCard } from "../feature/profile/ProfilePreviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { MemberOnboardingCard } from "../feature/onboarding/MemberOnboardingCard";
import { PageLayout } from "../layout/PageLayout";
import "./MyProfilePage.css";

const CLASS_BADGE_COLOR: Record<string, string> = {
  blue: "blue",
  green: "teal",
  purple: "violet",
  "dark-red": "red",
};

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
      <Badge color={CLASS_BADGE_COLOR[(CLASS_COLOR_GROUP as Record<string, string>)[value] ?? ""] ?? (isPrimary ? "yellow" : "gray")}>{value}</Badge>
      <DepthButton size="sm" type="danger" iconOnly before={<TrashIcon size={16} />} onClick={onRemove}
        tooltip={{ label: t("classRow.remove"), withArrow: true }}
      />
      <Text c="dimmed" size="sm" style={{ fontSize: 12 }}>
        #{index + 1}
      </Text>
    </Group>
  );
}

function moveListItem<T>(list: T[], index: number, delta: number): T[] {
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
}

export function MyProfilePage() {
  const { t } = useTranslation("profile");
  const user = useAuthStore((state) => state.user);
  const [activeTab, setActiveTab] = useState("profile");
  const classSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { profileQuery } = useProfileData({
    userId: user?.id,
  });
  useLoadWarningToast(profileQuery.isError, t("common:loadErrorRetry"));

  const form = useProfileFormState({ profile: profileQuery.data?.profile });
  useBeforeUnloadPrompt(form.isDirty);

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
    },
  );

  const mutations = useProfileMutations({
    form,
    imageUploader,
    audioUploader,
  });

  const { showError } = useAppError();
  const { onboardingQuery } = useMemberOnboardingData(Boolean(user));
  const onboardingMutations = useMemberOnboardingMutations({ showError });
  const { avatarUploadMutation, avatarDeleteMutation } = useProfileAvatarMutations({
    userId: user?.id,
    showError,
  });

  const profile = profileQuery.data?.profile;

  return (
    <PageLayout
      title={t("title")}
      subtitle={t("subtitle")}
      icon={<UserCircleIcon size={22} />}
      className="my-profile-page"
    >
      {profileQuery.isLoading ? (
        <Grid gutter="md">
          <Grid.Col span={{ base: 12, lg: 3 }}>
            <Skeleton height={280} radius={8} />
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 9 }}>
            <Stack gap={12}>
              <Skeleton height={36} width="50%" radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
            </Stack>
          </Grid.Col>
        </Grid>
      ) : (
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <div style={{ position: "sticky", top: 16 }}>
            <ProfilePreviewCard
              username={user?.username ?? "-"}
              avatarKey={profile?.avatar_key ?? null}
              power={form.power}
              primaryClass={form.classList[0] ?? "-"}
              imageCount={form.imageList.length}
              videoCount={form.videoList.length}
              activeNowEstimate={form.activeNowEstimate}
              bio={form.bio}
            />
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 9 }}>
          <Tabs value={activeTab} onChange={(value) => value && setActiveTab(value)}>
            <Tabs.List>
              <Tabs.Tab value="profile">{t("tab.profile")}</Tabs.Tab>
              <Tabs.Tab value="availability">{t("tab.availability")}</Tabs.Tab>
              <Tabs.Tab value="onboarding">{t("tab.onboarding")}</Tabs.Tab>
              <Tabs.Tab value="account">{t("tab.account")}</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="profile" pt="md">
              <ProfileProfileTab
                power={form.power}
                classDraft={form.classDraft}
                classOptions={form.classOptions}
                classList={form.classList}
                titleHtml={form.titleHtml}
                onTitleHtmlChange={form.setTitleHtml}
                bio={form.bio}
                classSensors={classSensors}
                onPowerChange={form.setPower}
                onClassDraftChange={form.setClassDraft}
                onAddClass={form.addClass}
                onClassDragEnd={form.handleClassDragEnd}
                renderSortableClassRow={(value, index) => (
                  <SortableClassRow
                    key={value}
                    value={value}
                    index={index}
                    isPrimary={index === 0}
                    onRemove={() =>
                      form.setClassList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                    }
                  />
                )}
                onBioChange={form.setBio}
                onSaveProfile={mutations.saveProfile}
                savePending={mutations.saveProfileMutation.isPending}
                isDirty={form.isDirty}
                fieldBioPlaceholder={t("field.bio")}
                videoDraft={form.videoDraft}
                videoList={form.videoList}
                imageList={form.imageList}
                avatarKey={profile?.avatar_key ?? null}
                profileAudioKey={profile?.audio_key ?? null}
                imageUploader={imageUploader}
                audioUploader={audioUploader}
                avatarUploading={avatarUploadMutation.isPending}
                onVideoDraftChange={form.setVideoDraft}
                onAddVideoUrl={form.addVideoUrl}
                onMoveVideo={(index, delta) =>
                  form.setVideoList((current) => moveListItem(current, index, delta))
                }
                onRemoveVideo={(index) =>
                  form.setVideoList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                }
                onUploadImages={() => {
                  void mutations.uploadImages();
                }}
                onUploadAudio={() => {
                  void mutations.uploadAudio();
                }}
                onUploadAvatar={(file) => avatarUploadMutation.mutate(file)}
                onRemoveAvatar={() => avatarDeleteMutation.mutate()}
                onReorderImages={form.setImageList}
                onRemoveImage={mutations.removeImage}
                onRemoveAudio={mutations.removeAudio}
              />
            </Tabs.Panel>

            <Tabs.Panel value="availability" pt="md">
              <ProfileAvailabilityTab
                userId={user?.id}
                availabilityData={form.availabilityData}
                onAvailabilityChange={form.setAvailabilityData}
                onSaveAvailability={mutations.saveProfile}
                savePending={mutations.saveProfileMutation.isPending}
                isDirty={form.isDirty}
              />
            </Tabs.Panel>

            <Tabs.Panel value="onboarding" pt="md">
              <MemberOnboardingCard
                onboarding={onboardingQuery.data ?? null}
                loading={onboardingQuery.isLoading}
                updating={onboardingMutations.updateOnboardingProgressMutation.isPending}
                acknowledging={onboardingMutations.acknowledgeOnboardingMutation.isPending}
                onProgressChange={(completedItemIds) => onboardingMutations.updateOnboardingProgressMutation.mutate({ completed_item_ids: completedItemIds })}
                onAcknowledge={() => onboardingMutations.acknowledgeOnboardingMutation.mutate()}
              />
            </Tabs.Panel>

            <Tabs.Panel value="account" pt="md">
              <ProfileAccountTab
                currentPassword={form.currentPassword}
                newPassword={form.newPassword}
                confirmNewPassword={form.confirmNewPassword}
                currentPasswordForUsername={form.currentPasswordForUsername}
                newUsername={form.newUsername}
                onCurrentPasswordChange={form.setCurrentPassword}
                onNewPasswordChange={form.setNewPassword}
                onConfirmNewPasswordChange={form.setConfirmNewPassword}
                onCurrentPasswordForUsernameChange={form.setCurrentPasswordForUsername}
                onNewUsernameChange={form.setNewUsername}
                onChangePassword={mutations.changePassword}
                onChangeUsername={mutations.changeUsername}
                onLogout={mutations.logout}
                changePasswordLabel={t("button.changePassword")}
                changeUsernameLabel={t("button.changeUsername")}
                changePasswordPending={mutations.changePasswordMutation.isPending}
                changeUsernamePending={mutations.changeUsernameMutation.isPending}
              />
            </Tabs.Panel>
          </Tabs>
        </Grid.Col>
      </Grid>
      )}
    </PageLayout>
  );
}
