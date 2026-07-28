// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FloatingSaveBar } from "../shared/FloatingSaveBar";

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

    expect(pageSource.match(/<FloatingSaveBar/g)).toHaveLength(1);
    expect(profileTabSource).not.toContain("<FloatingSaveBar");
    expect(availabilityTabSource).not.toContain("<FloatingSaveBar");
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

  it("only enables saving when the page has unsaved changes", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <MantineProvider>
        <FloatingSaveBar isDirty={false} saving={false} onSave={onSave} />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeDisabled();

    rerender(
      <MantineProvider>
        <FloatingSaveBar isDirty saving={false} onSave={onSave} />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "action.saveProfile" })).toBeEnabled();
  });
});
