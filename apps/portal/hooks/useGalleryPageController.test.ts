// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { UploadStatus, UploadTask } from "../types/media";
import {
  classifyGalleryUploadFile,
  getVisibleGallerySelection,
  hasUnsavedGalleryMediaDraft,
  removeGalleryUpload,
  restoreCancelledGalleryUpload,
  retryGalleryUpload,
  summarizeGalleryUploadBatch,
} from "./useGalleryPageController";

function uploadTask(id: string, status: UploadStatus): UploadTask {
  return {
    id,
    file: { name: `${id}.png`, type: "image/png", size: 128 } as File,
    title: id,
    description: "",
    status,
    error: status === "error" ? "Upload failed" : undefined,
  };
}

describe("gallery selection", () => {
  it("keeps only selections that are visible in the current result set", () => {
    expect(getVisibleGallerySelection(["visible", "hidden"], ["visible", "other"])).toEqual(["visible"]);
  });
});

describe("gallery upload queue", () => {
  it("distinguishes unfinished image or video drafts from completed uploads", () => {
    expect(hasUnsavedGalleryMediaDraft([], { url: "", title: "", description: "" })).toBe(false);
    expect(hasUnsavedGalleryMediaDraft(
      [uploadTask("queued", "queued")],
      { url: "", title: "", description: "" },
    )).toBe(true);
    expect(hasUnsavedGalleryMediaDraft(
      [uploadTask("done", "done")],
      { url: "", title: "", description: "" },
    )).toBe(false);
    expect(hasUnsavedGalleryMediaDraft(
      [],
      { url: "https://www.youtube.com/watch?v=abc", title: "", description: "" },
    )).toBe(true);
  });

  it("reports both successes and failures for a partially failed batch", () => {
    expect(summarizeGalleryUploadBatch(10, 3)).toEqual({
      total: 10,
      succeeded: 7,
      failed: 3,
    });
  });

  it("classifies supported image MIME types without a hardcoded size limit", () => {
    expect(classifyGalleryUploadFile({ type: "text/plain", size: 128 })).toBe("unsupported");
    expect(classifyGalleryUploadFile({ type: "image/png", size: 64 * 1024 * 1024 })).toBe("queued");
  });

  it("returns a failed upload to the queue without losing its metadata", () => {
    const failed = {
      ...uploadTask("failed", "error"),
      title: "Guild night",
      description: "A clear night at the keep.",
    };

    expect(retryGalleryUpload([failed], failed.id)).toEqual([
      {
        ...failed,
        status: "queued",
        error: undefined,
      },
    ]);
  });

  it("does not retry a file that still fails local validation", () => {
    const unsupported = {
      ...uploadTask("unsupported", "error"),
      file: { name: "notes.txt", type: "text/plain", size: 128 } as File,
    };

    expect(retryGalleryUpload([unsupported], unsupported.id)).toEqual([unsupported]);
  });

  it("removes queued or failed tasks but keeps an active upload", () => {
    const queued = uploadTask("queued", "queued");
    const uploading = uploadTask("uploading", "uploading");

    expect(removeGalleryUpload([queued, uploading], queued.id)).toEqual([uploading]);
    expect(removeGalleryUpload([queued, uploading], uploading.id)).toEqual([queued, uploading]);
  });

  it("returns a cancelled active upload to the queue without changing completed tasks", () => {
    const uploading = uploadTask("uploading", "uploading");
    const done = uploadTask("done", "done");

    expect(restoreCancelledGalleryUpload([uploading, done], uploading.id)).toEqual([
      { ...uploading, status: "queued", error: undefined },
      done,
    ]);
  });
});
