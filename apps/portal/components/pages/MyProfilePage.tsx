import { Button } from "@portal/components/ui/button";
import { LoadingIndicator } from "@portal/components/ui/loading-indicator";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
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
import { requireSiteMediaPolicy, useSiteConfigStore } from "../../stores/site-config";
import { useAppError } from "../../hooks/useAppError";
import { ProfileAccountTab } from "../feature/profile/ProfileAccountTab";
import { ProfileAvailabilityTab } from "../feature/profile/ProfileAvailabilityTab";
import { ProfileGapsCallout } from "../feature/profile/ProfileGapsCallout";
import { ProfileMediaTab } from "../feature/profile/ProfileMediaTab";
import { ProfileOverviewCard } from "../shared/ProfileOverviewCard";
import { ProfileProfileTab } from "../feature/profile/ProfileProfileTab";
import { ProfileWeekSummary } from "../feature/profile/ProfileWeekSummary";
import { EmptyState } from "../shared/EmptyState";
import { UnsavedChangesAffix } from "../shared/UnsavedChangesAffix";
import { PageSubnav } from "../shared/PageSubnav";
import { PageLayout } from "../layout/PageLayout";
import { notifySuccess } from "../../utils/notifications";
import "./MyProfilePage.css";

type ProfileTab = "home" | "availability" | "account";

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
  const search = useSearch({ strict: false }) as { tab?: string; oauth?: string };
  const activeTab = normalizeTab(search.tab);
  const user = useAuthStore((state) => state.user);
  const mediaPolicy = useSiteConfigStore(requireSiteMediaPolicy);
  const profileImageQuota = mediaPolicy.quotas.profile;

  useEffect(() => {
    if (search.oauth !== "linked") return;
    notifySuccess(t("account.message.oauthLinked"));
    void navigate({
      to: "/profile",
      search: { tab: "account" },
      replace: true,
      viewTransition: false,
    });
  }, [navigate, search.oauth, t]);

  const { profileQuery } = useProfileData({
    userId: user?.id,
  });
  useLoadWarningToast(
    profileQuery.isError && Boolean(profileQuery.data),
    t("common:loadErrorRetry"),
  );

  const form = useProfileFormState({
    profile: profileQuery.data?.profile,
    displayName: profileQuery.data?.user.display_name,
    profileRevisionToken: profileQuery.data?.edit_revisions?.profile_revision_token,
  });
  useBeforeUnloadPrompt(form.isDirty, { allowSamePathNavigation: true });

  const imageUploader = useMediaUpload(
    async (files) => {
      if (!user) {
        throw new Error(t("message.sessionMissing"));
      }
      if (!form.profileRevisionToken) {
        throw new Error("Missing profile revision token");
      }
      return uploadProfileImages(user.id, files, form.profileRevisionToken);
    },
    {
      maxFiles: profileImageQuota,
      mediaType: "image",
    },
  );

  const audioUploader = useMediaUpload(
    async (canonicalAudioFiles) => {
      if (!user) {
        throw new Error(t("message.sessionMissing"));
      }
      const file = canonicalAudioFiles[0];
      if (!file) {
        throw new Error(t("message.audioFileRequired"));
      }
      if (!form.profileRevisionToken) {
        throw new Error("Missing profile revision token");
      }
      return uploadProfileAudio(user.id, file, form.profileRevisionToken);
    },
    {
      maxFiles: 1,
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
    profileRevisionToken: form.profileRevisionToken,
    showError,
    onProfileRevision: form.acceptOwnMediaRevision,
  });

  const profile = profileQuery.data?.profile;
  /* 同一个请求已经把这两样带回来了（fetchUserDetail 返回 user/profile/badges）。
     显示用的 user 取这一份而不是会话里那份：角色、加入时间只在这一份上有。 */
  const profileUser = profileQuery.data?.user ?? null;
  const badges = profileQuery.data?.badges ?? [];

  return (
    <PageLayout
      className="my-profile-page"
      workspaceMode="contained"
      toolbar={(
        <div className="my-profile-tabbar">
          <PageSubnav
            value={activeTab}
            label={t("navigation.section")}
            items={[
              {
                value: "home",
                label: t("tab.home"),
                indicator: form.dirtySections.home ? (
                  <span className="my-profile-tab-label__dot" aria-label={t("status.unsavedChanges")} />
                ) : undefined,
              },
              {
                value: "availability",
                label: t("tab.availability"),
                indicator: form.dirtySections.availability ? (
                  <span className="my-profile-tab-label__dot" aria-label={t("status.unsavedChanges")} />
                ) : undefined,
              },
              { value: "account", label: t("tab.account") },
            ]}
            onChange={(tab) => {
              void navigate({
                to: "/profile",
                search: { tab: tab === "home" ? undefined : tab },
                replace: true,
                viewTransition: false,
              });
            }}
          />
          {form.isDirty ? (
            <span className="my-profile-tabbar__hint">
              {t("tab.dotHint")}
            </span>
          ) : null}
        </div>
      )}
    >
      {profileQuery.isLoading ? (
        <LoadingIndicator />
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
        <div className="my-profile-page__workspace">
          {activeTab === "home" ? (
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
                avatarUploading={avatarUploadMutation.isPending}
                onUploadAvatar={(file) => avatarUploadMutation.mutate(file)}
                onRemoveAvatar={() => avatarDeleteMutation.mutate()}
              />
              <ProfileGapsCallout
                avatarMediaId={profile?.avatar_media_id ?? null}
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
                  roleName={user?.role_name ?? null}
                  roleColor={user?.role_color ?? null}
                  badges={badges}
                  displayName={form.displayName}
                  power={form.power}
                  classDraft={form.classDraft}
                  classOptions={form.classOptions}
                  classList={form.classList}
                  titleHtml={form.titleHtml}
                  onTitleHtmlChange={form.setTitleHtml}
                  onDisplayNameChange={form.setDisplayName}
                  bio={form.bio}
                  onPowerChange={form.setPower}
                  onClassDraftChange={form.setClassDraft}
                  onAddClass={form.addClass}
                  onClassDragEnd={form.handleClassDragEnd}
                  onRemoveClass={form.removeClass}
                  onBioChange={form.setBio}
                />
                <ProfileMediaTab
                  profileAudioMediaId={profile?.audio_media_id ?? null}
                  profileAudioName={profile?.audio_name ?? null}
                  maxImages={profileImageQuota}
                  imageList={form.imageList}
                  videoDraft={form.videoDraft}
                  videoList={form.videoList}
                  imageUploader={imageUploader}
                  audioUploader={audioUploader}
                  onReorderImages={form.setImageList}
                  onRemoveImage={mutations.removeImage}
                  removingImageIds={mutations.removingImageIds}
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
          ) : null}

          {activeTab === "availability" ? (
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
          ) : null}

          {activeTab === "account" ? (
            <div className="my-profile-shell">
              <ProfileAccountTab
                onLogout={mutations.logout}
              />
            </div>
          ) : null}

          <UnsavedChangesAffix
            isDirty={form.isDirty}
            saving={mutations.saveProfileMutation.isPending}
            onSave={mutations.saveProfile}
          />
        </div>
      )}
    </PageLayout>
  );
}
