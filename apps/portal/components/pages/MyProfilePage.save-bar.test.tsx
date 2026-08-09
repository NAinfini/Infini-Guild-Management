// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UnsavedChangesAffix } from "../shared/UnsavedChangesAffix";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("MyProfilePage save flow", () => {
  it("owns one save bar outside the individual tabs", () => {
    const pageSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/pages/MyProfilePage.tsx"),
      "utf8",
    );
    const profileTabSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/profile/ProfileProfileTab.tsx"),
      "utf8",
    );
    const availabilityTabSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/profile/ProfileAvailabilityTab.tsx"),
      "utf8",
    );
    const classEditorSource = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/profile/ProfileClassEditor.tsx"),
      "utf8",
    );

    expect(pageSource.match(/<UnsavedChangesAffix/g)).toHaveLength(1);
    expect(profileTabSource).not.toContain("<UnsavedChangesAffix");
    expect(availabilityTabSource).not.toContain("<UnsavedChangesAffix");
    expect(pageSource).toContain("profileQuery.isError && !profileQuery.data");
    expect(pageSource).toContain("profileQuery.refetch()");
    expect(pageSource).not.toContain("fieldBioPlaceholder");
    expect(pageSource).not.toContain("changePasswordLabel");
    expect(pageSource).not.toContain("changeUsernameLabel");
    expect(pageSource).not.toContain("classSensors");
    expect(pageSource).not.toContain("renderSortableClassRow");
    expect(profileTabSource).toContain("<ProfileClassEditor");
    expect(classEditorSource).toContain("KeyboardSensor");
    expect(classEditorSource).toContain("sortableKeyboardCoordinates");
    expect(classEditorSource).toContain("setActivatorNodeRef");
  });

  it("only renders the save affix while changes are dirty or saving", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <MantineProvider>
        <UnsavedChangesAffix isDirty={false} saving={false} onSave={onSave} />
      </MantineProvider>,
    );

    expect(screen.queryByRole("button", { name: "action.saveProfile" })).not.toBeInTheDocument();

    rerender(
      <MantineProvider>
        <UnsavedChangesAffix isDirty saving={false} onSave={onSave} />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeEnabled();

    rerender(
      <MantineProvider>
        <UnsavedChangesAffix isDirty={false} saving onSave={onSave} />
      </MantineProvider>,
    );

    expect(screen.getByText("status.saving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeDisabled();
  });

  it("positions the mobile save affix above the bottom navigation", () => {
    const stylesSource = readFileSync(
      resolve(process.cwd(), "apps/portal/styles.css"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const mobileAffixStyles = stylesSource.slice(
      stylesSource.indexOf("@media (max-width: 767px)"),
      stylesSource.indexOf("@media (max-width: 767px)") + 500,
    );

    expect(mobileAffixStyles).toContain("var(--bottom-nav-height)");
    expect(mobileAffixStyles).toContain("env(safe-area-inset-bottom)");
  });
});
