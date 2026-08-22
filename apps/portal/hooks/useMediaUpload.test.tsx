import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMediaUpload } from "./useMediaUpload";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useMediaUpload", () => {
  it("locks synchronously so two upload calls share one request and releases after settle", async () => {
    const first = deferred<string>();
    const uploadFn = vi.fn<(
      files: File[],
      context: { onUploadProgress: (percent: number) => void },
    ) => Promise<string>>().mockReturnValueOnce(first.promise).mockResolvedValueOnce("retry-ok");
    const { result } = renderHook(() => useMediaUpload<string>(uploadFn));
    act(() => result.current.selectFiles([new File(["x"], "one.txt")]));

    let firstCall!: Promise<string | null>;
    let duplicateCall!: Promise<string | null>;
    act(() => {
      firstCall = result.current.upload();
      duplicateCall = result.current.upload();
    });
    await waitFor(() => expect(uploadFn).toHaveBeenCalledTimes(1));
    await expect(duplicateCall).resolves.toBeNull();

    first.resolve("ok");
    await expect(firstCall).resolves.toBe("ok");
    await waitFor(() => expect(result.current.isUploading).toBe(false));

    act(() => result.current.selectFiles([new File(["y"], "two.txt")]));
    await expect(result.current.upload()).resolves.toBe("retry-ok");
    expect(uploadFn).toHaveBeenCalledTimes(2);
  });
});
