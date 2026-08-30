import { DEFAULT_SITE_MEDIA_POLICY } from "@guild/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSiteConfigStore } from "../../../stores/site-config";
import { useAdminMemberMediaController } from "./useAdminMemberMediaController";

const notificationMocks = vi.hoisted(() => ({
  show: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  deleteProfileAudio: vi.fn(),
  deleteProfileImage: vi.fn(),
  updateMyProfile: vi.fn(),
  updateOwnProfile: vi.fn(),
  uploadProfileAudio: vi.fn(),
  uploadProfileImages: vi.fn(),
}));

const uploaderMocks = vi.hoisted(() => {
  type UploadFunction = (files: File[]) => Promise<unknown>;
  const createUploader = () => {
    let uploadFunction: UploadFunction | null = null;
    const uploader = {
      files: [] as File[],
      supportError: null,
      isUploading: false,
      isConverting: false,
      conversionProgress: 0,
      uploadProgress: 0,
      error: null,
      result: null,
      selectFiles: vi.fn((source: FileList | File[] | null) => {
        uploader.files = source ? Array.from(source) : [];
      }),
      clearFiles: vi.fn(() => {
        uploader.files = [];
      }),
      upload: vi.fn(async () => {
        if (!uploadFunction) throw new Error("Missing upload function");
        return uploadFunction(uploader.files);
      }),
      reset: vi.fn(() => {
        uploader.files = [];
      }),
    };
    return {
      uploader,
      setUploadFunction: (nextUploadFunction: UploadFunction) => {
        uploadFunction = nextUploadFunction;
      },
    };
  };
  return {
    image: createUploader(),
    audio: createUploader(),
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../../utils/notifications", () => ({
  notifySuccess: notificationMocks.show,
}));

vi.mock("../../../services/UserService", () => ({
  deleteProfileAudio: serviceMocks.deleteProfileAudio,
  deleteProfileImage: serviceMocks.deleteProfileImage,
  updateMyProfile: serviceMocks.updateMyProfile,
  updateOwnProfile: serviceMocks.updateOwnProfile,
  uploadProfileAudio: serviceMocks.uploadProfileAudio,
  uploadProfileImages: serviceMocks.uploadProfileImages,
}));

vi.mock("../../../hooks/useMediaUpload", () => ({
  useMediaUpload: vi.fn((uploadFn: (files: File[]) => Promise<unknown>, options?: { mediaType?: string }) => {
    const target = options?.mediaType === "audio" ? uploaderMocks.audio : uploaderMocks.image;
    target.setUploadFunction(uploadFn);
    return target.uploader;
  }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createMember() {
  return {
    user: {
      id: "user-1",
      display_name: "nainf",
      role: "moderator",
      is_active: true,
      deleted_at: null,
    },
    profile: {
      images: ["image1234567890abcdef", "second1234567890abcde"],
      video_urls: ["https://youtube.com/watch?v=abc"],
      audio_media_id: "audio1234567890abcdef",
      audio_name: "theme.ogg",
    },
  };
}

describe("useAdminMemberMediaController", () => {
  beforeEach(() => {
    useSiteConfigStore.setState({ mediaPolicy: DEFAULT_SITE_MEDIA_POLICY });
    vi.clearAllMocks();
    uploaderMocks.image.uploader.files = [];
    uploaderMocks.audio.uploader.files = [];
  });

  it("keeps an administrator's target video and image baselines across background refreshes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    const member = createMember();
    const backgroundMember = {
      ...member,
      profile: {
        ...member.profile,
        video_urls: ["https://vimeo.com/server-change"],
      },
    };

    const { result, rerender } = renderHook(
      ({ target, profileRevisionToken }) => useAdminMemberMediaController({
        member: target as never,
        currentUserId: "admin-1",
        profileRevisionToken,
        onProfileRevision,
        onRefresh,
        onError,
      }),
      {
        initialProps: { target: member, profileRevisionToken: "profile-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    await act(async () => {
      result.current.addVideoUrl();
      result.current.changeVideoUrl(1, "https://vimeo.com/123");
    });

    expect(result.current.videoUrls).toEqual([
      "https://youtube.com/watch?v=abc",
      "https://vimeo.com/123",
    ]);
    expect(result.current.hasVideoChanges).toBe(true);
    serviceMocks.updateMyProfile.mockResolvedValueOnce({
      profile: {
        user_id: "user-1",
        video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"],
      },
      profileRevisionToken: "profile-v2",
    });
    rerender({ target: backgroundMember, profileRevisionToken: "profile-background-v9" });

    await act(async () => {
      await result.current.saveVideoUrls();
    });

    expect(serviceMocks.updateMyProfile).toHaveBeenCalledWith("user-1", {
      video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"],
    }, "profile-v1");
    await waitFor(() => expect(onProfileRevision).toHaveBeenCalledWith("user-1", "profile-v2"));

    serviceMocks.updateMyProfile.mockResolvedValueOnce({
      profile: { user_id: "user-1", video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"] },
      profileRevisionToken: "profile-v3",
    });
    rerender({ target: backgroundMember, profileRevisionToken: "profile-v1" });
    rerender({ target: backgroundMember, profileRevisionToken: "profile-background-v10" });
    act(() => result.current.reorderImages([
      { id: "second1234567890abcde", src: "/api/media/second1234567890abcde/view" },
      { id: "image1234567890abcdef", src: "/api/media/image1234567890abcdef/view" },
    ]));
    await waitFor(() => expect(serviceMocks.updateMyProfile).toHaveBeenLastCalledWith("user-1", {
      images: ["second1234567890abcde", "image1234567890abcdef"],
    }, "profile-background-v10"));
    expect(onRefresh).toHaveBeenCalled();
    expect(notificationMocks.show).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps a self media draft on its editor-open revision across a background refresh", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    const initialMember = createMember();
    const backgroundMember = {
      ...initialMember,
      profile: {
        ...initialMember.profile,
        video_urls: ["https://vimeo.com/server-change"],
      },
    };
    serviceMocks.updateOwnProfile
      .mockResolvedValueOnce({
        profile: {
          user_id: "user-1",
          video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"],
        },
        profileRevisionToken: "profile-v2",
      })
      .mockResolvedValueOnce({
        profile: {
          user_id: "user-1",
          video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"],
        },
        profileRevisionToken: "profile-v3",
      });

    const { result, rerender } = renderHook(
      ({ member, profileRevisionToken }) => useAdminMemberMediaController({
        member: member as never,
        currentUserId: "user-1",
        profileRevisionToken,
        onProfileRevision,
        onRefresh,
        onError,
      }),
      {
        initialProps: { member: initialMember, profileRevisionToken: "profile-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    await act(async () => {
      result.current.addVideoUrl();
      result.current.changeVideoUrl(1, "https://vimeo.com/123");
    });
    rerender({ member: backgroundMember, profileRevisionToken: "profile-background-v9" });

    expect(result.current.videoUrls).toEqual([
      "https://youtube.com/watch?v=abc",
      "https://vimeo.com/123",
    ]);

    await act(async () => {
      await result.current.saveVideoUrls();
    });
    expect(serviceMocks.updateOwnProfile).toHaveBeenNthCalledWith(
      1,
      "user-1",
      { video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"] },
      "profile-v1",
    );
    await waitFor(() => expect(onProfileRevision).toHaveBeenNthCalledWith(1, "user-1", "profile-v2"));

    rerender({ member: backgroundMember, profileRevisionToken: "profile-v1" });

    act(() => {
      result.current.reorderImages([
        { id: "second1234567890abcde", src: "/api/media/second1234567890abcde/view" },
        { id: "image1234567890abcdef", src: "/api/media/image1234567890abcdef/view" },
      ]);
    });
    await waitFor(() => expect(serviceMocks.updateOwnProfile).toHaveBeenCalledTimes(2));

    expect(serviceMocks.updateOwnProfile).toHaveBeenNthCalledWith(
      2,
      "user-1",
      { images: ["second1234567890abcde", "image1234567890abcdef"] },
      "profile-v2",
    );
    serviceMocks.updateOwnProfile.mockResolvedValueOnce({
      profile: { user_id: "user-1", video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"] },
      profileRevisionToken: "profile-v4",
    });
    rerender({ member: backgroundMember, profileRevisionToken: "profile-fresh-v3" });
    act(() => result.current.reorderImages([
      { id: "image1234567890abcdef", src: "/api/media/image1234567890abcdef/view" },
      { id: "second1234567890abcde", src: "/api/media/second1234567890abcde/view" },
    ]));
    await waitFor(() => expect(serviceMocks.updateOwnProfile).toHaveBeenNthCalledWith(
      3,
      "user-1",
      { images: ["image1234567890abcdef", "second1234567890abcde"] },
      "profile-fresh-v3",
    ));
    expect(serviceMocks.updateMyProfile).not.toHaveBeenCalled();
    expect(onProfileRevision).toHaveBeenNthCalledWith(1, "user-1", "profile-v2");
    expect(onProfileRevision).toHaveBeenNthCalledWith(2, "user-1", "profile-v3");
    expect(onError).not.toHaveBeenCalled();
  });

  it("adopts the current self token after a video draft is reverted", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const member = createMember();
    const backgroundMember = {
      ...member,
      profile: { ...member.profile, video_urls: ["https://vimeo.com/server-change"] },
    };
    serviceMocks.updateOwnProfile.mockResolvedValueOnce({
      profile: { user_id: "user-1", video_urls: ["https://youtube.com/watch?v=abc"] },
      profileRevisionToken: "profile-v10",
    });

    const { result, rerender } = renderHook(
      ({ target, profileRevisionToken }) => useAdminMemberMediaController({
        member: target as never,
        currentUserId: "user-1",
        profileRevisionToken,
        onRefresh,
        onError,
      }),
      {
        initialProps: { target: member, profileRevisionToken: "profile-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.addVideoUrl();
      result.current.changeVideoUrl(1, "https://vimeo.com/123");
    });
    rerender({ target: backgroundMember, profileRevisionToken: "profile-background-v9" });
    expect(result.current.hasVideoChanges).toBe(true);

    act(() => result.current.removeVideoUrl(1));
    await waitFor(() => expect(result.current.hasVideoChanges).toBe(false));

    await act(async () => {
      await result.current.saveVideoUrls();
    });
    expect(serviceMocks.updateOwnProfile).toHaveBeenCalledWith(
      "user-1",
      { video_urls: ["https://vimeo.com/server-change"] },
      "profile-background-v9",
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("adopts a clean administrator target refresh and keeps a returned media revision ahead of an old response", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    serviceMocks.deleteProfileImage.mockResolvedValueOnce({ ok: true, profileRevisionToken: "profile-v2" });
    serviceMocks.deleteProfileAudio.mockResolvedValueOnce({ ok: true, profileRevisionToken: "profile-v3" });
    const initialMember = createMember();
    const backgroundMember = {
      ...initialMember,
      profile: {
        ...initialMember.profile,
        images: ["second1234567890abcde"],
      },
    };

    const { result, rerender } = renderHook(
      ({ member, profileRevisionToken }) => useAdminMemberMediaController({
        member: member as never,
        currentUserId: "admin-1",
        profileRevisionToken,
        onProfileRevision,
        onRefresh,
        onError,
      }),
      {
        initialProps: { member: initialMember, profileRevisionToken: "profile-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    rerender({ member: backgroundMember, profileRevisionToken: "profile-background-v9" });
    act(() => result.current.deleteImage({
      id: "image1234567890abcdef",
      src: "/api/media/image1234567890abcdef/view",
    }));
    await waitFor(() => expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith(
      "user-1",
      "image1234567890abcdef",
      "profile-background-v9",
    ));
    await waitFor(() => expect(onProfileRevision).toHaveBeenCalledWith("user-1", "profile-v2"));

    rerender({ member: backgroundMember, profileRevisionToken: "profile-background-v9" });
    act(() => result.current.deleteAudio());
    await waitFor(() => expect(serviceMocks.deleteProfileAudio).toHaveBeenCalledWith("user-1", "profile-v2"));
    expect(onError).not.toHaveBeenCalled();
  });

  it("blocks queued image and audio uploads after the selected member changes", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    const memberA = createMember();
    const memberB = {
      ...createMember(),
      user: { ...createMember().user, id: "user-2", display_name: "B" },
    };
    const image = new File(["image"], "a.webp", { type: "image/webp" });
    const audio = new File(["audio"], "a.ogg", { type: "audio/ogg" });
    serviceMocks.uploadProfileImages.mockResolvedValue({
      media_ids: ["a-image"],
      profileRevisionToken: "a-v2",
    });
    serviceMocks.uploadProfileAudio.mockResolvedValue({
      media_id: "a-audio",
      profileRevisionToken: "a-v3",
    });

    const { result, rerender } = renderHook(
      ({ member, profileRevisionToken }) => useAdminMemberMediaController({
        member: member as never,
        currentUserId: "admin-1",
        profileRevisionToken,
        onProfileRevision,
        onRefresh,
        onError,
      }),
      {
        initialProps: { member: memberA, profileRevisionToken: "a-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.imageUploader.selectFiles([image]);
      result.current.audioUploader.selectFiles([audio]);
    });
    rerender({ member: memberB, profileRevisionToken: "b-v1" });

    await act(async () => {
      await result.current.uploadImages();
      await result.current.uploadAudio();
    });

    expect(serviceMocks.uploadProfileImages).not.toHaveBeenCalled();
    expect(serviceMocks.uploadProfileAudio).not.toHaveBeenCalled();
    expect(onProfileRevision).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("adopts the deferred administrator snapshot and revision together after a video draft is reverted", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const memberA = createMember();
    const memberC = {
      ...memberA,
      profile: {
        ...memberA.profile,
        images: ["c-image1234567890abcdef"],
        video_urls: ["https://vimeo.com/server-c"],
      },
    };
    serviceMocks.updateMyProfile.mockResolvedValue({
      profile: {
        user_id: "user-1",
        video_urls: ["https://vimeo.com/server-c"],
      },
      profileRevisionToken: "profile-v3",
    });

    const { result, rerender } = renderHook(
      ({ member, profileRevisionToken }) => useAdminMemberMediaController({
        member: member as never,
        currentUserId: "admin-1",
        profileRevisionToken,
        onRefresh,
        onError,
      }),
      {
        initialProps: { member: memberA, profileRevisionToken: "profile-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => {
      result.current.addVideoUrl();
      result.current.changeVideoUrl(1, "https://vimeo.com/local-b");
    });
    rerender({ member: memberC, profileRevisionToken: "profile-v2" });
    act(() => result.current.removeVideoUrl(1));

    await waitFor(() => expect(result.current.videoUrls).toEqual(["https://vimeo.com/server-c"]));
    expect(result.current.imageItems.map((item) => item.id)).toEqual(["c-image1234567890abcdef"]);

    await act(async () => {
      await result.current.saveVideoUrls();
    });

    expect(serviceMocks.updateMyProfile).toHaveBeenCalledWith(
      "user-1",
      { video_urls: ["https://vimeo.com/server-c"] },
      "profile-v2",
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps an in-flight media callback bound to its original member", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    const removal = deferred<{ ok: true; profileRevisionToken: string }>();
    const memberA = createMember();
    const memberB = {
      ...createMember(),
      user: { ...createMember().user, id: "user-2", display_name: "B" },
    };
    serviceMocks.deleteProfileImage.mockReturnValueOnce(removal.promise);

    const { result, rerender } = renderHook(
      ({ member, profileRevisionToken }) => useAdminMemberMediaController({
        member: member as never,
        currentUserId: "admin-1",
        profileRevisionToken,
        onProfileRevision,
        onRefresh,
        onError,
      }),
      {
        initialProps: { member: memberA, profileRevisionToken: "a-v1" },
        wrapper: createWrapper(queryClient),
      },
    );

    act(() => result.current.deleteImage({
      id: "image1234567890abcdef",
      src: "/api/media/image1234567890abcdef/view",
    }));
    await waitFor(() => expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith(
      "user-1",
      "image1234567890abcdef",
      "a-v1",
    ));
    rerender({ member: memberB, profileRevisionToken: "b-v1" });
    removal.resolve({ ok: true, profileRevisionToken: "a-v2" });

    await waitFor(() => expect(onProfileRevision).toHaveBeenCalledWith("user-1", "a-v2"));
    expect(onProfileRevision).not.toHaveBeenCalledWith("user-2", "a-v2");
    expect(onError).not.toHaveBeenCalled();
  });

  it("owns image and audio side effects outside the UI component", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onProfileRevision = vi.fn();
    serviceMocks.updateMyProfile.mockResolvedValueOnce({
      profile: { user_id: "user-1", video_urls: ["https://youtube.com/watch?v=abc"] },
      profileRevisionToken: "profile-v2",
    });
    serviceMocks.deleteProfileImage.mockResolvedValueOnce({ ok: true, profileRevisionToken: "profile-v3" });
    serviceMocks.uploadProfileImages.mockResolvedValueOnce({ media_ids: ["third1234567890abcdef"], profileRevisionToken: "profile-v4" });
    serviceMocks.uploadProfileAudio.mockResolvedValueOnce({ media_id: "audio234567890abcdef", profileRevisionToken: "profile-v5" });
    serviceMocks.deleteProfileAudio.mockResolvedValueOnce({ ok: true, profileRevisionToken: "profile-v6" });
    const member = createMember();

    const { result } = renderHook(
      () =>
        useAdminMemberMediaController({
          member: member as never,
          currentUserId: "admin-1",
          profileRevisionToken: "profile-v1",
          onProfileRevision,
          onRefresh,
          onError,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.imageItems).toHaveLength(2);
    });

    await act(async () => {
      result.current.reorderImages([
        { id: "second1234567890abcde", src: "/api/media/second1234567890abcde/view" },
        { id: "image1234567890abcdef", src: "/api/media/image1234567890abcdef/view" },
      ]);
    });
    await waitFor(() => expect(serviceMocks.updateMyProfile).toHaveBeenCalledWith("user-1", {
      images: ["second1234567890abcde", "image1234567890abcdef"],
    }, "profile-v1"));
    await waitFor(() => expect(onProfileRevision).toHaveBeenCalledWith("user-1", "profile-v2"));

    await act(async () => {
      result.current.deleteImage({
        id: "image1234567890abcdef",
        src: "/api/media/image1234567890abcdef/view",
      });
    });
    await waitFor(() => expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith(
      "user-1",
      "image1234567890abcdef",
      "profile-v2",
    ));
    await waitFor(() => expect(onProfileRevision).toHaveBeenCalledWith("user-1", "profile-v3"));

    act(() => {
      result.current.imageUploader.selectFiles([new File(["image"], "third.webp", { type: "image/webp" })]);
      result.current.audioUploader.selectFiles([new File(["audio"], "theme.ogg", { type: "audio/ogg" })]);
    });
    await act(async () => {
      await result.current.uploadImages();
      await result.current.uploadAudio();
    });

    await act(async () => {
      result.current.deleteAudio();
    });

    expect(uploaderMocks.image.uploader.upload).toHaveBeenCalled();
    expect(uploaderMocks.image.uploader.reset).toHaveBeenCalled();
    expect(uploaderMocks.audio.uploader.upload).toHaveBeenCalled();
    expect(uploaderMocks.audio.uploader.reset).toHaveBeenCalled();
    await waitFor(() => expect(serviceMocks.deleteProfileAudio).toHaveBeenCalledWith("user-1", "profile-v5"));
    expect(onRefresh).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
