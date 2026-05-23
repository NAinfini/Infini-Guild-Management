import { RingProgress } from "@mantine/core";
import { useTranslation } from "react-i18next";

type Props = {
  graduationRate: number;
  expectedDps: number;
  excelRate: number;
};

function rateLevel(rate: number): "high" | "mid" | "low" {
  if (rate >= 80) return "high";
  if (rate >= 50) return "mid";
  return "low";
}

function rateColor(level: "high" | "mid" | "low"): string {
  if (level === "high") return "#22c55e";
  if (level === "mid") return "#f59e0b";
  return "#ef4444";
}

export function GraduationBanner({ graduationRate, expectedDps, excelRate }: Props) {
  const { t } = useTranslation("equipCalc");
  const level = rateLevel(graduationRate);
  const color = rateColor(level);
  const cappedRate = Math.min(Math.max(graduationRate, 0), 100);

  return (
    <div className={`ecm__grad-banner ecm__grad-banner--${level}`}>
      <div className="ecm__grad-banner__content">
        <div className="ecm__grad-banner__lead">
          <RingProgress className="ecm__grad-banner__ring" size={64} thickness={5} roundCaps
            sections={[{ value: cappedRate, color }]}
            label={<span className={`ecm__grad-banner__ring-label ecm__grad-banner__rate--${level}`}>{Math.round(cappedRate)}</span>}
          />
          <div className="ecm__grad-banner__lead-text">
            <span className="ecm__grad-banner__label">{t("stats.graduationRate")}</span>
            <span className={`ecm__grad-banner__rate ecm__grad-banner__rate--${level}`}>{graduationRate.toFixed(2)}%</span>
          </div>
        </div>
        <div className="ecm__grad-banner__metrics">
          <div className="ecm__grad-banner__metric">
            <span className="ecm__grad-banner__label">{t("stats.excelRate")}</span>
            <span className="ecm__grad-banner__metric-value">{excelRate > 0 ? `${excelRate.toFixed(2)}%` : "--"}</span>
          </div>
          <div className="ecm__grad-banner__metric">
            <span className="ecm__grad-banner__label">{t("stats.expectedDps")}</span>
            <span className="ecm__grad-banner__metric-value">{expectedDps.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
