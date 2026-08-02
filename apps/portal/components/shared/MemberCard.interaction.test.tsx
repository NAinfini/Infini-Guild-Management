// @vitest-environment jsdom
import { PERMISSIONS, type MemberProfile, type Permission, type User } from "@guild/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
  motionHarness.reducedMotion = false;
  motionHarness.springs = [];
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

  it("renders the member class label, color, and curated icon on the full card", () => {
    const { container } = render(
      <MemberCard
        user={user}
        profile={{ ...profile, classes: ["鸣金虹"] }}
      />,
    );

    expect(screen.getByText("鸣金虹")).toBeInTheDocument();
    expect(container.querySelector(".member-card__class-chip .class-icon")).not.toBeNull();
    expect(container.querySelector(".member-card__class-chip")).toHaveStyle({
      "--class-color": "#6EA8FE",
    });
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
