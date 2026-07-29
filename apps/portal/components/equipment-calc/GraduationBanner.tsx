import { RingProgress } from "@mantine/core";
import { useTranslation } from "react-i18next";

/** `null` means "not calculable yet" — the rotation data is still loading. */
type Props = {
  graduationRate: number | null;
  expectedDps: number | null;
  excelRate: number | null;
};

function rateLevel(rate: number | null): "high" | "mid" | "low" | "pending" {
  if (rate === null) return "pending";
  if (rate >= 80) return "high";
  if (rate >= 50) return "mid";
  return "low";
}

/*
 * RingProgress 的 color prop 只吃字面字符串，不认 className（见
 * AdminApiTestCategory.tsx 里对 Mantine 源码的核实）。四档本身仍是穷举的
 * level 判定，只是把颜色字面量从 hex 换成 token 字符串（the inline-style migration contract
 * B 节类 2）。这条例外的 CSS 侧登记见 EquipmentCalcModal.css 里
 * .ecm__grad-banner__rate--* 旁的注释。
 * pending 曾经用 --mantine-color-dimmed。这不是回归修复——本仓库
 * styles.css:759-760 早已把 --mantine-color-dimmed 全局桥接到
 * var(--text-muted)（特异性 (0,3,0) 压过 Mantine 自己的 (0,2,0)
 * 定义），所以实际渲染色从来就是 --text-muted，不是 Mantine 自带的
 * gray-6/dark-2。这里改成直接写 --text-muted，只是去掉对那条全局桥接
 * 规则的隐性依赖，继续与 CSS 侧的 .rate--pending 同一 token。
 */
function rateColor(level: "high" | "mid" | "low" | "pending"): string {
  if (level === "high") return "var(--status-success)";
  if (level === "mid") return "var(--status-warning)";
  if (level === "pending") return "var(--text-muted)";
  return "var(--status-danger)";
}

export function GraduationBanner({ graduationRate, expectedDps, excelRate }: Props) {
  const { t } = useTranslation("equipCalc");
  const level = rateLevel(graduationRate);
  const color = rateColor(level);
  const cappedRate = graduationRate === null ? 0 : Math.min(Math.max(graduationRate, 0), 100);

  return (
    <div className={`ecm__grad-banner ecm__grad-banner--${level}`}>
      <div className="ecm__grad-banner__content">
        <div className="ecm__grad-banner__lead">
          <RingProgress className="ecm__grad-banner__ring" size={64} thickness={5} roundCaps
            sections={[{ value: cappedRate, color }]}
            label={<span className={`ecm__grad-banner__ring-label ecm__grad-banner__rate--${level}`}>{graduationRate === null ? "--" : Math.round(cappedRate)}</span>}
          />
          <div className="ecm__grad-banner__lead-text">
            <span className="ecm__grad-banner__label">{t("stats.graduationRate")}</span>
            <span className={`ecm__grad-banner__rate ecm__grad-banner__rate--${level}`}>{graduationRate === null ? "--" : `${graduationRate.toFixed(2)}%`}</span>
          </div>
        </div>
        <div className="ecm__grad-banner__metrics">
          <div className="ecm__grad-banner__metric">
            <span className="ecm__grad-banner__label">{t("stats.excelRate")}</span>
            <span className="ecm__grad-banner__metric-value">{excelRate !== null && excelRate > 0 ? `${excelRate.toFixed(2)}%` : "--"}</span>
          </div>
          <div className="ecm__grad-banner__metric">
            <span className="ecm__grad-banner__label">{t("stats.expectedDps")}</span>
            <span className="ecm__grad-banner__metric-value">{expectedDps === null ? "--" : expectedDps.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
