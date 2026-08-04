import { Button, Grid, Skeleton, Stack, Tabs, Text } from "@mantine/core";
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
import { ProfileGapsCallout } from "../feature/profile/ProfileGapsCallout";
import { ProfileMediaTab } from "../feature/profile/ProfileMediaTab";
import { ProfileOverviewCard } from "../feature/profile/ProfileOverviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { ProfileWeekSummary } from "../feature/profile/ProfileWeekSummary";
import { EmptyState } from "../shared/EmptyState";
import { UnsavedChangesAffix } from "../shared/UnsavedChangesAffix";
import { PageLayout } from "../layout/PageLayout";
import "./MyProfilePage.css";

type ProfileTab = "home" | "availability" | "account";

/**
 * `profile` and `media` were separate tabs before they merged into `home`.
 * Links to them exist in chat logs and browser history, so they resolve rather
 * than silently falling through to the default.
 */
function normalizeTab(raw: string | undefined): ProfileTab {
  if (raw === "availability" || raw === "account") return raw;
  return "home";
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
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: string };
  const [activeTab, setActiveTab] = useState<ProfileTab>(normalizeTab(search.tab));
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
  /* 同一个请求已经把这两样带回来了（fetchUserDetail 返回 user/profile/badges）。
     显示用的 user 取这一份而不是会话里那份：角色、加入时间只在这一份上有。 */
  const profileUser = profileQuery.data?.user ?? null;
  const badges = profileQuery.data?.badges ?? [];

  /* A dot on the tab, so unsaved work stays findable after switching away. */
  const renderTabLabel = (label: string, dirty: boolean) => (
    <span className="my-profile-tab-label">
      {label}
      {dirty ? <span className="my-profile-tab-label__dot" aria-label={t("status.unsavedChanges")} /> : null}
    </span>
  );

  return (
    <PageLayout className="my-profile-page">
      {profileQuery.isLoading ? (
        <Grid gap="md">
          <Grid.Col span={{ base: 12, lg: 8 }}>
            <Stack gap={12}>
              <Skeleton height={36} width="50%" radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
              <Skeleton height={48} radius={8} />
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Skeleton height={280} radius={8} />
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
        <Tabs
          value={activeTab}
          keepMounted={false}
          className="my-profile-page__tabs"
          onChange={(nextTab) => {
            const tab = normalizeTab(nextTab ?? undefined);
            setActiveTab(tab);
            void navigate({
              to: "/profile",
              search: { tab: tab === "home" ? undefined : tab },
              replace: true,
              viewTransition: false,
            });
          }}
        >
          {/* 小黄点没有图例就只是一个装饰点。说明放在这一行的另一头，不占编辑区。 */}
          <div className="my-profile-tabbar">
            <Tabs.List>
              <Tabs.Tab value="home">{renderTabLabel(t("tab.home"), form.dirtySections.home)}</Tabs.Tab>
              <Tabs.Tab value="availability">
                {renderTabLabel(t("tab.availability"), form.dirtySections.availability)}
              </Tabs.Tab>
              <Tabs.Tab value="account">{t("tab.account")}</Tabs.Tab>
            </Tabs.List>
            {form.isDirty ? (
              <Text size="xs" c="dimmed" className="my-profile-tabbar__hint">
                {t("tab.dotHint")}
              </Text>
            ) : null}
          </div>

          {/* 三屏共用一个外壳（.my-profile-shell）：同宽、同起点，切屏时卡片的
              左边缘不会跳。只有时间屏带侧栏预览（本周热力图），因为「填了哪些
              时段」光看编辑器数不出来；另外两屏各自的表单已经把自己讲清楚了。 */}
          <Tabs.Panel value="home" pt="md">
            <div className="my-profile-shell">
              {/* 概览条横跨整宽：它讲的是「这个号现在是什么样」，和下面的表单不是
                  同一层，塞进表单里会被读成表单的一部分。空值点名紧跟其后，因为
                  它说的正是这条概览里哪几格还是空的。 */}
              <ProfileOverviewCard
                user={profileUser}
                profile={profile}
                badges={badges}
                power={form.power}
                titleHtml={form.titleHtml}
                classList={form.classList}
                imageList={form.imageList}
                videoList={form.videoList}
                availabilityData={form.availabilityData}
              />
              <ProfileGapsCallout
                avatarKey={profile?.avatar_key ?? null}
                titleHtml={form.titleHtml}
                bio={form.bio}
                classList={form.classList}
                imageList={form.imageList}
                availabilityData={form.availabilityData}
              />

              {/* 主页屏没有预览栏：顶上那条概览已经在讲「现在是什么样」，右边再挂
                  一张同源的名片就是把同一批字段说两遍。表单因此吃满整宽，宽屏时
                  身份和媒体并排（--wide）。 */}
              <div className="my-profile-split__editor my-profile-split__editor--wide">
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
                  removingImageKeys={mutations.removingImageKeys}
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
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="availability" pt="md">
            <div className="my-profile-shell">
              <div className="my-profile-split">
                <div className="my-profile-split__editor">
                  <ProfileAvailabilityTab
                    userId={user?.id}
                    availabilityData={form.availabilityData}
                    onAvailabilityChange={form.setAvailabilityData}
                  />
                </div>
                <aside className="my-profile-split__rail">
                  <ProfileWeekSummary availabilityData={form.availabilityData} />
                </aside>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel value="account" pt="md">
            <div className="my-profile-shell">
              <ProfileAccountTab
                username={profileUser?.username ?? null}
                role={profileUser?.role ?? null}
                joinedAt={profileUser?.created_at ?? null}
                profileUpdatedAt={profile?.updated_at ?? null}
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
            </div>
          </Tabs.Panel>

          <UnsavedChangesAffix
            isDirty={form.isDirty}
            saving={mutations.saveProfileMutation.isPending}
            onSave={mutations.saveProfile}
          />
        </Tabs>
      )}
    </PageLayout>
  );
}
