// @vitest-environment jsdom
import {
  PERMISSIONS,
  type ClassCatalogItem,
  type MemberProfile,
  type Permission,
  type User,
  type UserBadge,
} from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useClassCatalogStore } from "../../stores/class-catalog";
import { MemberCard } from "./MemberCard";

const motionHarness = vi.hoisted(() => ({
  reducedMotion: false,
  springs: [] as Array<{ set: ReturnType<typeof vi.fn> }>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.name ? `${key}:${String(values.name)}` : key,
  }),
}));

vi.mock("motion/react", async () => {
  const React = await import("react");

  return {
    motion: {
      button: React.forwardRef<
        HTMLButtonElement,
        React.ButtonHTMLAttributes<HTMLButtonElement> & { style?: unknown }
      >(function MotionButton({ children, style: _style, ...props }, ref) {
        return <button ref={ref} {...props}>{children}</button>;
      }),
      span: React.forwardRef<
        HTMLSpanElement,
        React.HTMLAttributes<HTMLSpanElement> & { style?: unknown }
      >(function MotionSpan({ children, style: _style, ...props }, ref) {
        return <span ref={ref} {...props}>{children}</span>;
      }),
    },
    useReducedMotion: () => motionHarness.reducedMotion,
    useSpring: () => {
      const spring = { set: vi.fn() };
      motionHarness.springs.push(spring);
      return spring;
    },
  };
});

vi.mock("./ClassIcon", () => ({
  ClassIcon: ({ item }: { item: { label: string } }) => (
    <span className="class-icon" data-class-label={item.label} />
  ),
}));

const now = "2026-07-29T12:00:00.000Z";
const classCatalogItem: ClassCatalogItem = {
  id: "鸣金虹",
  label: "鸣金虹",
  color: "#6EA8FE",
  icon_type: "vector",
  vector_icon: "sword",
  icon_key: null,
  sort_order: 0,
  created_at: now,
  updated_at: now,
};
const secondaryClassCatalogItem: ClassCatalogItem = {
  ...classCatalogItem,
  id: "听风",
  label: "听风",
  sort_order: 1,
};

const noPermissions = Object.fromEntries(
  PERMISSIONS.map((permission) => [permission, false]),
) as Record<Permission, boolean>;

const user: User = {
  id: "user-1",
  username: "Aster",
  role: "member",
  permissions: noPermissions,
  is_active: true,
  deleted_at: null,
  created_at: now,
  updated_at: now,
};

const profile: MemberProfile = {
  id: "profile-1",
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: null,
  avatar_key: null,
  images: [],
  audio_key: "profiles/user-1/hover.mp3",
  video_urls: [],
  availability: null,
  vacation_start: null,
  vacation_end: null,
  notes: null,
  created_at: now,
  updated_at: now,
};
const badge: UserBadge = {
  id: "badge-1",
  name: "Raid leader",
  label_html: "Raid leader",
  color: "#6EA8FE",
};

beforeEach(() => {
  motionHarness.reducedMotion = false;
  motionHarness.springs = [];
  useClassCatalogStore.getState().setItems([classCatalogItem, secondaryClassCatalogItem]);
});

describe("MemberCard protected runtime interaction", () => {
  it("is keyboard focusable and opens through native Enter activation", async () => {
    const onClick = vi.fn();
    const keyboard = userEvent.setup();

    render(<MemberCard user={user} profile={profile} onClick={onClick} />);

    await keyboard.tab();
    expect(screen.getByRole("button", { name: "a11y.openProfile:Aster" })).toHaveFocus();

    await keyboard.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders only the first member class with its color and curated icon", () => {
    const { container } = render(
      <MemberCard
        user={user}
        profile={{ ...profile, classes: ["鸣金虹", "听风"] }}
      />,
    );

    expect(screen.getByText("鸣金虹")).toBeInTheDocument();
    expect(screen.queryByText("听风")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".member-card__class-chip")).toHaveLength(1);
    expect(container.querySelector(".member-card__class-chip .class-icon")).not.toBeNull();
    expect(container.querySelector(".member-card__class-chip")).toHaveStyle({
      "--class-color": "#6EA8FE",
    });
  });

  it("keeps the first class and identity badges without exposing the permission level", () => {
    const { container } = render(
      <MemberCard
        user={{ ...user, role: "moderator" }}
        profile={{ ...profile, classes: ["鸣金虹"] }}
        badges={[badge]}
      />,
    );

    const identity = container.querySelector(".member-card__identity");
    const systemRole = container.querySelector(".member-card__system-role");
    const primaryClass = container.querySelector(".member-card__class-chip--primary");
    const metaRow = container.querySelector(".member-card__meta-row");

    expect(identity).toContainElement(screen.getByText("Aster"));
    expect(systemRole).not.toBeInTheDocument();
    expect(screen.queryByText("admin:role.moderator")).not.toBeInTheDocument();
    expect(primaryClass).toContainElement(screen.getByText("鸣金虹"));
    expect(metaRow).toContainElement(screen.getByText("Raid leader"));
  });

  it("lets class, media, and identity badges share one naturally wrapping row", () => {
    const { container } = render(
      <MemberCard
        user={user}
        profile={{ ...profile, classes: ["鸣金虹"], images: ["photo.webp"] }}
        badges={[badge]}
      />,
    );

    const metaRow = container.querySelector(".member-card__meta-row");
    expect(container.querySelector(".member-card__class-chip--primary")?.parentElement).toBe(metaRow);
    expect(container.querySelector(".member-card__pill--photo")?.parentElement).toBe(metaRow);
    expect(container.querySelector(".member-card__badge")?.parentElement).toBe(metaRow);
    expect(container.querySelector(".member-card__class-row")).not.toBeInTheDocument();
    expect(container.querySelector(".member-card__badge-row")).not.toBeInTheDocument();
  });

  it("keeps a square avatar and content-width tags while letting long labels wrap", () => {
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/shared/MemberCard.css"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");

    expect(styles).toMatch(/\.member-card__avatar-fallback\s*\{[^}]*font-size:\s*var\(--text-display\)/);
    expect(styles).toMatch(/\.member-card__avatar-wrap\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
    expect(styles).toMatch(/\.member-card__class-chip--primary\s*\{[^}]*flex:\s*0\s+1\s+auto/);
    expect(styles).toMatch(/\.member-card__class-chip--primary\s*\{[^}]*width:\s*fit-content/);
    expect(styles).toMatch(/\.member-card__class-label\s*\{[^}]*white-space:\s*normal/);
    expect(styles).toMatch(/\.member-card__badge\s*\{[^}]*white-space:\s*normal/);
    expect(styles).not.toMatch(/\.member-card__(?:class|badge)-row\s*\{/);
  });

  it("shows visible short labels beside photo and video counts", () => {
    const { container } = render(
      <MemberCard
        user={user}
        profile={{ ...profile, images: ["photo.webp"], video_urls: ["https://example.com/video"] }}
      />,
    );

    const photoPill = container.querySelector(".member-card__pill--photo");
    const videoPill = container.querySelector(".member-card__pill--video");

    expect(photoPill).toHaveTextContent("member.photo1");
    expect(videoPill).toHaveTextContent("member.video1");
  });

  it("caps visible identity badges and summarizes the remainder accessibly", () => {
    const badges = Array.from({ length: 4 }, (_, index) => ({
      ...badge,
      id: `badge-${index + 1}`,
      name: `Badge ${index + 1}`,
      label_html: `Badge ${index + 1}`,
    }));

    render(<MemberCard user={user} profile={profile} badges={badges} />);

    expect(screen.getByText("Badge 1")).toBeInTheDocument();
    expect(screen.getByText("Badge 2")).toBeInTheDocument();
    expect(screen.queryByText("Badge 3")).not.toBeInTheDocument();
    expect(screen.queryByText("Badge 4")).not.toBeInTheDocument();
    const overflow = screen.getByText("+2");
    expect(overflow).toHaveAttribute("aria-label", "member.moreBadges");
  });

  it("keeps the mouse spring response but ignores touch pointers", () => {
    const { container } = render(<MemberCard user={user} profile={profile} />);
    const frame = container.querySelector<HTMLElement>(".member-card__frame");
    expect(frame).not.toBeNull();

    frame!.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      right: 200,
      bottom: 280,
      left: 0,
      width: 200,
      height: 280,
      toJSON: () => ({}),
    });

    fireEvent.pointerEnter(frame!, {
      pointerType: "touch",
      clientX: 150,
      clientY: 70,
    });
    fireEvent.pointerMove(frame!, {
      pointerType: "touch",
      clientX: 150,
      clientY: 70,
    });
    expect(motionHarness.springs.every(({ set }) => set.mock.calls.length === 0)).toBe(true);

    fireEvent.pointerEnter(frame!, {
      pointerType: "mouse",
      clientX: 150,
      clientY: 70,
    });
    fireEvent.pointerMove(frame!, {
      pointerType: "mouse",
      clientX: 150,
      clientY: 70,
    });

    expect(motionHarness.springs[2]?.set).toHaveBeenCalledWith(1.04);
    expect(motionHarness.springs[0]?.set).toHaveBeenCalled();
    expect(motionHarness.springs[1]?.set).toHaveBeenCalled();
  });

  it("does not start the spring response when reduced motion is requested", () => {
    motionHarness.reducedMotion = true;
    const { container } = render(<MemberCard user={user} profile={profile} />);
    const frame = container.querySelector<HTMLElement>(".member-card__frame");
    expect(frame).not.toBeNull();

    fireEvent.pointerEnter(frame!, {
      pointerType: "mouse",
    });
    fireEvent.pointerMove(frame!, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });

    expect(motionHarness.springs.every(({ set }) => set.mock.calls.length === 0)).toBe(true);
  });
});
