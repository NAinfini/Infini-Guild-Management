import { DepthButton, InfiniCard } from "@infini-dev-kit/frontend/components";
import {
  Alert,
  ColorPicker,
  Group,
  Modal,
  Slider,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useLocalStorage } from "@mantine/hooks";
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
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { useExternalView } from "../../hooks/useExternalView";
import { copyPlainText } from "../../utils/copy";
import { FormatPainterOutlined } from "../../utils/icons";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";
import { useMemo, useState } from "react";
import DOMPurify from "dompurify";

const PRESET_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  const [sandboxOpened, sandboxHandlers] = useDisclosure(false);

  const [titleText, setTitleText] = useState(() => t("sandbox.defaultTitle"));
  const [color, setColor] = useState("#1f6feb");
  const [opacity, setOpacity] = useLocalStorage({ key: "tools.opacity", defaultValue: 100 });
  const [recentColors, setRecentColors] = useLocalStorage<string[]>({ key: "tools.recentColors", defaultValue: [] });
  const [bold, setBold] = useState(true);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strikethrough, setStrikethrough] = useState(false);
  const [fontSize, setFontSize] = useState(16);
  const [letterSpacing, setLetterSpacing] = useState(2);
  const [manualHtml, setManualHtml] = useState("");

  const applyColor = (value: string) => {
    if (isExternalView) return;
    setColor(value);
    setRecentColors((current) => {
      const next = [value.toLowerCase(), ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())];
      return next.slice(0, 8);
    });
  };

  const alpha = opacity / 100;
  const rgbaColor = color.startsWith("#") && color.length === 7
    ? `rgba(${parseInt(color.slice(1, 3), 16)}, ${parseInt(color.slice(3, 5), 16)}, ${parseInt(color.slice(5, 7), 16)}, ${alpha.toFixed(2)})`
    : `rgba(31, 111, 235, ${alpha.toFixed(2)})`;

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
    const safeText = titleText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    return `<span style="${styleParts.join("; ")}">${safeText}</span>`;
  }, [alpha, bold, fontSize, italic, letterSpacing, rgbaColor, strikethrough, titleText, underline]);

  const safeHtml = useMemo(() => DOMPurify.sanitize(manualHtml.trim() || generatedHtml), [generatedHtml, manualHtml]);
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
                sandboxHandlers.open();
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

      <Modal title={t("sandbox.title")} opened={sandboxOpened} onClose={sandboxHandlers.close} size={920}>
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
                  maxLength={200}
                />
              </div>

              {/* Color section */}
              <div className="sandbox__section">
                <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">
                  <IconPalette size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
                  {t("sandbox.section.color")}
                </Text>

                <ColorPicker
                  value={color}
                  onChange={applyColor}
                  format="hex"
                  swatches={PRESET_COLORS}
                  style={{ width: "100%", pointerEvents: isExternalView ? "none" : "auto", opacity: isExternalView ? 0.5 : 1 }}
                />

                <div className="sandbox__opacity-wrap" style={{ marginTop: 12 }}>
                  <Text size="xs" c="dimmed">{t("sandbox.label.opacity")}</Text>
                  <Slider min={0} max={100} value={opacity} onChange={setOpacity} aria-label={t("sandbox.aria.opacitySlider")} disabled={isExternalView} className="sandbox__opacity-slider" />
                  <Text size="xs" fw={500} className="sandbox__opacity-value">{opacity}%</Text>
                </div>

                {/* Recent colors */}
                {recentColors.length > 0 ? (
                  <div className="sandbox__recent">
                    <Text size="xs" c="dimmed">{t("sandbox.label.recent")}</Text>
                    <div className="sandbox__recent-list">
                      {recentColors.map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="sandbox__recent-btn"
                          onClick={() => applyColor(c)}
                          aria-label={t("sandbox.aria.useRecentColor", { color: c })}
                          disabled={isExternalView}
                        >
                          <span className="sandbox__recent-dot" style={{ background: c }} />
                          <span>{c}</span>
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

