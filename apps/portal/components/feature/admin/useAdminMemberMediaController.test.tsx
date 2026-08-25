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
  uploadProfileAudio: vi.fn(),
  uploadProfileImages: vi.fn(),
}));

const uploaderMocks = vi.hoisted(() => {
  const createUploader = () => ({
    files: [],
    supportError: null,
    isUploading: false,
    isConverting: false,
    conversionProgress: 0,
    uploadProgress: 0,
    error: null,
    result: null,
    selectFiles: vi.fn(),
    clearFiles: vi.fn(),
    upload: vi.fn().mockResolvedValue({ ok: true }),
    reset: vi.fn(),
  });
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
  uploadProfileAudio: serviceMocks.uploadProfileAudio,
  uploadProfileImages: serviceMocks.uploadProfileImages,
}));

vi.mock("../../../hooks/useMediaUpload", () => ({
  useMediaUpload: vi.fn((_uploadFn: unknown, options?: { mediaType?: string }) =>
    options?.mediaType === "audio" ? uploaderMocks.audio : uploaderMocks.image,
  ),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
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
  });

  it("keeps video edits local until save is requested", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const member = createMember();

    const { result } = renderHook(
      () =>
        useAdminMemberMediaController({
          member: member as never,
          onRefresh,
          onError,
        }),
      { wrapper: createWrapper(queryClient) },
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
    expect(serviceMocks.updateMyProfile).not.toHaveBeenCalled();

    serviceMocks.updateMyProfile.mockResolvedValueOnce({});

    await act(async () => {
      await result.current.saveVideoUrls();
    });

    expect(serviceMocks.updateMyProfile).toHaveBeenCalledWith("user-1", {
      video_urls: ["https://youtube.com/watch?v=abc", "https://vimeo.com/123"],
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(notificationMocks.show).toHaveBeenCalled();
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
    serviceMocks.updateMyProfile.mockResolvedValueOnce({});
    serviceMocks.deleteProfileImage.mockResolvedValueOnce(undefined);
    serviceMocks.deleteProfileAudio.mockResolvedValueOnce(undefined);
    const member = createMember();

    const { result } = renderHook(
      () =>
        useAdminMemberMediaController({
          member: member as never,
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

    await act(async () => {
      result.current.deleteImage({
        id: "image1234567890abcdef",
        src: "/api/media/image1234567890abcdef/view",
      });
    });

    await act(async () => {
      await result.current.uploadImages();
      await result.current.uploadAudio();
    });

    await act(async () => {
      result.current.deleteAudio();
    });

    expect(serviceMocks.updateMyProfile).toHaveBeenCalledWith("user-1", {
      images: ["second1234567890abcde", "image1234567890abcdef"],
    });
    expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith(
      "user-1",
      "image1234567890abcdef",
    );
    expect(uploaderMocks.image.upload).toHaveBeenCalled();
    expect(uploaderMocks.image.reset).toHaveBeenCalled();
    expect(uploaderMocks.audio.upload).toHaveBeenCalled();
    expect(uploaderMocks.audio.reset).toHaveBeenCalled();
    expect(serviceMocks.deleteProfileAudio).toHaveBeenCalledWith("user-1");
    expect(onRefresh).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
