import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationPopover } from "./NotificationPopover";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

const entry = {
  id: "notification-1",
  title: "A deliberately long notification title",
  message: "A notification body that must remain readable in the narrow overlay.",
  type: "event_created",
  readAt: null,
  occurredAt: "2026-07-29T12:00:00.000Z",
};

function renderPopover(onClose = vi.fn()) {
  render(
    <MantineProvider>
      <NotificationPopover
        user={{ id: "user-1" }}
        pushHasUnread
        notificationAnnouncementsHasNew={false}
        displayPushEntries={[entry]}
        onClose={onClose}
        onClearHistory={vi.fn()}
        onEntryClick={vi.fn()}
      />
    </MantineProvider>,
  );

  return onClose;
}

describe("NotificationPopover", () => {
  it("uses a viewport-safe width and bounded scrolling contract", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.module.css"),
      "utf8",
    );

    expect(source).not.toContain("width={420}");
    expect(styles).toMatch(/width:\s*min\(26\.25rem,\s*calc\(100vw - var\(--space-xl\)\)\)/);
    expect(styles).toMatch(/max-height:\s*min\(/);
    expect(styles).toContain("overflow-y: auto");
  });

  /*
   * 「回车打开、Escape 关掉、焦点还回按钮」这条不在这里测，改由 e2e
   * apps/portal/e2e/specs/admin/header-notifications.spec.ts 覆盖，跑在真浏览器里。
   *
   * 原因不是嫌单测麻烦，是这条在 jsdom 里不可能成立：Mantine 9 给 Popover 的
   * middleware 加了 floating-ui 的 hide()，浮层在 referenceHidden 时会被打上行内
   * display:none（PopoverDropdown.mjs）。jsdom 没有布局引擎，所有元素都是 0×0，
   * hide() 于是恒判定 reference 不可见——实测 jsdom 里浮层的行内样式就是
   * display:none，而同一段流程在真浏览器里量出来是空字符串。
   * useFocusTrap 的 visible() 会顺着父链查行内 display:none，焦点因此进不去，
   * Escape 到不了 Popover.Dropdown 的 onKeyDownCapture。
   *
   * 换句话说这条单测量的是布局计算，而 jsdom 恰恰没有布局。留在这里只会是一条
   * 永远红、或者被 mock 灌绿的假测试。
   */
  it("keeps the popover markup keyboard-dismissible: trapFocus + returnFocus stay on", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/portal/components/layout/NotificationPopover.tsx"),
      "utf8",
    );

    // 这两个属性掉了，e2e 那条会红；这里先在源码层面拦一道，失败信息更直接。
    expect(source).toContain("trapFocus");
    expect(source).toContain("returnFocus");
  });

  it("labels the trigger by unread state so the e2e can find it by role", () => {
    /*
     * 触发器的可访问名是 e2e 唯一的定位方式（已读/未读两种文案）。这条守的是
     * ActionIcon 上的 aria-label 还在，别名改了要连着 e2e 的正则一起改。
     */
    renderPopover();
    expect(screen.getByRole("button", { name: "label.notificationsUnread" })).toBeInTheDocument();
  });
});
