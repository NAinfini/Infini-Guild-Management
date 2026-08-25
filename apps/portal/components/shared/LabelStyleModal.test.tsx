import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import enTools from "../../i18n/en/tools.json";
import zhTools from "../../i18n/zh/tools.json";
import { LabelStyleModal } from "./LabelStyleModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@portal/hooks/useExternalView", () => ({
  useExternalView: () => false,
}));

vi.mock("@portal/utils/notifications", () => ({
  notifySuccess: vi.fn(),
}));

function renderModal(initialHtml?: string) {
  render(<LabelStyleModal opened onClose={() => {}} initialHtml={initialHtml} />);
}

describe("LabelStyleModal", () => {
  it("renders the workspace editor layout", () => {
    renderModal();

    expect(document.querySelector(".sandbox__topbar")).not.toBeNull();
    expect(document.querySelector(".sandbox__workspace")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--controls")).not.toBeNull();
    expect(document.querySelector(".sandbox__panel--output")).not.toBeNull();
  });

  it("seeds the title box with the existing title, entities and all", () => {
    renderModal('<span style="color: #f00">Frost &amp; Flame</span>');

    /* 样例文案只在从零开始时出现；带着称号进来就该看到自己的称号。 */
    expect(screen.getByLabelText("sandbox.aria.labelInput")).toHaveValue("Frost & Flame");
  });

  it("falls back to the sample copy only when there is no title to load", () => {
    renderModal();

    expect(screen.getByLabelText("sandbox.aria.labelInput")).toHaveValue("sandbox.defaultTitle");
  });

  /*
   * 打开编辑器看到的必须是这枚标签现在的样子。只读文本、样式一律用出厂默认的话，
   * 预览和下面那行 meta 说的是两回事，随手动一下滑块就把原来的颜色字号整段换掉。
   */
  it("loads the existing label's colour, opacity and typography into the controls", () => {
    renderModal(
      '<span style="color: rgba(212, 168, 67, 0.60); font-weight: 500; font-style: italic;'
      + ' text-decoration: underline; font-size: 24px; letter-spacing: 0.05em;'
      + ' display: inline-block">Veteran</span>',
    );

    const meta = document.querySelector(".sandbox__preview-meta") as HTMLElement;
    expect(meta).toHaveTextContent("#D4A843");
    expect(meta, "透明度藏在 rgba 的第四位里，也要读回滑块").toHaveTextContent("60%");
    expect(meta).toHaveTextContent("24px");
    expect(meta, "font-weight: 500 是「不加粗」，控件不能停在默认的加粗上")
      .toHaveTextContent("sandbox.preview.fontWeight.regular");
    expect(meta).toHaveTextContent("sandbox.preview.italic");
    expect(meta).toHaveTextContent("sandbox.preview.underline");

    /* 预览走的是控件生成的那一份，读回来的值必须原样再生成一遍。 */
    const rendered = document.querySelector(".sandbox__preview-rendered") as HTMLElement;
    expect(rendered.innerHTML).toContain("rgba(212, 168, 67, 0.60)");
    expect(rendered.innerHTML).toContain("font-size: 24px");
    expect(rendered.innerHTML).toContain("letter-spacing: 0.05em");
  });

  /* 徽章另存的色号只是药丸底色；标签自己写着的那一个才是预览里看得见的颜色。 */
  it("prefers the colour written into the label over the caller's stored colour", () => {
    render(
      <LabelStyleModal
        opened
        onClose={() => {}}
        initialHtml='<span style="color: #ff0000">Veteran</span>'
        initialColor="#00ff00"
      />,
    );

    expect(document.querySelector(".sandbox__preview-meta")).toHaveTextContent("#FF0000");
  });

  /* 控件表达不了的标记原样留着，不能拿一段生成的 span 顶替掉它。 */
  it("keeps markup the controls cannot express instead of regenerating it", () => {
    renderModal("<b>Hero</b>");

    const rendered = document.querySelector(".sandbox__preview-rendered") as HTMLElement;
    expect(rendered.innerHTML).toBe("<b>Hero</b>");
  });

  it("switches an initial title to generated markup when a design control changes", () => {
    renderModal("<strong>Existing title</strong>");

    const preview = document.querySelector(".sandbox__preview-rendered");
    expect(preview).toHaveTextContent("Existing title");

    fireEvent.change(screen.getByLabelText("sandbox.aria.labelInput"), {
      target: { value: "Updated title" },
    });

    expect(preview).toHaveTextContent("Updated title");
    expect(preview).not.toHaveTextContent("Existing title");
  });

  it("switches manual markup back to generated markup when typography changes", () => {
    renderModal();

    const preview = document.querySelector(".sandbox__preview-rendered");
    fireEvent.change(screen.getByLabelText("sandbox.aria.customHtmlOverride"), {
      target: { value: "<em>Manual title</em>" },
    });
    expect(preview).toHaveTextContent("Manual title");

    fireEvent.click(screen.getByLabelText("sandbox.aria.toggleUnderline"));

    expect(preview).toHaveTextContent("sandbox.defaultTitle");
    expect(preview).not.toHaveTextContent("Manual title");
  });

  /*
   * 徽章那边把色号单独存一份（药丸底色），所以应用时必须连色号一起交出来，
   * 而不是只丢一段 HTML 让调用方自己去里面抠 `color:`。
   */
  it("hands back the markup and the colour together, and takes a three-digit seed", () => {
    const onApply = vi.fn();
    render(
      <LabelStyleModal
        opened
        onClose={() => {}}
        initialColor="#0f0"
        defaultText="Star"
        applyLabel="apply"
        onApply={onApply}
      />,
    );

    expect(screen.getByLabelText("sandbox.aria.labelInput"), "调用方给了样例文案就不该再出现称号那一句")
      .toHaveValue("Star");

    fireEvent.click(screen.getByRole("button", { name: "apply" }));

    expect(onApply).toHaveBeenCalledWith({
      html: expect.stringContaining("Star"),
      color: "#00ff00",
    });
    expect(onApply.mock.calls[0]?.[0].html).toContain("rgba(0, 255, 0");
  });

  it("uses neutral bilingual preview copy instead of a guild-specific title", () => {
    expect(enTools["sandbox.defaultTitle"]).toBe("Title Preview");
    expect(zhTools["sandbox.defaultTitle"]).toBe("称号预览");
  });
});
