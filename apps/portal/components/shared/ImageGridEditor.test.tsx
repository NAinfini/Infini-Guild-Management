import { MantineProvider } from "@mantine/core";
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

function renderEditor(items: Array<{ id: string; src?: string }>) {
  render(
    <MantineProvider>
      <ImageGridEditor
        items={items}
        maxImages={2}
        onReorder={vi.fn()}
        onFilesSelected={vi.fn()}
        aria-label="Attachments"
      />
    </MantineProvider>,
  );
}

describe("ImageGridEditor", () => {
  it("keeps the upload control aligned to the start when the grid is empty", () => {
    renderEditor([]);

    expect(screen.getByRole("group", { name: "Attachments" })).toHaveStyle({
      justifyContent: "flex-start",
    });
  });

  it("keeps populated grids aligned to the start", () => {
    renderEditor([{ id: "attachment-1" }]);

    expect(screen.getByRole("group", { name: "Attachments" })).toHaveStyle({
      justifyContent: "flex-start",
    });
  });

  it("uses localized accessible names for upload and delete actions", () => {
    render(
      <MantineProvider>
        <ImageGridEditor
          items={[{ id: "attachment-1", alt: "Raid portrait" }]}
          maxImages={2}
          onReorder={vi.fn()}
          onDelete={vi.fn()}
          onFilesSelected={vi.fn()}
          aria-label="Attachments"
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "Localized add images" })).toBeInTheDocument();
    const deleteButton = screen.getByRole("button", {
      name: "Localized delete Raid portrait",
    });
    expect(deleteButton.getAttribute("style")).toContain(
      "--ai-size: calc(2.75rem * var(--mantine-scale))",
    );
    expect(deleteButton).toHaveStyle({
      top: "-6px",
      right: "-6px",
    });
    const imageSize = 80;
    const gap = 8;
    const hitAreaRightEdge = imageSize - Number.parseFloat(deleteButton.style.right);
    expect(hitAreaRightEdge).toBeLessThanOrEqual(imageSize + gap);
    expect(deleteButton.querySelector(".image-grid-editor__delete-glyph")).toHaveStyle({
      width: "20px",
      height: "20px",
    });
  });

  it("only disables the delete action for the image being removed", () => {
    render(
      <MantineProvider>
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
        />
      </MantineProvider>,
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
      <MantineProvider>
        <ImageGridEditor
          items={[]}
          maxImages={2}
          allowedTypes={["image/webp"]}
          onError={onError}
          onReorder={vi.fn()}
          onFilesSelected={vi.fn()}
          aria-label="Attachments"
        />
      </MantineProvider>,
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
