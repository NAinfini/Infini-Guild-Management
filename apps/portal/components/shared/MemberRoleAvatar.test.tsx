import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberRoleAvatar } from "./MemberRoleAvatar";

const profile = {
  classes: [] as string[],
  power: 1200,
  avatar_media_id: null,
};

function renderAvatar(withTooltip = true) {
  return render(
    <MantineProvider>
      <MemberRoleAvatar
        user={{ username: "Aster" }}
        profile={profile}
        withTooltip={withTooltip}
      />
    </MantineProvider>,
  );
}

describe("MemberRoleAvatar accessibility", () => {
  it("uses a native button as the HoverCard target", () => {
    renderAvatar();

    expect(screen.getByRole("button", { name: "Aster" })).toBeInTheDocument();
  });

  it("does not add an inert button when the tooltip is disabled", () => {
    renderAvatar(false);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps class roles as attached avatar badges", () => {
    const { container } = render(
      <MantineProvider>
        <MemberRoleAvatar
          user={{ username: "Aster" }}
          profile={{
            ...profile,
            classes: ["牵丝霖", "鸣金虹"],
          }}
          withTooltip={false}
        />
      </MantineProvider>,
    );

    expect(container.querySelector(".member-role-avatar__roles")).toBeInTheDocument();
    expect(container.querySelectorAll(".member-role-avatar__role-circle")).toHaveLength(2);
  });
});
