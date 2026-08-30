import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExperienceControls } from "./ExperienceControls";

const mocks = vi.hoisted(() => ({
  setLocale: vi.fn(),
  toggleTheme: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "label.theme": "Theme",
      "label.locale": "Language",
      "locale.option.en": "English",
      "locale.option.en.description": "Use English",
      "locale.option.zh": "Chinese",
      "locale.option.zh.description": "Use Chinese",
      "nav.openGlobalTools": "Open appearance and language tools",
    })[key] ?? key,
  }),
}));

vi.mock("../../providers/ThemeProvider", () => ({
  useTheme: () => ({
    theme: "dark",
    toggleTheme: mocks.toggleTheme,
  }),
}));

vi.mock("../../stores/preferences", () => ({
  usePreferencesStore: (
    selector: (state: { locale: "en"; setLocale: typeof mocks.setLocale }) => unknown,
  ) => selector({ locale: "en", setLocale: mocks.setLocale }),
}));

describe("ExperienceControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens the compact appearance and language menu", async () => {
    const user = userEvent.setup();
    render(<ExperienceControls compact />);

    await user.click(
      screen.getByRole("button", { name: "Open appearance and language tools" }),
    );

    expect(await screen.findByRole("menuitem", { name: "Theme" })).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "English" })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: "Chinese" })).toBeInTheDocument();
  });
});
