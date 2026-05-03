// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@mantine/notifications", () => ({
  notifications: notificationMocks,
}));

vi.mock("../../../api/mutations/users", () => ({
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
      username: "nainf",
      role: "moderator",
      is_active: true,
      deleted_at: null,
    },
    profile: {
      images: ["https://cdn.example.com/one.webp", "https://cdn.example.com/two.webp"],
      video_urls: ["https://youtube.com/watch?v=abc"],
      audio_key: "https://cdn.example.com/audio.opus",
    },
  };
}

describe("useAdminMemberMediaController", () => {
  beforeEach(() => {
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
        { id: "https://cdn.example.com/two.webp", src: "https://cdn.example.com/two.webp" },
        { id: "https://cdn.example.com/one.webp", src: "https://cdn.example.com/one.webp" },
      ]);
    });

    await act(async () => {
      result.current.deleteImage({
        id: "https://cdn.example.com/one.webp",
        src: "https://cdn.example.com/one.webp",
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
      images: ["https://cdn.example.com/two.webp", "https://cdn.example.com/one.webp"],
    });
    expect(serviceMocks.deleteProfileImage).toHaveBeenCalledWith(
      "user-1",
      "https://cdn.example.com/one.webp",
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
