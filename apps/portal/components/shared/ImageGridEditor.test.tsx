import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageGridEditor } from "./ImageGridEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => ({
      "media.aria.addImages": "Localized add images",
      "media.aria.deleteItem": `Localized delete ${options?.name}`,
    })[key] ?? key,
  }),
}));

describe("ImageGridEditor", () => {
  it("uses localized accessible names for upload and delete actions", () => {
    render(
      <ImageGridEditor
        items={[{ id: "attachment-1", alt: "Raid portrait" }]}
        maxImages={2}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        onFilesSelected={vi.fn()}
        aria-label="Attachments"
      />,
    );

    expect(screen.getByRole("button", { name: "Localized add images" })).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", {
      name: "Localized delete Raid portrait",
    });
    expect(deleteButton).toBeInTheDocument();
  });

  it("only disables the delete action for the image being removed", () => {
    render(
      <ImageGridEditor
        items={[
          { id: "attachment-1", alt: "First image" },
          { id: "attachment-2", alt: "Second image" },
        ]}
        maxImages={2}
        onReorder={vi.fn()}
        onDelete={vi.fn()}
        deletingIds={new Set(["attachment-1"])}
        aria-label="Attachments"
      />,
    );

    expect(screen.getByRole("button", {
      name: "Localized delete First image",
    })).toBeDisabled();
    expect(screen.getByRole("button", {
      name: "Localized delete Second image",
    })).toBeEnabled();
  });

  it("does not swallow errors thrown by the rejected-file callback", () => {
    const consumerError = new Error("consumer error");
    const onError = vi.fn(() => {
      throw consumerError;
    });
    const { container } = render(
      <ImageGridEditor
        items={[]}
        maxImages={2}
        allowedTypes={["image/webp"]}
        onError={onError}
        onReorder={vi.fn()}
        onFilesSelected={vi.fn()}
        aria-label="Attachments"
      />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    let reported: unknown;
    const captureError = (event: ErrorEvent) => {
      reported = event.error;
      event.preventDefault();
    };
    window.addEventListener("error", captureError);

    fireEvent.change(input!, {
      target: { files: [new File(["bad"], "bad.png", { type: "image/png" })] },
    });
    window.removeEventListener("error", captureError);

    expect(onError).toHaveBeenCalledOnce();
    expect(reported).toBe(consumerError);
  });
});
