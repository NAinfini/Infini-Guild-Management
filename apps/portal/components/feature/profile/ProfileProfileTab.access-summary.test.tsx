import type { UserBadge } from "@guild/shared";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileProfileTab } from "./ProfileProfileTab";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../shared/TitleField", () => ({
  TitleField: () => null,
}));

vi.mock("./ProfileClassEditor", () => ({
  ProfileClassEditor: () => null,
}));

vi.mock("../../shared/MemberCard", () => ({
  MemberBadgeChip: ({ badge }: { badge: UserBadge }) => <span>{badge.name}</span>,
}));

const badge: UserBadge = {
  id: "badge-1",
  name: "Veteran",
  label_html: "<strong>Veteran</strong>",
  color: "#61B8AA",
};

function renderTab(
  roleName: string | null,
  roleColor: string | null,
  badges: UserBadge[],
) {
  render(
    <ProfileProfileTab
        roleName={roleName}
        roleColor={roleColor}
        badges={badges}
        displayName="Member"
        power={9800}
        classDraft=""
        classOptions={[]}
        classList={[]}
        titleHtml=""
        bio=""
        onTitleHtmlChange={vi.fn()}
        onDisplayNameChange={vi.fn()}
        onPowerChange={vi.fn()}
        onClassDraftChange={vi.fn()}
        onAddClass={vi.fn()}
        onClassDragEnd={vi.fn()}
        onRemoveClass={vi.fn()}
        onBioChange={vi.fn()}
    />,
  );
}

describe("ProfileProfileTab access summary", () => {
  it("edits the public display name with the rest of the profile fields", () => {
    renderTab("Member", null, []);

    expect(screen.getByLabelText("field.displayName")).toHaveValue("Member");
  });

  it("shows the assigned role and badges without edit controls", () => {
    renderTab("Site Owner", "#ef4444", [badge]);

    const summary = screen.getByRole("region", { name: "section.access" });
    expect(within(summary).getByText("Site Owner")).toBeInTheDocument();
    expect(within(summary).getByText("Veteran")).toBeInTheDocument();
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
    expect(within(summary).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows explicit empty states when nothing is assigned", () => {
    renderTab(null, null, []);

    const summary = screen.getByRole("region", { name: "section.access" });
    expect(within(summary).getByText("access.emptyRole")).toBeInTheDocument();
    expect(within(summary).getByText("access.emptyBadges")).toBeInTheDocument();
  });
});
