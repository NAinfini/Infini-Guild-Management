import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

const mocks = vi.hoisted(() => ({
  locale: "en" as "en" | "zh",
  theme: "light" as "light" | "dark",
  accent: "teal" as "teal" | "indigo" | "violet" | "orange",
  setLocale: vi.fn(),
  setTheme: vi.fn(),
  setAccent: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

vi.mock("../../stores/preferences", () => ({
  usePreferencesStore: () => ({
    locale: mocks.locale,
    setLocale: mocks.setLocale,
  }),
}));

vi.mock("../../providers/ThemeProvider", () => ({
  useTheme: () => ({
    theme: mocks.theme,
    setTheme: mocks.setTheme,
    accent: mocks.accent,
    setAccent: mocks.setAccent,
  }),
}));

function renderSettingsPage() {
  return render(<SettingsPage />);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    mocks.locale = "en";
    mocks.theme = "light";
    mocks.accent = "teal";
    mocks.setLocale.mockReset();
    mocks.setTheme.mockReset();
    mocks.setAccent.mockReset();
  });

  it("uses native radio semantics and immediately updates preferences", async () => {
    const user = userEvent.setup();
    const { container } = renderSettingsPage();

    expect(screen.queryByRole("heading", { name: "settings.title" })).not.toBeInTheDocument();
    expect(screen.queryByText("settings.description")).not.toBeInTheDocument();
    expect(container.querySelector(".settings-page__artwork")).toBeNull();

    const appearance = screen.getByRole("group", { name: "section.appearance" });
    const preferences = screen.getByRole("group", { name: "section.preferences" });

    expect(within(appearance).getByRole("radio", { name: /theme\.light/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(within(preferences).getByRole("radio", { name: /locale\.en/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(appearance).getByRole("radio", { name: /theme\.dark/ }));
    await user.click(within(appearance).getByRole("radio", { name: /accent\.indigo/ }));
    await user.click(within(preferences).getByRole("radio", { name: /locale\.zh/ }));

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setAccent).toHaveBeenCalledWith("indigo");
    expect(mocks.setLocale).toHaveBeenCalledWith("zh");
  });

  it("supports arrow-key selection within each radio group", async () => {
    const user = userEvent.setup();
    renderSettingsPage();

    const light = screen.getByRole("radio", { name: /theme\.light/ });
    light.focus();
    await user.keyboard("{ArrowRight}");

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
  });

  it("reflows from container capacity without squeezing option copy", () => {
    const { container } = renderSettingsPage();

    expect(container.querySelector(".settings-page")).not.toBeNull();
    expect(container.querySelectorAll(".settings-choice-grid--binary")).toHaveLength(2);
    expect(container.querySelector(".settings-choice-grid--accent")).not.toBeNull();
    expect(container.querySelectorAll(".settings-option-card__description")).toHaveLength(8);
    expect(container.querySelectorAll(".settings-surface-sample")).toHaveLength(6);
    expect(container.querySelector('.settings-surface-sample[data-theme="light"]')).not.toBeNull();
    expect(container.querySelector('.settings-surface-sample[data-theme="dark"]')).not.toBeNull();
    for (const accent of ["teal", "indigo", "violet", "orange"]) {
      expect(
        container.querySelector(`.settings-surface-sample[data-accent-preview="${accent}"]`),
      ).not.toBeNull();
    }

    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/SettingsPage.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.settings-page\s*\{[^}]*width:\s*100%[^}]*min-height:\s*100%[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*34rem\),\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /\.settings-choice-grid\s*\{[^}]*container-name:\s*settings-options[^}]*container-type:\s*inline-size[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*23rem\),\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /\.settings-option-card\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(12rem,\s*1fr\)\s+auto/s,
    );
    expect(styles).toMatch(
      /@container\s+settings-options\s*\(max-width:\s*24rem\)[^{]*\{[\s\S]*?\.settings-option-card\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(styles).not.toContain("1.35fr");
    expect(styles).not.toContain("minmax(18rem, 0.65fr)");
    expect(styles).toContain(":has([data-checked])");

    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/SettingsPage.tsx"),
      "utf8",
    );
    expect(source.toLowerCase()).not.toContain(["man", "tine"].join(""));
  });
});
