// @vitest-environment jsdom
import type { GalleryItem } from "@guild/shared";
import { MantineProvider } from "@mantine/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { GalleryLightboxModal } from "./GalleryLightboxModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "modal.lightbox.title": "Gallery preview",
      "aria.prevItem": "Previous item",
      "aria.nextItem": "Next item",
      "common:action.close": "Close",
    })[key] ?? key,
  }),
}));

const item: GalleryItem = {
  id: "gallery-1",
  type: "image",
  media_id: "image1234567890abcdef",
  url: null,
  caption: "Guild victory",
  uploaded_by: "user-1",
  uploaded_by_name: "Member",
  created_at: "2026-07-29T00:00:00.000Z",
};

function Harness() {
  const [opened, setOpened] = useState(false);

  return (
    <MantineProvider>
      <button type="button" onClick={() => setOpened(true)}>
        Open gallery
      </button>
      <GalleryLightboxModal
        open={opened}
        item={opened ? item : null}
        index={0}
        total={1}
        zoom={1}
        onClose={() => setOpened(false)}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        setZoom={vi.fn()}
        resolveImageUrl={(value) => value}
        toEmbedVideoUrl={(value) => value}
        formatDateTime={() => "July 29"}
        isExternalView={false}
      />
    </MantineProvider>
  );
}

describe("GalleryLightboxModal", () => {
  it("leaves overlay geometry and stacking to Mantine", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/GalleryPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const overlayRule = styles.match(/\.gallery-lb-overlay\s*\{([^}]*)\}/)?.[1];
    const contentRule = styles.match(/\.gallery-lb-content\s*\{([^}]*)\}/)?.[1];

    expect(overlayRule).toBeDefined();
    expect(overlayRule).toContain("background:");
    expect(overlayRule).toContain("backdrop-filter:");
    expect(overlayRule).not.toMatch(
      /\b(?:position|inset|z-index|display|align-items|justify-content)\s*:/,
    );
    expect(contentRule).toBeDefined();
    expect(contentRule).not.toMatch(/\bz-index\s*:/);
  });

  it("gives the fixed-curtain controls clear surfaces and keyboard focus", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/GalleryPage.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const closeRule = styles.match(/\.gallery-lb__close\s*\{([^}]*)\}/)?.[1] ?? "";
    const navRule = styles.match(/\.gallery-lb__nav\s*\{([^}]*)\}/)?.[1] ?? "";
    const closeFocusRule = styles.match(
      /\.gallery-lb__close:focus-visible\s*\{([^}]*)\}/,
    )?.[1] ?? "";
    const navFocusRule = styles.match(
      /\.gallery-lb__nav:focus-visible\s*\{([^}]*)\}/,
    )?.[1] ?? "";

    expect(closeRule).toContain("background: rgba(255, 255, 255, 0.2)");
    expect(closeRule).toContain("border: 1px solid rgba(255, 255, 255, 0.1)");
    expect(closeRule).toContain("color: rgb(255 255 255)");
    expect(navRule).toContain("background: rgba(255, 255, 255, 0.18)");
    expect(navRule).toContain("border: 1px solid rgba(255, 255, 255, 0.08)");
    expect(navRule).toContain("color: rgb(255 255 255)");
    expect(closeFocusRule).toContain("outline: 2px solid rgba(255, 255, 255, 0.8)");
    expect(closeFocusRule).toContain("outline-offset: 3px");
    expect(navFocusRule).toContain("outline: 2px solid rgba(255, 255, 255, 0.7)");
    expect(navFocusRule).toContain("outline-offset: 3px");
  });

  it("uses a labelled, focus-trapped dialog that closes with Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open gallery" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "Gallery preview" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).not.toContainElement(screen.queryByRole("banner"));
    expect(await screen.findByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Gallery preview" })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it("keeps the close target at 44px without enlarging its icon", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Open gallery" }));

    const closeButton = await screen.findByRole("button", { name: "Close" });
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/GalleryPage.css"),
      "utf8",
    );
    const closeRule = styles.match(/\.gallery-lb__close\s*\{([^}]*)\}/)?.[1] ?? "";

    expect(closeRule).toContain("width: var(--control-hit-area)");
    expect(closeRule).toContain("height: var(--control-hit-area)");
    expect(closeButton.querySelector("svg")).toHaveAttribute("width", "20");
    expect(closeButton.querySelector("svg")).toHaveAttribute("height", "20");
  });

  it("keeps all mobile metadata above the 4.5:1 white-on-black threshold", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/GalleryPage.css"),
      "utf8",
    );

    for (const className of ["uploader", "date", "count"]) {
      const rule = styles.match(
        new RegExp(`\\.gallery-lb__${className}\\s*\\{([^}]*)\\}`),
      )?.[1] ?? "";
      const alpha = Number(rule.match(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/)?.[1]);

      expect(alpha).toBeGreaterThanOrEqual(0.5);
    }
  });
});
