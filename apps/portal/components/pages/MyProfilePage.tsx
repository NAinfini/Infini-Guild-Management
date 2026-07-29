import { Button, Grid, Skeleton, Stack, Tabs } from "@mantine/core";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { uploadProfileAudio, uploadProfileImages } from "../../services/UserService";
import { useBeforeUnloadPrompt } from "../../hooks/useBeforeUnloadPrompt";
import { useProfileData } from "../../hooks/data/useProfileData";
import { useLoadWarningToast } from "../../hooks/useLoadWarningToast";
import { useMediaUpload } from "../../hooks/useMediaUpload";
import { useProfileFormState } from "../../hooks/useProfileFormState";
import { useProfileMutations } from "../../hooks/useProfileMutations";
import { useProfileAvatarMutations } from "../../hooks/useProfileAvatarMutations";
import { useAuthStore } from "../../stores/auth";
import { useAppError } from "../../hooks/useAppError";
import { ProfileAccountTab } from "../feature/profile/ProfileAccountTab";
import { ProfileAvailabilityTab } from "../feature/profile/ProfileAvailabilityTab";
import { ProfileMediaTab } from "../feature/profile/ProfileMediaTab";
import { ProfilePreviewCard } from "../feature/profile/ProfilePreviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { EmptyState } from "../shared/EmptyState";
import { UnsavedChangesAffix } from "../shared/UnsavedChangesAffix";
import { PageLayout } from "../layout/PageLayout";
import "./MyProfilePage.css";

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
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: "profile" | "availability" | "account" };
  const [activeTab, setActiveTab] = useState<"profile" | "media" | "availability" | "account">(search.tab ?? "profile");
  const user = useAuthStore((state) => state.user);

  const { profileQuery } = useProfileData({
    userId: user?.id,
  });
  useLoadWarningToast(
    profileQuery.isError && Boolean(profileQuery.data),
    t("common:loadErrorRetry"),
  );

  const form = useProfileFormState({ profile: profileQuery.data?.profile });
  useBeforeUnloadPrompt(form.isDirty, { allowSamePathNavigation: true });

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
  const { avatarUploadMutation, avatarDeleteMutation } = useProfileAvatarMutations({
    userId: user?.id,
    showError,
  });

  const profile = profileQuery.data?.profile;

  return (
    <PageLayout className="my-profile-page">
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
      ) : profileQuery.isError && !profileQuery.data ? (
        <EmptyState
          status="error"
          title={t("common:loadError")}
          description={t("common:errors.connectionIssue")}
          actions={(
            <Button
              loading={profileQuery.isFetching}
              onClick={() => {
                void profileQuery.refetch();
              }}
            >
              {t("common:action.retry")}
            </Button>
          )}
        />
      ) : (
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 3 }}>
          <div className="my-profile-preview-rail">
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
          <Tabs
            value={activeTab}
            keepMounted={false}
            className="my-profile-page__tabs"
            onChange={(nextTab) => {
              const tab = (nextTab as "profile" | "media" | "availability" | "account" | null) ?? "profile";
              setActiveTab(tab);
              void navigate({
                to: "/profile",
                search: { tab: tab === "availability" || tab === "account" ? tab : undefined },
                replace: true,
                viewTransition: false,
              });
            }}
          >
            <Tabs.List>
              <Tabs.Tab value="profile">{t("tab.profile")}</Tabs.Tab>
              <Tabs.Tab value="media">{t("tab.media")}</Tabs.Tab>
              <Tabs.Tab value="availability">{t("tab.availability")}</Tabs.Tab>
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
                onPowerChange={form.setPower}
                onClassDraftChange={form.setClassDraft}
                onAddClass={form.addClass}
                onClassDragEnd={form.handleClassDragEnd}
                onRemoveClass={form.removeClass}
                onBioChange={form.setBio}
              />
            </Tabs.Panel>

            <Tabs.Panel value="media" pt="md">
              <ProfileMediaTab
                avatarKey={profile?.avatar_key ?? null}
                profileAudioKey={profile?.audio_key ?? null}
                imageList={form.imageList}
                videoDraft={form.videoDraft}
                videoList={form.videoList}
                imageUploader={imageUploader}
                audioUploader={audioUploader}
                avatarUploading={avatarUploadMutation.isPending}
                onUploadAvatar={(file) => avatarUploadMutation.mutate(file)}
                onRemoveAvatar={() => avatarDeleteMutation.mutate()}
                onReorderImages={form.setImageList}
                onRemoveImage={mutations.removeImage}
                onUploadImages={() => {
                  void mutations.uploadImages();
                }}
                onVideoDraftChange={form.setVideoDraft}
                onAddVideoUrl={form.addVideoUrl}
                onMoveVideo={(index, delta) =>
                  form.setVideoList((current) => moveListItem(current, index, delta))
                }
                onRemoveVideo={(index) =>
                  form.setVideoList((current) => current.filter((_, valueIndex) => valueIndex !== index))
                }
                onUploadAudio={() => {
                  void mutations.uploadAudio();
                }}
                onRemoveAudio={mutations.removeAudio}
              />
            </Tabs.Panel>

            <Tabs.Panel value="availability" pt="md">
              <ProfileAvailabilityTab
                userId={user?.id}
                availabilityData={form.availabilityData}
                onAvailabilityChange={form.setAvailabilityData}
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
                changePasswordPending={mutations.changePasswordMutation.isPending}
                changeUsernamePending={mutations.changeUsernameMutation.isPending}
              />
            </Tabs.Panel>
          </Tabs>
          <UnsavedChangesAffix
            isDirty={form.isDirty}
            saving={mutations.saveProfileMutation.isPending}
            onSave={mutations.saveProfile}
          />
        </Grid.Col>
      </Grid>
      )}
    </PageLayout>
  );
}
