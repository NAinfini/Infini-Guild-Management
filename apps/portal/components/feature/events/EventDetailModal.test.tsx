// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EventDetailModal } from "./EventDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

vi.mock("@portal/components/shared/MediaGallery", () => ({
  MediaGallery: ({
    images,
    resolveMediaUrl,
  }: {
    images: string[];
    resolveMediaUrl?: (key: string) => string;
  }) => (
    <div data-testid="media-gallery">
      {images.map((image) => (
        <span key={image}>{resolveMediaUrl ? resolveMediaUrl(image) : image}</span>
      ))}
    </div>
  ),
  buildMediaGalleryLabels: () => ({}),
}));

vi.mock("@portal/components/shared/MemberRoleAvatar", () => ({
  /* 真组件把名字放在 UnstyledButton 的 aria-label 上，悬停卡里才有可见的名字。 */
  MemberRoleAvatar: ({ user }: { user: { username: string } }) => (
    <div data-testid="poll-voter-avatar" aria-label={user.username}>
      {user.username.slice(0, 1).toUpperCase()}
    </div>
  ),
}));

describe("EventDetailModal", () => {
  it("keeps the member workspace neutral instead of treating it as a success state", () => {
    const css = readFileSync(
      resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailModal.css"),
      "utf8",
    );

    expect(css).not.toMatch(
      /\.event-detail-modal__section--members\s*\{[^}]*mantine-color-green/s,
    );
    expect(css).not.toMatch(
      /\[data-theme="dark"\]\s+\.event-detail-modal__section--members\s*\{/,
    );
    expect(css).toMatch(
      /\.event-detail-modal__section--members[^}]*svg\s*\{[^}]*color:\s*var\(--brand-text\)/s,
    );
  });

  it("leaves the head count to the section title instead of repeating it above the roster", () => {
    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-progress",
            title: "Open Event",
            type: "social",
            start_at: "2099-03-12T16:00:00.000Z",
            end_at: null,
            description: null,
            capacity: 10,
            attachments: [],
            class_quotas: [],
          } as never}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(document.querySelector(".quota-bar")).not.toBeInTheDocument();
    expect(screen.getByText("detail.membersWithCap")).toBeInTheDocument();
  });

  it("does not show a fallback title while the detail modal is closing", () => {
    const source = readFileSync(resolve(process.cwd(), "apps/portal/components/feature/events/EventDetailModal.tsx"), "utf8");

    expect(source).not.toContain('title={event?.title ?? t("detail.title")}');

    render(
      <MantineProvider>
        <EventDetailModal
          event={null}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.queryByText("detail.title")).not.toBeInTheDocument();
  });

  it("resolves raw event attachment keys to the event image endpoint", () => {
    const attachmentKey = "events/p0UhTp1BApaAKsJbVHOiW/images/1773067314787_kKZOKY3Mzi7f2y6458J3l";

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Updated Social Event",
            type: "social",
            start_at: "2026-03-12T16:00:00.000Z",
            end_at: null,
            description: null,
            capacity: null,
            attachments: [attachmentKey],
            class_quotas: [],
          } as never}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    const expectedUrl = new URL("/api/events/image", window.location.origin);
    expectedUrl.searchParams.set("key", attachmentKey);

    expect(screen.getByText(expectedUrl.toString())).toBeInTheDocument();
  });

  it("unmounts content immediately when the modal closes", () => {
    const event = {
      id: "event-closing",
      title: "Closing Event",
      type: "social",
      start_at: "2026-03-12T16:00:00.000Z",
      end_at: null,
      description: "Should not linger after close",
      capacity: null,
      attachments: [],
      class_quotas: [],
    } as never;

    const { rerender } = render(
      <MantineProvider>
        <EventDetailModal
          event={event}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    rerender(
      <MantineProvider>
        <EventDetailModal
          event={null}
          members={[]}
          allUsers={[]}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.queryByText("Closing Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Should not linger after close")).not.toBeInTheDocument();
  });

  it("explains why the signup action is disabled", async () => {
    const user = userEvent.setup();

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-archived",
            title: "Archived event",
            type: "social",
            start_at: "2099-03-12T16:00:00.000Z",
            end_at: "2099-03-12T18:00:00.000Z",
            description: null,
            capacity: 10,
            signup_locked: true,
            archived_at: "2026-03-12T18:00:00.000Z",
            attachments: [],
            class_quotas: [],
          } as never}
          members={[]}
          allUsers={[]}
          canManage={false}
          currentUserId="user-1"
          onClose={() => {}}
          onJoin={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    const joinButton = screen.getByRole("button", { name: "button.join" });
    expect(joinButton).toBeDisabled();
    expect(joinButton.parentElement).toHaveAttribute("data-disabled-tooltip-target");

    await user.hover(joinButton.parentElement!);
    expect(await screen.findByText("button.disabled.archived")).toBeInTheDocument();
  });

  it.each([
    ["ended", { end_at: "2000-01-01T00:00:00.000Z", signup_locked: false }],
    ["signup-locked", { end_at: "2099-12-31T23:59:59.000Z", signup_locked: true }],
  ])("disables leaving an %s event in the detail modal", (_state, eventOverrides) => {
    const member = {
      user: { id: "user-1", username: "member-1" },
      profile: {
        user_id: "user-1",
        classes: ["mage"],
        power: 1000,
        avatar_key: null,
        title_html: null,
      },
    };

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Member event",
            type: "social",
            start_at: "2099-12-31T22:00:00.000Z",
            description: null,
            capacity: 10,
            archived_at: null,
            attachments: [],
            class_quotas: [],
            ...eventOverrides,
          } as never}
          members={[member] as never}
          allUsers={[member] as never}
          canManage={false}
          currentUserId="user-1"
          onClose={() => {}}
          onLeave={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("button", { name: "button.leave" })).toBeDisabled();
  });

  it("lets users vote in poll detail and still shows voter breakdown", async () => {
    const user = userEvent.setup();
    const onVotePoll = vi.fn();

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Next activity?",
            type: "poll",
            start_at: "2099-06-12T16:00:00.000Z",
            end_at: "2099-06-12T18:00:00.000Z",
            description: null,
            capacity: null,
            attachments: [],
            class_quotas: [],
            poll: {
              results_visibility: "after_vote",
              show_voter_names: false,
              has_voted: false,
              can_vote: true,
              options: [
                { id: "opt-1", label: "Raid", vote_count: 2, voter_ids: ["user-1", "user-2"], voted_by_me: true },
                { id: "opt-2", label: "Dungeon", vote_count: 0, voter_ids: [], voted_by_me: false },
              ],
            },
          } as never}
          members={[]}
          allUsers={[
            { user: { id: "user-1", username: "member-1" }, profile: {} },
            { user: { id: "user-2", username: "member-2" }, profile: {} },
          ] as never}
          canManage={false}
          currentUserId="user-1"
          onClose={() => {}}
          onJoin={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
          onVotePoll={onVotePoll}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Raid")).toBeInTheDocument();
    expect(screen.getByText("Dungeon")).toBeInTheDocument();
    expect(document.querySelector(".event-detail-modal__poll-result-board")).toBeInTheDocument();
    expect(document.querySelectorAll(".event-detail-modal__poll-result-row")).toHaveLength(2);
    expect(document.querySelectorAll(".event-detail-modal__poll-result-row[role='checkbox']")).toHaveLength(2);
    expect(document.querySelector(".event-detail-modal__poll-choice .mantine-Checkbox-input")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".event-detail-modal__poll-voters")).toHaveLength(1);
    expect(screen.getByText("poll.detail.noVotes")).toBeInTheDocument();
    expect(screen.getAllByTestId("poll-voter-avatar")).toHaveLength(2);
    /* 投票人只画头像，名字交给悬停卡——名字不再作为可见文本排在头像旁边。 */
    expect(screen.getByLabelText("member-1")).toBeInTheDocument();
    expect(screen.getByLabelText("member-2")).toBeInTheDocument();
    expect(document.querySelector(".event-detail-modal__poll-voter-chip")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Raid/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: /Dungeon/i })).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("checkbox", { name: /Dungeon/i }));
    expect(screen.getByRole("checkbox", { name: /Dungeon/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: /poll\.vote/i }));

    expect(onVotePoll).toHaveBeenCalledWith("event-1", ["opt-1", "opt-2"]);
    expect(screen.queryByRole("button", { name: /button\.join/i })).not.toBeInTheDocument();
  });

  it("does not show poll voting controls without a vote handler", () => {
    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Next activity?",
            type: "poll",
            start_at: "2026-06-12T16:00:00.000Z",
            end_at: "2099-06-12T18:00:00.000Z",
            description: null,
            capacity: null,
            attachments: [],
            class_quotas: [],
            poll: {
              results_visibility: "after_vote",
              show_voter_names: false,
              has_voted: false,
              can_vote: true,
              options: [
                { id: "opt-1", label: "Raid", vote_count: 2, voter_ids: ["user-1"], voted_by_me: false },
                { id: "opt-2", label: "Dungeon", vote_count: 0, voter_ids: [], voted_by_me: false },
              ],
            },
          } as never}
          members={[]}
          allUsers={[{ user: { id: "user-1", username: "member-1" }, profile: {} }] as never}
          canManage={false}
          onClose={() => {}}
          onAddParticipant={() => {}}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Raid")).toBeInTheDocument();
    expect(screen.getByText("Dungeon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /poll\.vote/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /poll\.update/i })).not.toBeInTheDocument();
  });

  it("clears the add-member search after adding someone, so the next person is reachable", async () => {
    const user = userEvent.setup();
    const onAddParticipant = vi.fn();
    const candidates = [
      { user: { id: "user-1", username: "member-1", is_active: true, deleted_at: null }, profile: { classes: [], power: 1 } },
      { user: { id: "user-2", username: "member-2", is_active: true, deleted_at: null }, profile: { classes: [], power: 1 } },
    ];

    render(
      <MantineProvider>
        <EventDetailModal
          event={{
            id: "event-1",
            title: "Guild social",
            type: "social",
            start_at: "2099-06-12T16:00:00.000Z",
            end_at: "2099-06-12T18:00:00.000Z",
            description: null,
            capacity: 10,
            attachments: [],
            class_quotas: [],
          } as never}
          members={[]}
          allUsers={candidates as never}
          canManage
          onClose={() => {}}
          onAddParticipant={onAddParticipant}
          onRemoveParticipant={() => {}}
        />
      </MantineProvider>,
    );

    const picker = screen.getByPlaceholderText("detail.addMemberPlaceholder");
    await user.click(picker);
    await user.type(picker, "member-1");
    // 下拉挂在 Modal 的 portal 里，jsdom 下整棵树带 aria-hidden，按角色取必须放开 hidden。
    await user.click(await screen.findByRole("option", { name: "member-1", hidden: true }));

    expect(onAddParticipant).toHaveBeenCalledWith("event-1", "user-1");
    /*
     * 搜索词留在框里，下一个人就搜不出来了：他被 members 过滤掉之后候选表里只剩别人，
     * 而过滤词还卡在上一个名字上，点开只有一句 Nothing found。
     */
    expect(picker).toHaveValue("");
  });

  it("confirms member removal through the Mantine modal manager", async () => {
    const user = userEvent.setup();
    const onRemoveParticipant = vi.fn();

    render(
      <MantineProvider>
        <ModalsProvider>
          <EventDetailModal
            event={{
              id: "event-1",
              title: "Guild social",
              type: "social",
              start_at: "2099-06-12T16:00:00.000Z",
              end_at: "2099-06-12T18:00:00.000Z",
              description: null,
              capacity: 10,
              attachments: [],
              class_quotas: [],
            } as never}
            members={[
              {
                user: { id: "user-1", username: "member-1", is_active: true, deleted_at: null },
                profile: { classes: ["mage"], power: 1000 },
              },
            ] as never}
            allUsers={[]}
            canManage
            onClose={() => {}}
            onAddParticipant={() => {}}
            onRemoveParticipant={onRemoveParticipant}
          />
        </ModalsProvider>
      </MantineProvider>,
    );

    const originDialog = screen.getByRole("dialog", { name: "Guild social" });
    const removeButton = within(originDialog).getByRole("button", { name: "detail.removeMember" });
    expect(removeButton).toHaveAttribute("data-variant", "light");
    await user.click(removeButton);

    const confirmation = await screen.findByRole("dialog", {
      name: "detail.confirm.removeMember.title",
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(onRemoveParticipant).not.toHaveBeenCalled();

    await user.click(within(confirmation).getByRole("button", { name: "button.cancel" }));
    expect(onRemoveParticipant).not.toHaveBeenCalled();

    await user.click(within(originDialog).getByRole("button", { name: "detail.removeMember" }));
    const acceptedConfirmation = await screen.findByRole("dialog", {
      name: "detail.confirm.removeMember.title",
    });
    await user.click(within(acceptedConfirmation).getByRole("button", {
      name: "detail.removeMember",
    }));

    expect(onRemoveParticipant).toHaveBeenCalledWith("event-1", "user-1");
  });
});
