import { Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { ChartBarIcon } from "@portal/components/icons";
import type { GameData, StatSheet, CappedStats } from "@guild/shared/calculator/types";

type Props = {
  stats: StatSheet;
  gameData: GameData;
  capped: CappedStats;
};

const RATE_STATS = new Set(["精准率", "会心率", "会意率"]);
const INTERNAL_STATS = new Set(["__bossAsPlayer"]);
const PANEL_BASE_STATS = [
  "最小外功攻击",
  "最大外功攻击",
  "最小无相攻击",
  "最大无相攻击",
  "实际精准率",
  "精准率溢出",
  "实际会心率",
  "会心率溢出",
  "实际会意率",
  "会意率溢出",
  "精准率",
  "会心率",
  "会意率",
  "直接会心率",
  "会心伤害加成",
  "会意伤害加成",
  "外功穿透",
  "属攻穿透",
  "属攻伤害加成",
];

function statValue(stats: StatSheet, name: string): number {
  return stats[name] ?? 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function formatRange(min: number, max: number): string {
  return `${formatNumber(min)} - ${formatNumber(max)}`;
}

function formatPercent(value: number, precision = 1): string {
  return `${value.toFixed(precision)}%`;
}

function formatStatValue(name: string, value: number, isPercent: Set<string>): string {
  return isPercent.has(name) ? `${value.toFixed(1)}%` : value.toLocaleString();
}

export function StatsDisplay({ stats, gameData, capped }: Props) {
  const { t } = useTranslation("equipCalc");
  const isPercent = new Set(gameData.percentStats);

  const dominantElement = ["牵丝", "鸣金", "裂石", "破竹"]
    .map((element) => ({
      element,
      min: statValue(stats, `最小${element}攻击`),
      max: statValue(stats, `最大${element}攻击`),
    }))
    .sort((a, b) => b.max - a.max)[0];
  const panelStats = new Set([
    ...PANEL_BASE_STATS,
    `最小${dominantElement?.element ?? ""}攻击`,
    `最大${dominantElement?.element ?? ""}攻击`,
    `${dominantElement?.element ?? ""}伤害加成`,
  ]);

  const entries = Object.entries(stats).filter(
    ([name, val]) => val !== 0 && !INTERNAL_STATS.has(name) && !panelStats.has(name),
  );

  const panelRows = [
    {
      label: t("stats.panel.outerAttack"),
      value: formatRange(statValue(stats, "最小外功攻击"), statValue(stats, "最大外功攻击")),
    },
    {
      label: dominantElement?.element
        ? t("stats.panel.elementAttack", { element: dominantElement.element })
        : t("stats.panel.elementAttackFallback"),
      value: formatRange(dominantElement?.min ?? 0, dominantElement?.max ?? 0),
    },
    {
      label: t("stats.panel.wuxiangAttack"),
      value: formatRange(statValue(stats, "最小无相攻击"), statValue(stats, "最大无相攻击")),
    },
    { label: t("stats.panel.precision"), value: formatPercent(capped.actualPrecision) },
    { label: t("stats.panel.crit"), value: formatPercent(capped.actualCrit) },
    { label: t("stats.panel.intent"), value: formatPercent(capped.actualIntent) },
    { label: t("stats.panel.directCrit"), value: formatPercent(statValue(stats, "直接会心率")) },
    { label: t("stats.panel.critDamage"), value: formatPercent(statValue(stats, "会心伤害加成")) },
    { label: t("stats.panel.intentDamage"), value: formatPercent(statValue(stats, "会意伤害加成")) },
    { label: t("stats.panel.outerPen"), value: formatNumber(statValue(stats, "外功穿透")) },
    { label: t("stats.panel.elementPen"), value: formatNumber(statValue(stats, "属攻穿透")) },
    {
      label: dominantElement?.element
        ? t("stats.panel.elementDamage", { element: dominantElement.element })
        : t("stats.panel.elementDamageFallback"),
      value: formatPercent(
        statValue(stats, `${dominantElement?.element ?? ""}伤害加成`) +
        statValue(stats, "属攻伤害加成"),
      ),
    },
  ];

  const attackRows = panelRows.slice(0, 3);
  const rateRows = panelRows.slice(3, 7);
  const damageRows = panelRows.slice(7);

  return (
    <div className="ecm__stats">
      <div className="ecm__stats__header">
        <ChartBarIcon size={15} className="ecm__stats__header-icon" />
        <Text size="sm" fw={600}>{t("stats.breakdown")}</Text>
      </div>

      <div className="ecm__stats__summary">
        <div className="ecm__stats__card" style={{ borderLeft: '3px solid #D4A843' }}>
          <span className="ecm__stats__card-label">{t("stats.actualPrecision")}</span>
          <span className="ecm__stats__card-value">
            {capped.actualPrecision.toFixed(1)}%
          </span>
          {capped.precisionOverflow > 0 && (
            <span className="ecm__stats__card-meta">
              {t("stats.overflow")} {capped.precisionOverflow.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="ecm__stats__card" style={{ borderLeft: '3px solid #f59e0b' }}>
          <span className="ecm__stats__card-label">{t("stats.actualCrit")}</span>
          <span className="ecm__stats__card-value">
            {capped.actualCrit.toFixed(1)}%
          </span>
          {capped.critOverflow > 0 && (
            <span className="ecm__stats__card-meta">
              {t("stats.overflow")} {capped.critOverflow.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="ecm__stats__card" style={{ borderLeft: '3px solid #8B7355' }}>
          <span className="ecm__stats__card-label">{t("stats.actualIntent")}</span>
          <span className="ecm__stats__card-value">
            {capped.actualIntent.toFixed(1)}%
          </span>
          {capped.intentOverflow > 0 && (
            <span className="ecm__stats__card-meta">
              {t("stats.overflow")} {capped.intentOverflow.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      <div className="ecm__panel-table">
        <div className="ecm__panel-table-group-header">
          <Text size="xs" fw={700} c="dimmed">{t("statsGroup.attack")}</Text>
        </div>
        {attackRows.map((row) => (
          <div key={row.label} className="ecm__panel-table-row">
            <span className="ecm__panel-table-label">{row.label}</span>
            <span className="ecm__panel-table-value">{row.value}</span>
          </div>
        ))}
        <div className="ecm__panel-table-group-header">
          <Text size="xs" fw={700} c="dimmed">{t("statsGroup.rates")}</Text>
        </div>
        {rateRows.map((row) => (
          <div key={row.label} className="ecm__panel-table-row">
            <span className="ecm__panel-table-label">{row.label}</span>
            <span className="ecm__panel-table-value">{row.value}</span>
          </div>
        ))}
        <div className="ecm__panel-table-group-header">
          <Text size="xs" fw={700} c="dimmed">{t("statsGroup.damage")}</Text>
        </div>
        {damageRows.map((row) => (
          <div key={row.label} className="ecm__panel-table-row">
            <span className="ecm__panel-table-label">{row.label}</span>
            <span className="ecm__panel-table-value">{row.value}</span>
          </div>
        ))}
        {entries.map(([name, value]) => {
          const translated = t(`statNames.${name}`, { defaultValue: name });
          const label = RATE_STATS.has(name) ? `${translated} (${t("stats.raw")})` : translated;

          return (
            <div key={name} className="ecm__panel-table-row">
              <span className="ecm__panel-table-label">{label}</span>
              <span className="ecm__panel-table-value">{formatStatValue(name, value, isPercent)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
