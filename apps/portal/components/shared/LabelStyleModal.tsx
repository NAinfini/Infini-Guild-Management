import {
  Button,
  ColorPicker,
  Group,
  Modal,
  Slider,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
  BoldIcon,
  CopyIcon,
  ItalicIcon,
  LetterSpacingIcon,
  PaletteIcon,
  StrikethroughIcon,
  TextSizeIcon,
  UnderlineIcon,
} from "@portal/components/icons";
import { useExternalView } from "@portal/hooks/useExternalView";
import { copyPlainText } from "@portal/utils/copy";
import { notifySuccess } from "@portal/utils/notifications";
import { sanitizeTitleHtml } from "@portal/utils/sanitize";
import DOMPurify from "dompurify";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
/* 样式跟着组件走。留在 ToolsPage.css 里的话，没先逛过工具页就从资料页打开，
   这个弹窗是没有样式的。 */
import "./LabelStyleModal.css";

const PRESET_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];

/** 取色器和调用方存下来的色号（徽章色允许三位写法）统一成六位，rgba 拼接只认六位。 */
function normalizeHex(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const body = match[1] as string;
  return body.length === 3
    ? `#${[...body].map((channel) => channel + channel).join("")}`
    : `#${body}`;
}

type LabelSeed = {
  text: string;
  /** 控件能不能表达这段 HTML。不能的话预览原样显示它，不拿控件那一套去顶替。 */
  representable: boolean;
  color?: string;
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: number;
  letterSpacing?: number;
};

/** `color:` 收下 #rgb / #rrggbb / rgb() / rgba()，透明度就藏在 rgba 的第四位里。 */
function readColorDeclaration(value: string): { color: string; opacity: number } | null {
  const hex = normalizeHex(value);
  if (hex) return { color: hex, opacity: 100 };
  const parts = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  if (!parts) return null;
  const channel = (raw: string) => Math.min(255, Number(raw)).toString(16).padStart(2, "0");
  const alpha = parts[4] === undefined ? 1 : Number(parts[4]);
  return {
    color: `#${channel(parts[1] as string)}${channel(parts[2] as string)}${channel(parts[3] as string)}`,
    opacity: Math.round(alpha * 100),
  };
}

function clampToSlider(value: number, min: number, max: number): number | null {
  const rounded = Math.round(value);
  return rounded === value && rounded >= min && rounded <= max ? rounded : null;
}

/**
 * 把现有标签读回控件。
 *
 * 只认文本、不认样式的话，编辑器一打开就在撒谎：预览里是这枚标签真正的样子，
 * 控件和下面那行 `#XXXXXX · 100% · 16px` 说的却是出厂默认值，随手动一下滑块就把
 * 原来的颜色和字号整段换掉。所以样式必须和文本一起读回来。
 *
 * 读不回来的（多层标签、认不出的声明）标成 representable: false：那种 HTML 留给
 * 手写框原样保管，控件只拿读得懂的部分当参考，不假装能生成它。
 */
function readLabelSeed(html: string | undefined): LabelSeed {
  const trimmed = html?.trim();
  if (!trimmed) return { text: "", representable: true };

  const body = new DOMParser().parseFromString(sanitizeTitleHtml(trimmed), "text/html").body;
  const text = body.textContent ?? "";
  const element = body.children[0];
  /* 纯文本没有样式可读，但控件生成得出来——照样算 representable。 */
  if (body.children.length === 0) return { text, representable: true };
  const isLoneSpan = body.children.length === 1
    && element?.tagName === "SPAN"
    && element.children.length === 0
    && (element.textContent ?? "") === text;
  if (!isLoneSpan) return { text, representable: false };

  const seed: LabelSeed = { text, representable: true };
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!name || !value) continue;

    switch (name) {
      case "color": {
        const parsed = readColorDeclaration(value);
        if (!parsed) { seed.representable = false; break; }
        seed.color = parsed.color;
        seed.opacity = clampToSlider(parsed.opacity, 0, 100) ?? 100;
        break;
      }
      case "font-weight": {
        const numeric = Number(value);
        if (value === "bold") seed.bold = true;
        else if (value === "normal") seed.bold = false;
        else if (Number.isFinite(numeric)) seed.bold = numeric >= 600;
        else seed.representable = false;
        break;
      }
      case "font-style":
        if (value === "italic" || value === "normal") seed.italic = value === "italic";
        else seed.representable = false;
        break;
      case "text-decoration":
      case "text-decoration-line": {
        const tokens = value.split(/\s+/);
        if (!tokens.every((token) => token === "underline" || token === "line-through" || token === "none")) {
          seed.representable = false;
          break;
        }
        seed.underline = tokens.includes("underline");
        seed.strikethrough = tokens.includes("line-through");
        break;
      }
      case "font-size": {
        const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
        const size = px ? clampToSlider(Number(px[1]), 10, 48) : null;
        if (size === null) seed.representable = false;
        else seed.fontSize = size;
        break;
      }
      case "letter-spacing": {
        const em = /^(-?\d*\.?\d+)em$/.exec(value);
        const spacing = em ? clampToSlider(Number(em[1]) * 100, -5, 20) : null;
        if (spacing === null) seed.representable = false;
        else seed.letterSpacing = spacing;
        break;
      }
      /* 生成的 HTML 自己就带这一条，别的取值控件表达不了。 */
      case "display":
        if (value !== "inline-block") seed.representable = false;
        break;
      default:
        seed.representable = false;
    }
  }
  return seed;
}

export type LabelStyleResult = {
  /** 已清洗的 HTML 片段。 */
  html: string;
  /** 取色器当前的色号，供调用方另存一份（徽章药丸底色就是它）。 */
  color: string;
};

type LabelStyleModalProps = {
  opened: boolean;
  onClose: () => void;
  /** 弹窗标题；默认是称号沙盒那一套文案。 */
  heading?: string;
  /**
   * 现有标签：文本和样式一起读进控件（readLabelSeed），所以打开就是它现在的样子。
   * Mount the modal conditionally when passing this — the seed is initial state,
   * so a permanently mounted instance would keep the label it opened with.
   */
  initialHtml?: string;
  /** 调用方自己存的色号（徽章色）；只在标签本身没写颜色时兜底。 */
  initialColor?: string;
  /** 从零开始时文本框里的样例文案。 */
  defaultText?: string;
  /** Present only when the modal is being used as an editor rather than a scratchpad. */
  onApply?: (result: LabelStyleResult) => void;
  applyLabel?: string;
};

type HtmlSource = "generated" | "manual";

/**
 * 行内样式片段编辑器：成员称号和徽章标签是同一种内容（同一份标签白名单、
 * 同一种 `<span style>` 产物），所以只有这一个编辑器。
 */
export function LabelStyleModal({
  opened,
  onClose,
  heading,
  initialHtml,
  initialColor,
  defaultText,
  onApply,
  applyLabel,
}: LabelStyleModalProps) {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  /* 只读一次：所有控件的初值都从这一份来，之后归控件自己管。 */
  const [seed] = useState(() => readLabelSeed(initialHtml));
  /* 带着现有内容进来时，文本框里放的必须是那一份；样例文案只在从零开始时出现。 */
  const [labelText, setLabelText] = useState(
    () => seed.text.trim() || defaultText || t("sandbox.defaultTitle"),
  );
  /*
   * 色号优先取标签自己写着的那一个——它才是预览里看得见的颜色。徽章另存的
   * initialColor 只在标签没写颜色（纯文本标签）时兜底，最后才是预设首色。
   */
  const [color, setColor] = useState(
    () => seed.color ?? (initialColor ? normalizeHex(initialColor) : null) ?? (PRESET_COLORS[0] as string),
  );
  const [opacity, setOpacity] = useState(seed.opacity ?? 100);
  const [recentColors, setRecentColors] = useLocalStorage<string[]>({ key: "tools.recentColors", defaultValue: [] });
  const [bold, setBold] = useState(seed.bold ?? true);
  const [italic, setItalic] = useState(seed.italic ?? false);
  const [underline, setUnderline] = useState(seed.underline ?? false);
  const [strikethrough, setStrikethrough] = useState(seed.strikethrough ?? false);
  const [fontSize, setFontSize] = useState(seed.fontSize ?? 16);
  const [letterSpacing, setLetterSpacing] = useState(seed.letterSpacing ?? 2);
  const [manualHtml, setManualHtml] = useState(initialHtml ?? "");
  /* 控件已经装着这枚标签的样式了，所以照常走生成；只有控件表达不了的 HTML
     才交给手写框原样保管。 */
  const [htmlSource, setHtmlSource] = useState<HtmlSource>(
    seed.representable ? "generated" : "manual",
  );

  const useGeneratedHtml = () => setHtmlSource("generated");

  const applyColor = (value: string) => {
    if (isExternalView) return;
    setColor(value);
    useGeneratedHtml();
  };

  const commitColor = (value: string) => {
    if (isExternalView) return;
    setColor(value);
    useGeneratedHtml();
    setRecentColors((current) => {
      const next = [value.toLowerCase(), ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())];
      return next.slice(0, 5);
    });
  };

  const alpha = opacity / 100;
  /* color 恒为 #rrggbb：初值经 normalizeHex，之后只由 format="hex" 的取色器和
     它自己存下的历史色写入。 */
  const rgbaColor = `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${alpha.toFixed(2)})`;

  const generatedHtml = useMemo(() => {
    const decorations: string[] = [];
    if (underline) decorations.push("underline");
    if (strikethrough) decorations.push("line-through");
    const textDecoration = decorations.length > 0 ? decorations.join(" ") : "none";

    const styleParts = [
      `color: ${rgbaColor}`,
      bold ? "font-weight: 700" : "font-weight: 500",
      italic ? "font-style: italic" : "font-style: normal",
      `text-decoration: ${textDecoration}`,
      `font-size: ${fontSize}px`,
      `letter-spacing: ${(letterSpacing / 100).toFixed(2)}em`,
      "display: inline-block",
    ];
    const safeText = labelText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    return `<span style="${styleParts.join("; ")}">${safeText}</span>`;
  }, [bold, fontSize, italic, labelText, letterSpacing, rgbaColor, strikethrough, underline]);

  const sourceHtml = htmlSource === "manual" ? manualHtml : generatedHtml;
  const safeHtml = useMemo(() => DOMPurify.sanitize(sourceHtml), [sourceHtml]);
  const previewMetaText = useMemo(() => {
    const segments = [
      color.toUpperCase(),
      `${opacity}%`,
      `${fontSize}px`,
      bold ? t("sandbox.preview.fontWeight.bold") : t("sandbox.preview.fontWeight.regular"),
    ];
    if (italic) segments.push(t("sandbox.preview.italic"));
    if (underline) segments.push(t("sandbox.preview.underline"));
    if (strikethrough) segments.push(t("sandbox.preview.strikethrough"));
    return segments.join(" · ");
  }, [bold, fontSize, color, italic, opacity, strikethrough, t, underline]);

  return (
    <Modal title={heading ?? t("sandbox.title")} opened={opened} onClose={onClose} size={1120}>
      <div className={isExternalView ? "sandbox--readonly" : undefined}>
        <div className="sandbox">
          <div className="sandbox__topbar">
            <div className="sandbox__section sandbox__title-section">
              <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.labelText")}</Text>
              <TextInput
                value={labelText}
                onChange={(event) => {
                  setLabelText(event.currentTarget.value);
                  useGeneratedHtml();
                }}
                placeholder={t("sandbox.placeholder")}
                aria-label={t("sandbox.aria.labelInput")}
                disabled={isExternalView}
                maxLength={200}
              />
            </div>
          </div>

          <div className="sandbox__workspace">
            <div className="sandbox__panel sandbox__panel--controls">
              <div className="sandbox__section">
                {/* span, not the default <p>: PaletteIcon renders a <div>, and a
                    block element inside <p> is invalid HTML that React flags. */}
                <Text component="span" size="xs" fw={600} c="dimmed" className="sandbox__section-label">
                  <PaletteIcon size={14} className="sandbox__section-icon" />
                  {t("sandbox.section.color")}
                </Text>

                <ColorPicker
                  value={color}
                  onChange={applyColor}
                  onChangeEnd={commitColor}
                  format="hex"
                  swatches={PRESET_COLORS}
                  style={{ width: "100%", pointerEvents: isExternalView ? "none" : "auto", opacity: isExternalView ? 0.5 : 1 }}
                />

                <div className="sandbox__opacity-wrap">
                  <Text size="xs" c="dimmed">{t("sandbox.label.opacity")}</Text>
                  <Slider
                    min={0}
                    max={100}
                    value={opacity}
                    onChange={(value) => {
                      setOpacity(value);
                      useGeneratedHtml();
                    }}
                    aria-label={t("sandbox.aria.opacitySlider")}
                    disabled={isExternalView}
                    className="sandbox__opacity-slider"
                  />
                  <Text size="xs" fw={500} className="sandbox__opacity-value">{opacity}%</Text>
                </div>

                {recentColors.length > 0 ? (
                  <div className="sandbox__recent">
                    <Text size="xs" c="dimmed">{t("sandbox.label.recent")}</Text>
                    <div className="sandbox__recent-list">
                      {recentColors.map((recentColor) => (
                        <button
                          key={recentColor}
                          type="button"
                          className="sandbox__recent-btn"
                          onClick={() => commitColor(recentColor)}
                          aria-label={t("sandbox.aria.useRecentColor", { color: recentColor })}
                          disabled={isExternalView}
                        >
                          <span className="sandbox__recent-dot" style={{ "--swatch-color": recentColor } as React.CSSProperties} />
                          <span>{recentColor}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.typography")}</Text>
                <div className="sandbox__typo-toggles">
                  <button
                    type="button"
                    className={`sandbox__typo-btn${bold ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => {
                      setBold(!bold);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleBold")}
                  >
                    <BoldIcon size={16} />
                    <span>{t("sandbox.button.bold")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${italic ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => {
                      setItalic(!italic);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleItalic")}
                  >
                    <ItalicIcon size={16} />
                    <span>{t("sandbox.button.italic")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${underline ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => {
                      setUnderline(!underline);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleUnderline")}
                  >
                    <UnderlineIcon size={16} />
                    <span>{t("sandbox.button.underline")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${strikethrough ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => {
                      setStrikethrough(!strikethrough);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleStrikethrough")}
                  >
                    <StrikethroughIcon size={16} />
                    <span>{t("sandbox.button.strike")}</span>
                  </button>
                </div>

                <div className="sandbox__slider-row">
                  <TextSizeIcon size={15} className="sandbox__slider-icon" />
                  <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.size")}</Text>
                  <Slider
                    min={10}
                    max={48}
                    value={fontSize}
                    onChange={(value) => {
                      setFontSize(value);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    className="sandbox__slider"
                  />
                  <Text size="xs" fw={500} className="sandbox__slider-value">{fontSize}px</Text>
                </div>

                <div className="sandbox__slider-row">
                  <LetterSpacingIcon size={15} className="sandbox__slider-icon" />
                  <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.spacing")}</Text>
                  <Slider
                    min={-5}
                    max={20}
                    value={letterSpacing}
                    onChange={(value) => {
                      setLetterSpacing(value);
                      useGeneratedHtml();
                    }}
                    disabled={isExternalView}
                    className="sandbox__slider"
                  />
                  <Text size="xs" fw={500} className="sandbox__slider-value">{(letterSpacing / 100).toFixed(2)}em</Text>
                </div>
              </div>
            </div>

            <div className="sandbox__panel sandbox__panel--output">
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.livePreview")}</Text>
                <div className="sandbox__preview-card">
                  <div className="sandbox__preview-bg">
                    <div className="sandbox__preview-rendered" dangerouslySetInnerHTML={{ __html: safeHtml }} />
                  </div>
                  <div className="sandbox__preview-meta">
                    <Text size="xs" c="dimmed">
                      {previewMetaText}
                    </Text>
                  </div>
                </div>
              </div>

              <div className="sandbox__section">
                <Group gap={6} align="center" className="sandbox__section-label">
                  <Text size="xs" fw={600} c="dimmed">{t("sandbox.section.htmlSource")}</Text>
                  <button
                    type="button"
                    className="sandbox__copy-icon-btn"
                    onClick={() => {
                      void copyPlainText(safeHtml);
                      notifySuccess(t("message.generatedHtmlCopied"));
                    }}
                    aria-label={t("sandbox.aria.copyGeneratedHtml")}
                  >
                    <CopyIcon size={14} />
                  </button>
                </Group>
                <Textarea
                  value={sourceHtml}
                  minRows={3}
                  onChange={(event) => {
                    setManualHtml(event.currentTarget.value);
                    setHtmlSource("manual");
                  }}
                  placeholder={t("sandbox.manualOverridePlaceholder")}
                  aria-label={t("sandbox.aria.customHtmlOverride")}
                  disabled={isExternalView}
                  className="sandbox__override-textarea"
                />
              </div>

              {onApply ? (
                <div className="sandbox__apply">
                  <Button
                    onClick={() => {
                      onApply({ html: safeHtml, color });
                      onClose();
                    }}
                    disabled={isExternalView}
                  >
                    {applyLabel ?? t("sandbox.applyToProfile")}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
