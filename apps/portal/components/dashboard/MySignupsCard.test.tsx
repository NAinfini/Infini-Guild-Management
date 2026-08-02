// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { describe, expect, it, vi } from "vitest";
import { MySignupsCard } from "./MySignupsCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) => key,
  }),
}));

describe("MySignupsCard", () => {
  it("turns the empty signup state into a direct path to events", async () => {
    const onBrowseEvents = vi.fn();
    render(
      <MantineProvider>
        <MySignupsCard
          mySignupEvents={[]}
          now={new Date("2026-08-01T12:00:00.000Z")}
          onOpenEvent={vi.fn()}
          onBrowseEvents={onBrowseEvents}
        />
      </MantineProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "card.mySignups.browseEvents" }),
    );
    expect(onBrowseEvents).toHaveBeenCalledOnce();
  });
});
