// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RecurringTemplatesTab } from "./RecurringTemplatesTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

describe("RecurringTemplatesTab", () => {
  it("opens its create form directly from the empty state", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <RecurringTemplatesTab
          canManage
          templates={[]}
          loading={false}
          formSaving={false}
          onCreateTemplate={vi.fn().mockResolvedValue(undefined)}
          onUpdateTemplate={vi.fn().mockResolvedValue(undefined)}
          onPauseTemplate={vi.fn().mockResolvedValue(undefined)}
          onResumeTemplate={vi.fn().mockResolvedValue(undefined)}
          onDeleteTemplate={vi.fn().mockResolvedValue(undefined)}
        />
      </MantineProvider>,
    );

    await user.click(screen.getByRole("button", { name: "recurring.create" }));

    expect(await screen.findByRole("dialog", { name: "recurring.create" })).toBeInTheDocument();
  });
});
