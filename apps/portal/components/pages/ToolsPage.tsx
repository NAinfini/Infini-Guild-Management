import { PortalCard } from "../shared/PortalCard";
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
import { useLocalStorage } from "@mantine/hooks";
import { CopyIcon, WrenchIcon } from "@portal/components/icons";
import {
  IconBold,
  IconItalic,
  IconLetterSpacing,
  IconPalette,
  IconStrikethrough,
  IconTextSize,
  IconUnderline,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { notifySuccess } from "../../utils/notifications";
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
  };

  const commitColor = (value: string) => {
    if (isExternalView) return;
    setColor(value);
    setRecentColors((current) => {
      const next = [value.toLowerCase(), ...current.filter((item) => item.toLowerCase() !== value.toLowerCase())];
      return next.slice(0, 5);
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
    <PageLayout title={t("title")} subtitle={t("subtitle")} icon={<WrenchIcon size={22} />}>
      {isExternalView ? (
        <Alert color="blue" title={t("sandbox.readOnlyHint")} />
      ) : null}

      <PageLayout.Grid cols={{ xs: 2, sm: 3, md: 5 }} gap={16}>
        {toolCards.map((tool) => (
          <PortalCard
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
          </PortalCard>
        ))}
      </PageLayout.Grid>

      <Modal title={t("sandbox.title")} opened={sandboxOpened} onClose={sandboxHandlers.close} size={1120}>
        <div className={isExternalView ? "tools-readonly" : undefined}>
          <div className="sandbox">
            <div className="sandbox__topbar">
              <div className="sandbox__section sandbox__title-section">
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
            </div>

            <div className="sandbox__workspace">
              <div className="sandbox__panel sandbox__panel--controls">
                <div className="sandbox__section">
                  <Text size="xs" fw={600} c="dimmed" className="sandbox__section-label">
                    <IconPalette size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
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

                  <div className="sandbox__opacity-wrap" style={{ marginTop: 12 }}>
                    <Text size="xs" c="dimmed">{t("sandbox.label.opacity")}</Text>
                    <Slider min={0} max={100} value={opacity} onChange={setOpacity} aria-label={t("sandbox.aria.opacitySlider")} disabled={isExternalView} className="sandbox__opacity-slider" />
                    <Text size="xs" fw={500} className="sandbox__opacity-value">{opacity}%</Text>
                  </div>

                  {recentColors.length > 0 ? (
                    <div className="sandbox__recent">
                      <Text size="xs" c="dimmed">{t("sandbox.label.recent")}</Text>
                      <div className="sandbox__recent-list">
                        {recentColors.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="sandbox__recent-btn"
                            onClick={() => commitColor(c)}
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

                  <div className="sandbox__slider-row">
                    <IconTextSize size={15} className="sandbox__slider-icon" />
                    <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.size")}</Text>
                    <Slider min={10} max={48} value={fontSize} onChange={setFontSize} disabled={isExternalView} className="sandbox__slider" />
                    <Text size="xs" fw={500} className="sandbox__slider-value">{fontSize}px</Text>
                  </div>

                  <div className="sandbox__slider-row">
                    <IconLetterSpacing size={15} className="sandbox__slider-icon" />
                    <Text size="xs" c="dimmed" className="sandbox__slider-label">{t("sandbox.label.spacing")}</Text>
                    <Slider min={-5} max={20} value={letterSpacing} onChange={setLetterSpacing} disabled={isExternalView} className="sandbox__slider" />
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
                    value={manualHtml || generatedHtml}
                    minRows={3}
                    onChange={(event) => setManualHtml(event.currentTarget.value)}
                    placeholder={t("sandbox.manualOverridePlaceholder")}
                    aria-label={t("sandbox.aria.customHtmlOverride")}
                    disabled={isExternalView}
                    className="sandbox__override-textarea"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </PageLayout>
  );
}

