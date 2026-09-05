import {
  type ClassCatalogItem,
  type MemberProfile,
  type MemberSummary,
  type UserBadge,
} from "@guild/shared";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import {
  fireEvent,
  render as renderWithoutProviders,
  screen,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSeededQueryClient } from "../../tests/query-harness";
import { MemberCard } from "./MemberCard";

/* MemberCard 的职业目录来自 TanStack Query 缓存，每次渲染都要挂上带种子
   数据的 QueryClientProvider。 */
let queryClient: QueryClient;

function render(ui: ReactElement, options?: RenderOptions): RenderResult {
  return renderWithoutProviders(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
    ...options,
  });
}

const motionHarness = vi.hoisted(() => ({
  reducedMotion: false,
  springs: [] as Array<{ set: ReturnType<typeof vi.fn>; jump: ReturnType<typeof vi.fn> }>,
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
    useSpring: () => {
      const spring = { set: vi.fn(), jump: vi.fn() };
      motionHarness.springs.push(spring);
      return spring;
    },
  };
});

vi.mock("@portal/hooks/useReducedMotionPreference", () => ({
  useReducedMotionPreference: () => motionHarness.reducedMotion,
}));

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
  icon_media_id: null,
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


const user: MemberSummary = {
  id: "user-1",
  display_name: "Aster",
  role: "member",
  role_name: "Guild Member",
  role_color: null,
  role_level: 1,
  is_active: true,
  deleted_at: null,
  created_at: now,
  updated_at: now,
  last_login_at: null,
};

const profile: MemberProfile = {
  user_id: user.id,
  power: 1200,
  classes: [],
  title_html: null,
  bio: null,
  avatar_media_id: null,
  images: [],
  audio_media_id: "audio1234567890abcdef",
  audio_name: "hover.ogg",
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
  queryClient = createSeededQueryClient({
    classes: [classCatalogItem, secondaryClassCatalogItem],
  });
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

  it("renders only the first member class", () => {
    render(
      <MemberCard
        user={user}
        profile={{ ...profile, classes: ["鸣金虹", "听风"] }}
      />,
    );

    expect(screen.getByText("鸣金虹")).toBeInTheDocument();
    expect(screen.queryByText("听风")).not.toBeInTheDocument();
  });

  it("keeps the first class and identity badges without exposing the permission level", () => {
    render(
      <MemberCard
        user={{ ...user, role: "moderator" }}
        profile={{ ...profile, classes: ["鸣金虹"] }}
        badges={[badge]}
      />,
    );

    /* 名片上只有这个人是谁，没有他在系统里有多大权限。 */
    expect(screen.getByText("Aster")).toBeInTheDocument();
    expect(screen.queryByText(user.role_name)).not.toBeInTheDocument();
    expect(screen.queryByText("admin:role.moderator")).not.toBeInTheDocument();
    expect(screen.getByText("鸣金虹")).toBeInTheDocument();
    expect(screen.getByText("Raid leader")).toBeInTheDocument();
  });

  it("shows visible short labels beside photo and video counts", () => {
    render(
      <MemberCard
        user={user}
        profile={{ ...profile, images: ["photo.webp"], video_urls: ["https://example.com/video"] }}
      />,
    );

    expect(screen.getByLabelText("member.photo 1")).toBeInTheDocument();
    expect(screen.getByLabelText("member.video 1")).toBeInTheDocument();
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

    expect(motionHarness.springs.some(({ set }) => set.mock.calls.length > 0)).toBe(true);
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

  it("immediately neutralizes springs when reduced motion becomes active", () => {
    const { rerender } = render(<MemberCard user={user} profile={profile} />);
    motionHarness.reducedMotion = true;
    rerender(<MemberCard user={user} profile={{ ...profile }} />);
    motionHarness.springs.slice(-5).forEach((spring, index) => {
      expect(spring.jump).toHaveBeenCalledWith(index === 2 ? 1 : 0);
    });
  });
});
