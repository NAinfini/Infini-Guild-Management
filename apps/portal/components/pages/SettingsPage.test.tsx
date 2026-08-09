// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MantineProvider } from "@mantine/core";
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

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
  return render(
    <MantineProvider>
      <SettingsPage />
    </MantineProvider>,
  );
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

  it("preserves fieldset names, pressed state, and immediate preference updates", async () => {
    const user = userEvent.setup();
    renderSettingsPage();

    const appearance = screen.getByRole("group", { name: "section.appearance" });
    const preferences = screen.getByRole("group", { name: "section.preferences" });

    expect(within(appearance).getByRole("button", { name: /theme\.light/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(preferences).getByRole("button", { name: /locale\.en/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(appearance).getByRole("button", { name: /theme\.dark/ }));
    await user.click(within(appearance).getByRole("button", { name: /accent\.indigo/ }));
    await user.click(within(preferences).getByRole("button", { name: /locale\.zh/ }));

    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setAccent).toHaveBeenCalledWith("indigo");
    expect(mocks.setLocale).toHaveBeenCalledWith("zh");
  });

  it("uses the bounded responsive two-choice and accent layouts", () => {
    const { container } = renderSettingsPage();

    expect(container.querySelector(".settings-page")).not.toBeNull();
    expect(container.querySelectorAll(".settings-choice-grid--binary")).toHaveLength(2);
    expect(container.querySelector(".settings-choice-grid--accent")).not.toBeNull();
    expect(container.querySelectorAll(".settings-option-card__description")).toHaveLength(8);

    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/SettingsPage.css"),
      "utf8",
    );
    expect(styles).toMatch(
      /\.settings-page\s*\{[^}]*width:\s*100%[^}]*max-width:\s*60rem[^}]*margin-inline:\s*auto[^}]*container-type:\s*inline-size/s,
    );
    expect(styles).toMatch(
      /\.settings-choice-grid--accent\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /@container\s*\(min-width:\s*48rem\)[^{]*\{[\s\S]*?\.settings-choice-grid--accent\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*30rem\)[^{]*\{[\s\S]*?\.settings-option-card__description\s*\{[^}]*display:\s*none/,
    );
  });
});
