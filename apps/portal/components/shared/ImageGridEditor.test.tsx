// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageGridEditor } from "./ImageGridEditor";

function renderEditor(items: Array<{ id: string; src?: string }>) {
  render(
    <MantineProvider>
      <ImageGridEditor
        items={items}
        onReorder={vi.fn()}
        onFilesSelected={vi.fn()}
        aria-label="Attachments"
      />
    </MantineProvider>,
  );
}

describe("ImageGridEditor", () => {
  it("centers the upload control when the grid is empty", () => {
    renderEditor([]);

    expect(screen.getByRole("group", { name: "Attachments" })).toHaveStyle({
      justifyContent: "center",
    });
  });

  it("keeps populated grids aligned to the start", () => {
    renderEditor([{ id: "attachment-1" }]);

    expect(screen.getByRole("group", { name: "Attachments" })).toHaveStyle({
      justifyContent: "flex-start",
    });
  });
});
