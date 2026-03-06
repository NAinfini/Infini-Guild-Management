import { DepthButton, InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  Group,
  Modal,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBold,
  IconCopy,
  IconItalic,
  IconLetterSpacing,
  IconPalette,
  IconStrikethrough,
  IconTextSize,
  IconTool,
  IconUnderline,
} from "@tabler/icons-react";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExternalView } from "../../hooks/useExternalView";
import { copyPlainText } from "../../utils/copy";
import { FormatPainterOutlined } from "../../utils/icons";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";

const RECENT_COLORS_STORAGE_KEY = "tools.recentColors";
const OPACITY_STORAGE_KEY = "tools.opacity";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sat = clamp(s, 0, 100) / 100;
  const lig = clamp(l, 0, 100) / 100;
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255)
    .toString(16)
    .padStart(2, "0");
}

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();

  const [titleText, setTitleText] = useState("Guild Vanguard");
  const [hue, setHue] = useState(210);
  const [saturation, setSaturation] = useState(88);
  const [lightness, setLightness] = useState(57);
  const [opacity, setOpacity] = useState(100);
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strikethrough, setStrikethrough] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [letterSpacing, setLetterSpacing] = useState(2);
  const [manualHtml, setManualHtml] = useState("");
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const slPickerRef = useRef<HTMLDivElement | null>(null);

  const presets = useMemo(
    () => ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"],
    [],
  );

  const rgb = useMemo(() => hslToRgb(hue, saturation, lightness), [hue, saturation, lightness]);
  const hexColor = `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
  const alpha = opacity / 100;

  const generatedHtml = useMemo(() => {
    const decorations: string[] = [];
    if (underline) decorations.push("underline");
    if (strikethrough) decorations.push("line-through");
    const textDecoration = decorations.length > 0 ? decorations.join(" ") : "none";

    const styleParts = [
      `color: rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha.toFixed(2)})`,
      bold ? "font-weight: 700" : "font-weight: 500",
      italic ? "font-style: italic" : "font-style: normal",
      `text-decoration: ${textDecoration}`,
      `font-size: ${fontSize}px`,
      `letter-spacing: ${(letterSpacing / 100).toFixed(2)}em`,
      "display: inline-block",
    ];
    const safeText = titleText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
    return `<span style="${styleParts.join("; ")}">${safeText}</span>`;
  }, [alpha, bold, fontSize, italic, letterSpacing, rgb.b, rgb.g, rgb.r, strikethrough, titleText, underline]);

  const safeHtml = useMemo(() => DOMPurify.sanitize(manualHtml.trim() || generatedHtml), [generatedHtml, manualHtml]);
  const previewMetaText = useMemo(() => {
    const segments = [
      hexColor.toUpperCase(),
      `${opacity}%`,
      `${fontSize}px`,
      bold ? t("sandbox.preview.fontWeight.bold") : t("sandbox.preview.fontWeight.regular"),
    ];
    if (italic) {
      segments.push(t("sandbox.preview.italic"));
    }
    if (underline) {
      segments.push(t("sandbox.preview.underline"));
    }
    if (strikethrough) {
      segments.push(t("sandbox.preview.strikethrough"));
    }
    return segments.join(" · ");
  }, [bold, fontSize, hexColor, italic, opacity, strikethrough, t, underline]);

  useEffect(() => {
    const rawRecent = localStorage.getItem(RECENT_COLORS_STORAGE_KEY);
    if (rawRecent) {
      try {
        const parsed = JSON.parse(rawRecent) as unknown;
        if (Array.isArray(parsed)) {
          const next = parsed.filter((item): item is string => typeof item === "string").slice(0, 8);
          setRecentColors(next);
        }
      } catch {
        // ignore invalid persisted value
      }
    }

    const rawOpacity = Number.parseInt(localStorage.getItem(OPACITY_STORAGE_KEY) ?? "", 10);
    if (Number.isFinite(rawOpacity)) {
      setOpacity(clamp(rawOpacity, 0, 100));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(RECENT_COLORS_STORAGE_KEY, JSON.stringify(recentColors.slice(0, 8)));
  }, [recentColors]);

  useEffect(() => {
    localStorage.setItem(OPACITY_STORAGE_KEY, String(opacity));
  }, [opacity]);

  const applyHexColor = (value: string) => {
    if (isExternalView) {
      return;
    }
    const parsed = hexToRgb(value);
    if (!parsed) return;
    const converted = rgbToHsl(parsed.r, parsed.g, parsed.b);
    setHue(converted.h);
    setSaturation(converted.s);
    setLightness(converted.l);
    setRecentColors((current) => {
      const next = [value.toLowerCase(), ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())];
      return next.slice(0, 8);
    });
  };

  const setSatLightFromPointer = (clientX: number, clientY: number) => {
    if (isExternalView) {
      return;
    }
    const element = slPickerRef.current;
    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const x = clamp((clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((clientY - rect.top) / rect.height, 0, 1);
    setSaturation(Math.round(x * 100));
    setLightness(Math.round((1 - y) * 100));
  };

  const [openModal, setOpenModal] = useState<string | null>(null);

  const toolCards = [
    {
      key: "sandbox",
      icon: <FormatPainterOutlined />,
      title: t("sandbox.title"),
      description: t("sandbox.description"),
    },
  ];

  return (
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<IconTool size={22} />}>
      {isExternalView ? (
        <Alert color="infini-primary" title={t("sandbox.readOnlyHint")} />
      ) : null}

      <PageLayout.Grid cols={{ xs: 2, sm: 3, md: 5 }} gap={16}>
        {toolCards.map((tool) => (
          <InfiniCard
            key={tool.key}
            className="tool-card"
          >
            <button
              type="button"
              className="tool-card__btn"
              onClick={() => {
                if (isExternalView) return;
                setOpenModal(tool.key);
              }}
            >
              <div className="tool-card__content">
                <Title order={5} className="tool-card__title">
                  {tool.title}
                </Title>
                <Text c="dimmed" className="tool-card__description">
                  {tool.description}
                </Text>
              </div>
              <div className="tool-card__icon-wrap">
                <div className="tool-card__icon">{tool.icon}</div>
              </div>
            </button>
          </InfiniCard>
        ))}
      </PageLayout.Grid>

      <Modal title={t("sandbox.title")} opened={openModal === "sandbox"} onClose={() => setOpenModal(null)} size={920}>
        <div className={isExternalView ? "tools-readonly" : undefined}>
          <div className="sandbox">
            {/* ── Left: Controls ── */}
            <div className="sandbox__controls">
              {/* Title input */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.titleText")}</Text>
                <TextInput
                  value={titleText}
                  onChange={(event) => setTitleText(event.currentTarget.value)}
                  placeholder={t("sandbox.placeholder")}
                  aria-label={t("sandbox.aria.titleInput")}
                  disabled={isExternalView}
                />
              </div>

              {/* Color section */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">
                  <IconPalette size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  {t("sandbox.section.color")}
                </Text>

                <div className="sandbox__color-row">
                  {/* Hue strip */}
                  <div className="sandbox__hue-wrap">
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={hue}
                      onChange={(event) => setHue(Number(event.currentTarget.value))}
                      className="sandbox__hue-slider"
                      aria-label={t("sandbox.aria.hueSlider")}
                      disabled={isExternalView}
                    />
                  </div>

                  {/* SL picker */}
                  <div
                    ref={slPickerRef}
                    role="application"
                    aria-label={t("sandbox.aria.saturationLightnessPicker")}
                    className="sandbox__sl-picker"
                    onMouseDown={(event) => {
                      setSatLightFromPointer(event.clientX, event.clientY);
                      const onMove = (moveEvent: MouseEvent) => setSatLightFromPointer(moveEvent.clientX, moveEvent.clientY);
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }}
                    style={{
                      background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${hue}, 100%, 50%))`,
                    }}
                  >
                    <div
                      className="sandbox__sl-thumb"
                      style={{
                        left: `${saturation}%`,
                        top: `${100 - lightness}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Hex + native picker + opacity */}
                <div className="sandbox__color-inputs">
                  <div className="sandbox__hex-group">
                    <div className="sandbox__color-swatch" style={{ background: hexColor }} />
                    <TextInput
                      value={hexColor}
                      onChange={(event) => applyHexColor(event.currentTarget.value)}
                      className="sandbox__hex-input"
                      placeholder="#1f6feb"
                      aria-label={t("sandbox.aria.hexInput")}
                      disabled={isExternalView}
                    />
                    <input
                      type="color"
                      value={hexColor}
                      onChange={(event) => applyHexColor(event.currentTarget.value)}
                      className="sandbox__native-picker"
                      aria-label={t("sandbox.aria.nativeColorPicker")}
                      disabled={isExternalView}
                    />
                  </div>
                  <div className="sandbox__opacity-wrap">
                    <Text size="xs" c="dimmed">{t("sandbox.label.opacity")}</Text>
                    <Slider min={0} max={100} value={opacity} onChange={setOpacity} aria-label={t("sandbox.aria.opacitySlider")} disabled={isExternalView} className="sandbox__opacity-slider" />
                    <Text size="xs" fw={500} className="sandbox__opacity-value">{opacity}%</Text>
                  </div>
                </div>

                {/* Preset colors */}
                <div className="sandbox__presets">
                  {presets.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`sandbox__preset-btn${hexColor.toLowerCase() === color ? " sandbox__preset-btn--active" : ""}`}
                      style={{ background: color }}
                      onClick={() => applyHexColor(color)}
                      aria-label={t("sandbox.aria.useColor", { color })}
                      disabled={isExternalView}
                    />
                  ))}
                </div>

                {/* Recent colors */}
                {recentColors.length > 0 ? (
                  <div className="sandbox__recent">
                    <Text size="xs" c="dimmed">{t("sandbox.label.recent")}</Text>
                    <div className="sandbox__recent-list">
                      {recentColors.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className="sandbox__recent-btn"
                          onClick={() => applyHexColor(color)}
                          aria-label={t("sandbox.aria.useRecentColor", { color })}
                          disabled={isExternalView}
                        >
                          <span className="sandbox__recent-dot" style={{ background: color }} />
                          <span>{color}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Typography */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.typography")}</Text>
                <div className="sandbox__typo-toggles">
                  <button
                    type="button"
                    className={`sandbox__typo-btn${bold ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => setBold(!bold)}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleBold")}
                  >
                    <IconBold size={16} />
                    <span>{t("sandbox.button.bold")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${italic ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => setItalic(!italic)}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleItalic")}
                  >
                    <IconItalic size={16} />
                    <span>{t("sandbox.button.italic")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${underline ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => setUnderline(!underline)}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleUnderline")}
                  >
                    <IconUnderline size={16} />
                    <span>{t("sandbox.button.underline")}</span>
                  </button>
                  <button
                    type="button"
                    className={`sandbox__typo-btn${strikethrough ? " sandbox__typo-btn--active" : ""}`}
                    onClick={() => setStrikethrough(!strikethrough)}
                    disabled={isExternalView}
                    aria-label={t("sandbox.aria.toggleStrikethrough")}
                  >
                    <IconStrikethrough size={16} />
                    <span>{t("sandbox.button.strike")}</span>
                  </button>
                </div>

                {/* Font size */}
                <div className="sandbox__slider-row">
                  <IconTextSize size={15} className="sandbox__slider-icon" />
                  <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.size")}</Text>
                  <Slider min={10} max={48} value={fontSize} onChange={setFontSize} disabled={isExternalView} className="sandbox__slider" />
                  <Text size="xs" fw={500} className="sandbox__slider-value">{fontSize}px</Text>
                </div>

                {/* Letter spacing */}
                <div className="sandbox__slider-row">
                  <IconLetterSpacing size={15} className="sandbox__slider-icon" />
                  <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.spacing")}</Text>
                  <Slider min={-5} max={20} value={letterSpacing} onChange={setLetterSpacing} disabled={isExternalView} className="sandbox__slider" />
                  <Text size="xs" fw={500} className="sandbox__slider-value">{(letterSpacing / 100).toFixed(2)}em</Text>
                </div>
              </div>
            </div>

            {/* ── Right: Preview + Output ── */}
            <div className="sandbox__output">
              {/* Live preview */}
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

              {/* HTML output */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.generatedHtml")}</Text>
                <div className="sandbox__code-block">
                  <code className="sandbox__code-text">{generatedHtml}</code>
                </div>
              </div>

              {/* Manual override */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">{t("sandbox.section.customHtmlOverride")}</Text>
                <Textarea
                  value={manualHtml}
                  minRows={3}
                  onChange={(event) => setManualHtml(event.currentTarget.value)}
                  placeholder={t("sandbox.manualOverridePlaceholder")}
                  aria-label={t("sandbox.aria.customHtmlOverride")}
                  disabled={isExternalView}
                  className="sandbox__override-textarea"
                />
              </div>

              {/* Action buttons */}
              <Group gap={8}>
                <DepthButton
                  onClick={() => {
                    void copyPlainText(generatedHtml);
                    notifications.show({ color: "infini-success", message: t("message.generatedHtmlCopied") });
                  }}
                  type="secondary"
                  size="sm"
                  before={<IconCopy size={14} />}
                >
                  {t("sandbox.copyHtml")}
                </DepthButton>
              </Group>
            </div>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}

