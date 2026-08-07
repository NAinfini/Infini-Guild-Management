// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminMemberDetailModal } from "./AdminMemberDetailModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

/* 当前登录者的等级由每个用例设定：等级高于目标就能管，持平就管不了。 */
let currentRoleLevel = 999;

vi.mock("@portal/stores/auth", () => ({
  useAuthStore: (selector: (state: { user: { role_level: number } }) => unknown) =>
    selector({ user: { role_level: currentRoleLevel } }),
}));

vi.mock("@portal/stores/class-catalog", () => ({
  useClassCatalogStore: () => [],
  buildClassOptions: () => [],
  resolveClassCatalogItem: (id: string) => ({ id, label: id, color: "#61B8AA" }),
}));

vi.mock("@portal/components/shared/ProfileOverviewCard", () => ({
  ProfileOverviewCard: () => <div data-testid="overview-card" />,
}));

vi.mock("@portal/components/shared/MemberCard", () => ({
  isOnVacation: () => false,
}));

vi.mock("../../shared/TitleField", () => ({
  TitleField: () => <div data-testid="title-field" />,
}));

vi.mock("../../shared/AbsenceManagerCard", () => ({
  AbsenceManagerCard: () => <div data-testid="absence-manager" />,
}));

vi.mock("@portal/hooks/useConfirmDialog", () => ({
  useConfirmDialog: () => vi.fn(async () => true),
}));

const member = {
  user: {
    id: "user-1",
    username: "Aster",
    role: "member-role",
    role_name: "Guild Member",
    role_color: null,
    role_level: 10,
    permissions: {},
    is_active: true,
    created_at: "2026-08-05T00:00:00.000Z",
  },
  profile: {
    power: 10,
    classes: [],
    title_html: null,
    bio: null,
    notes: null,
    avatar_key: null,
    images: [],
    audio_key: null,
    video_urls: [],
    availability: null,
    vacation_start: null,
    vacation_end: null,
    updated_at: "2026-08-05T00:00:00.000Z",
  },
  badges: [],
} as never;

const form = {
  power: 10,
  classes: [],
  titleHtml: "",
  bio: "",
  notes: "",
  role: "member-role",
  isActive: true,
};

const roles = [{
  id: "member-role",
  name: "Guild Member",
  level: 10,
  color: null,
  created_at: "2026-08-05T00:00:00.000Z",
  updated_at: "2026-08-05T00:00:00.000Z",
  permissions: {},
  assigned_user_count: 1,
}] as never;

type Overrides = {
  canEditProfile?: boolean;
  canAssignRole?: boolean;
  canActivate?: boolean;
  isDirty?: boolean;
};

function renderModal(overrides: Overrides = {}) {
  return render(
    <MantineProvider>
      <AdminMemberDetailModal
        open
        member={member}
        form={form}
        isDirty={overrides.isDirty ?? true}
        onClose={vi.fn()}
        onFormChange={vi.fn()}
        onResetForm={vi.fn()}
        onSaveProfile={vi.fn()}
        saveProfilePending={false}
        mediaTab={<div data-testid="media-tab" />}
        roles={roles}
        canEditProfile={overrides.canEditProfile ?? true}
        canAssignRole={overrides.canAssignRole ?? true}
        canActivate={overrides.canActivate ?? true}
      />
    </MantineProvider>,
  );
}

const enterEditMode = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "detail.action.edit" }));

beforeEach(() => {
  currentRoleLevel = 999;
});

describe("AdminMemberDetailModal read screen", () => {
  it("shows facts only — no input control is rendered before entering edit mode", () => {
    renderModal();

    // 打开就是一屏可读的事实。摆着一堆输入框会让「看一眼这个人」变成「小心别改到」。
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getByTestId("overview-card")).toBeInTheDocument();
  });

  it("summarises the instant-write blocks instead of mounting their editors", () => {
    renderModal();

    // 只想看一眼这个人是谁的时候，不该付请假查询和上传器的代价。
    expect(screen.queryByTestId("absence-manager")).not.toBeInTheDocument();
    expect(screen.queryByTestId("media-tab")).not.toBeInTheDocument();
    expect(screen.getByText("detail.section.vacation")).toBeInTheDocument();
    expect(screen.getByText("detail.section.media")).toBeInTheDocument();
  });

  it("explains why editing is unavailable instead of showing a dead button", () => {
    currentRoleLevel = 10;
    renderModal();

    // 与自己同级的成员管不了。禁用而不说原因，界面就只是「坏了」——而禁用的按钮
    // 收不到指针事件，理由挂进 tooltip 就等于藏进一个够不着的地方，得直接写出来。
    expect(screen.getByRole("button", { name: "detail.action.edit" })).toBeDisabled();
    expect(screen.getByText("detail.hint.cannotManage")).toBeInTheDocument();
  });
});

describe("AdminMemberDetailModal edit mode", () => {
  it("renders controls only for the groups the admin may change", async () => {
    const user = userEvent.setup();
    renderModal({ canEditProfile: false, canAssignRole: true, canActivate: false });
    await enterEditMode(user);

    // 有权的那组给控件，无权的那组摊成一行值——灰掉的控件不传达任何信息。
    expect(screen.getByRole("combobox", { name: "detail.field.role" })).toBeEnabled();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("detail.field.power")).not.toBeInTheDocument();
    expect(screen.queryByTestId("title-field")).not.toBeInTheDocument();
    expect(screen.queryByTestId("absence-manager")).not.toBeInTheDocument();
    expect(screen.queryByTestId("media-tab")).not.toBeInTheDocument();
    // 组标题照常显示：藏掉整组会让人以为这个成员没有这些字段。
    expect(screen.getByText("detail.section.combat")).toBeInTheDocument();
    expect(screen.getByText("detail.section.notes")).toBeInTheDocument();
  });

  it("opens every group when the admin may change all of them", async () => {
    const user = userEvent.setup();
    renderModal();
    await enterEditMode(user);

    expect(screen.getByRole("switch")).toBeEnabled();
    expect(screen.getByLabelText("detail.field.power")).toBeEnabled();
    expect(screen.getByTestId("title-field")).toBeInTheDocument();
    expect(screen.getByLabelText("detail.field.bio")).toBeEnabled();
    expect(screen.getByLabelText("detail.section.notes")).toBeEnabled();
  });

  it("opens the instant-write blocks too, and says they do not wait for save", async () => {
    const user = userEvent.setup();
    renderModal();
    await enterEditMode(user);

    // 一颗「编辑」放开全部。但请假与媒体各自写库，底下的「保存资料」管不到它们，
    // 所以这两块必须自己说清楚，否则改完媒体的人会去点一个和它无关的按钮。
    expect(screen.getByTestId("absence-manager")).toBeInTheDocument();
    expect(screen.getByTestId("media-tab")).toBeInTheDocument();
    expect(screen.getByText("detail.hint.instant")).toBeInTheDocument();
  });

  it("returns to the read screen after saving", async () => {
    const user = userEvent.setup();
    renderModal();
    await enterEditMode(user);

    await user.click(screen.getByRole("button", { name: "detail.saveProfile" }));

    expect(screen.getByRole("button", { name: "detail.action.edit" })).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("only offers save while there is something to save", async () => {
    const user = userEvent.setup();
    renderModal({ isDirty: false });
    await enterEditMode(user);

    expect(screen.getByRole("button", { name: "detail.saveProfile" })).toBeDisabled();
  });
});
