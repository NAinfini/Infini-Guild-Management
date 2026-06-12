import { PortalCard } from "../shared/PortalCard";
import {
  Alert,
  ColorPicker,
  Group,
  Modal,
  NumberInput,
  Slider,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { BoldIcon, CopyIcon, DiceFiveFilledIcon, ItalicIcon, LetterSpacingIcon, PaletteIcon, StrikethroughIcon, SwordsIcon, TextSizeIcon, TrashIcon, UnderlineIcon, WrenchIcon } from "@portal/components/icons";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { notifySuccess } from "../../utils/notifications";
import { useExternalView } from "../../hooks/useExternalView";
import { copyPlainText } from "../../utils/copy";
import { FormatPainterOutlined } from "../../utils/icons";
import { PageLayout } from "../layout/PageLayout";
import "./ToolsPage.css";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { useSiteConfigStore } from "@portal/stores/site-config";

const LazyEquipmentCalcModal = lazy(() =>
  import("../equipment-calc/EquipmentCalcModal").then((m) => ({ default: m.EquipmentCalcModal })),
);

const PRESET_COLORS = ["#1f6feb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#ec4899", "#0891b2", "#334155"];

const ROLL_ANIM_DURATION = 1200;
const ROLL_ANIM_INTERVAL = 60;

interface DiceHistoryEntry {
  count: number;
  sides: number;
  results: number[];
  total: number;
  timestamp: number;
}

export function ToolsPage() {
  const { t } = useTranslation("tools");
  const isExternalView = useExternalView();
  const [sandboxOpened, sandboxHandlers] = useDisclosure(false);
  const [diceOpened, diceHandlers] = useDisclosure(false);
  const [equipCalcOpened, equipCalcHandlers] = useDisclosure(false);
  const equipCalcEnabled = useSiteConfigStore((s) => s.features.tools);

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

  const [diceCount, setDiceCount] = useState(1);
  const [diceSides, setDiceSides] = useState(6);
  const [diceResults, setDiceResults] = useState<number[]>([]);
  const [diceHistory, setDiceHistory] = useLocalStorage<DiceHistoryEntry[]>({ key: "tools.diceHistory", defaultValue: [] });
  const [isRolling, setIsRolling] = useState(false);
  const rollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rollDice = useCallback(() => {
    if (isRolling || diceCount < 1 || diceSides < 2) return;
    setIsRolling(true);

    rollIntervalRef.current = setInterval(() => {
      setDiceResults(
        Array.from({ length: diceCount }, () => Math.floor(Math.random() * diceSides) + 1)
      );
    }, ROLL_ANIM_INTERVAL);

    rollTimeoutRef.current = setTimeout(() => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      const finalResults = Array.from({ length: diceCount }, () => Math.floor(Math.random() * diceSides) + 1);
      setDiceResults(finalResults);
      setIsRolling(false);
      const total = finalResults.reduce((sum, v) => sum + v, 0);
      setDiceHistory((prev) => [
        { count: diceCount, sides: diceSides, results: finalResults, total, timestamp: Date.now() },
        ...prev.slice(0, 49),
      ]);
    }, ROLL_ANIM_DURATION);
  }, [diceCount, diceSides, isRolling, setDiceHistory]);

  useEffect(() => {
    return () => {
      if (rollIntervalRef.current) clearInterval(rollIntervalRef.current);
      if (rollTimeoutRef.current) clearTimeout(rollTimeoutRef.current);
    };
  }, []);

  const diceTotal = useMemo(() => diceResults.reduce((sum, v) => sum + v, 0), [diceResults]);

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
      onOpen: sandboxHandlers.open,
    },
    {
      key: "dice",
      icon: <DiceFiveFilledIcon size={28} />,
      title: t("dice.title"),
      description: t("dice.description"),
      onOpen: diceHandlers.open,
    },
    // Equipment calculator — in-house tool (see docs/plans/2026-05-21-equipment-calculator-design.md)
    ...(equipCalcEnabled
      ? [{
          key: "equipCalc",
          icon: <SwordsIcon size={28} />,
          title: t("equipCalc.title"),
          description: t("equipCalc.description"),
          onOpen: equipCalcHandlers.open,
        }]
      : []),
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
                tool.onOpen();
              }}
            >
              <div className="tool-card__content">
                <Title order={3} className="tool-card__title">
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
                    <PaletteIcon size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
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
                      <BoldIcon size={16} />
                      <span>{t("sandbox.button.bold")}</span>
                    </button>
                    <button
                      type="button"
                      className={`sandbox__typo-btn${italic ? " sandbox__typo-btn--active" : ""}`}
                      onClick={() => setItalic(!italic)}
                      disabled={isExternalView}
                      aria-label={t("sandbox.aria.toggleItalic")}
                    >
                      <ItalicIcon size={16} />
                      <span>{t("sandbox.button.italic")}</span>
                    </button>
                    <button
                      type="button"
                      className={`sandbox__typo-btn${underline ? " sandbox__typo-btn--active" : ""}`}
                      onClick={() => setUnderline(!underline)}
                      disabled={isExternalView}
                      aria-label={t("sandbox.aria.toggleUnderline")}
                    >
                      <UnderlineIcon size={16} />
                      <span>{t("sandbox.button.underline")}</span>
                    </button>
                    <button
                      type="button"
                      className={`sandbox__typo-btn${strikethrough ? " sandbox__typo-btn--active" : ""}`}
                      onClick={() => setStrikethrough(!strikethrough)}
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
                    <Slider min={10} max={48} value={fontSize} onChange={setFontSize} disabled={isExternalView} className="sandbox__slider" />
                    <Text size="xs" fw={500} className="sandbox__slider-value">{fontSize}px</Text>
                  </div>

                  <div className="sandbox__slider-row">
                    <LetterSpacingIcon size={15} className="sandbox__slider-icon" />
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

      <Modal title={t("dice.title")} opened={diceOpened} onClose={diceHandlers.close} size={560}>
        <div className="dice">
          <div className="dice__config">
            <NumberInput
              label={t("dice.count")}
              value={diceCount}
              onChange={(val) => setDiceCount(typeof val === "number" ? Math.max(1, Math.min(val, 20)) : 1)}
              min={1}
              max={20}
              disabled={isRolling}
              className="dice__input"
            />
            <NumberInput
              label={t("dice.sides")}
              value={diceSides}
              onChange={(val) => setDiceSides(typeof val === "number" ? Math.max(2, Math.min(val, 1000)) : 6)}
              min={2}
              max={1000}
              disabled={isRolling}
              className="dice__input"
            />
          </div>

          <button
            type="button"
            className={`dice__roll-btn${isRolling ? " dice__roll-btn--rolling" : ""}`}
            onClick={rollDice}
            disabled={isRolling}
          >
            <DiceFiveFilledIcon size={20} className={isRolling ? "dice__icon-spin" : ""} />
            <span>{isRolling ? t("dice.rolling") : t("dice.roll")}</span>
          </button>

          {diceResults.length > 0 && (
            <div className={`dice__results${isRolling ? " dice__results--rolling" : ""}`}>
              <div className="dice__results-dice">
                {diceResults.map((val, i) => (
                  <div key={i} className={`dice__die${isRolling ? " dice__die--spinning" : ""}`}>
                    {val}
                  </div>
                ))}
              </div>
              {!isRolling && diceCount > 1 && (
                <div className="dice__total">
                  <Text size="sm" c="dimmed">{t("dice.total")}</Text>
                  <Text size="xl" fw={700}>{diceTotal}</Text>
                </div>
              )}
            </div>
          )}

          <div className="dice__history-section">
            <Group justify="space-between" align="center">
              <Text size="xs" fw={600} c="dimmed" className="dice__section-label">{t("dice.history")}</Text>
              {diceHistory.length > 0 && (
                <button
                  type="button"
                  className="dice__clear-btn"
                  onClick={() => setDiceHistory([])}
                >
                  <TrashIcon size={13} />
                  <span>{t("dice.clearHistory")}</span>
                </button>
              )}
            </Group>
            {diceHistory.length === 0 ? (
              <Text size="sm" c="dimmed" ta="center" py={20}>{t("dice.noHistory")}</Text>
            ) : (
              <div className="dice__history-list">
                {diceHistory.map((entry) => (
                  <div key={entry.timestamp} className="dice__history-item">
                    <Text size="xs" c="dimmed">
                      {t("dice.result", {
                        count: entry.count,
                        sides: entry.sides,
                        results: entry.results.join(", "),
                        total: entry.total,
                      })}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {equipCalcEnabled && (
        <Suspense>
          <LazyEquipmentCalcModal opened={equipCalcOpened} onClose={equipCalcHandlers.close} />
        </Suspense>
      )}
    </PageLayout>
  );
}

