import type {
  BlobReconciliationCheckpointWire,
  BlobReconciliationResponse,
} from "@guild/shared/schemas/blob-reconciliation";
import { Alert, AlertTitle } from "@portal/components/ui/alert";
import { Badge } from "@portal/components/ui/badge";
import { Button } from "@portal/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@portal/components/ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { InfoCircleIcon, PlayIcon } from "@portal/components/icons";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchBlobReconciliationPage } from "../../../services/AdminService";
import "./AdminDataIntegrityTool.css";

const FINDING_SAMPLE_LIMIT = 20;
type BlobReconciliationFinding = BlobReconciliationResponse["findings"][number];

type ScanSummary = {
  scanned: number;
  findings: number;
  missing: number;
  mismatched: number;
  orphanCandidates: number;
  samples: BlobReconciliationFinding[];
};

const EMPTY_SUMMARY: ScanSummary = {
  scanned: 0,
  findings: 0,
  missing: 0,
  mismatched: 0,
  orphanCandidates: 0,
  samples: [],
};

export function AdminDataIntegrityTool() {
  const { t } = useTranslation("admin");
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [nextCheckpoint, setNextCheckpoint] = useState<BlobReconciliationCheckpointWire | null>(null);
  const [started, setStarted] = useState(false);
  const scan = useMutation({
    mutationFn: ({ checkpoint }: { checkpoint: BlobReconciliationCheckpointWire; reset: boolean }) =>
      fetchBlobReconciliationPage(checkpoint),
    onSuccess: (page, input) => {
      setStarted(true);
      setNextCheckpoint(page.next_checkpoint);
      setSummary((current) => mergePage(input.reset ? EMPTY_SUMMARY : current, page.findings, page.scanned));
    },
  });

  const begin = () => scan.mutate({ checkpoint: { phase: "manifest" }, reset: true });
  const continueScan = () => {
    if (nextCheckpoint) scan.mutate({ checkpoint: nextCheckpoint, reset: false });
  };
  const complete = started && nextCheckpoint === null && !scan.isPending;

  return (
    <section className="admin-panel admin-integrity" aria-labelledby="admin-integrity-title">
      <div className="admin-panel__head">
        <div className="admin-panel__title">
          <span id="admin-integrity-title">{t("diagnostics.integrity.title")}</span>
          {/* 「为什么要一页一页扫」是这个工具最常被问的事，答案挂在标题旁边，
              省得管理员以为扫描卡住了或者自己漏点了什么。 */}
          <Tooltip>
            <TooltipTrigger render={<span className="admin-integrity__hint" tabIndex={0} role="note"
              aria-label={t("diagnostics.integrity.whyPaged")} />}>
              <InfoCircleIcon size={15} />
            </TooltipTrigger>
            <TooltipContent className="admin-integrity__tooltip">
              {t("diagnostics.integrity.whyPaged")}
            </TooltipContent>
          </Tooltip>
          {started ? (
            <Badge
              variant={complete && summary.findings > 0 ? "destructive" : complete ? "secondary" : "outline"}
              data-state={complete ? (summary.findings > 0 ? "drift" : "clean") : "incomplete"}
            >
              {complete
                ? t(summary.findings > 0 ? "diagnostics.integrity.drift" : "diagnostics.integrity.clean")
                : t("diagnostics.integrity.incomplete")}
            </Badge>
          ) : null}
        </div>
        <div className="admin-integrity__actions">
          {nextCheckpoint ? (
            <Button variant="default" loading={scan.isPending} onClick={continueScan}>
              {t("diagnostics.integrity.continue")}
            </Button>
          ) : null}
          <Button
            loading={scan.isPending}
            disabled={scan.isPending}
            onClick={begin}
          >
            <PlayIcon size={14} data-icon="inline-start" />
            {started ? t("diagnostics.integrity.restart") : t("diagnostics.integrity.start")}
          </Button>
        </div>
      </div>

      <div className="admin-panel__body admin-integrity__body">
        <p className="admin-integrity__description">{t("diagnostics.integrity.description")}</p>

        {scan.isError ? (
          <Alert variant="destructive">
            <AlertTitle>{t("diagnostics.integrity.error")}</AlertTitle>
          </Alert>
        ) : null}

        {started ? (
        <div className="admin-integrity__results">
          <div className="admin-stats admin-stats--inset">
            <IntegrityStat label={t("diagnostics.integrity.scanned")} value={summary.scanned} />
            <IntegrityStat label={t("diagnostics.integrity.missing")} value={summary.missing} danger={summary.missing > 0} />
            <IntegrityStat label={t("diagnostics.integrity.mismatched")} value={summary.mismatched} danger={summary.mismatched > 0} />
            <IntegrityStat label={t("diagnostics.integrity.orphans")} value={summary.orphanCandidates} danger={summary.orphanCandidates > 0} />
          </div>

          {summary.samples.length > 0 ? (
            <div className="admin-integrity__table-wrap">
              <table className="admin-integrity__table">
                <thead>
                  <tr>
                    <th>{t("diagnostics.integrity.finding")}</th>
                    <th>{t("diagnostics.integrity.objectKey")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.samples.map((finding, index) => (
                    <tr key={`${finding.kind}-${objectKey(finding)}-${index}`}>
                      <td>{t(`diagnostics.integrity.kind.${finding.kind}`)}</td>
                      <td className="admin-integrity__object-key">{objectKey(finding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-integrity__description">
              {complete ? t("diagnostics.integrity.noFindings") : t("diagnostics.integrity.noFindingsYet")}
            </p>
          )}
        </div>
        ) : null}
      </div>
    </section>
  );
}

function IntegrityStat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="admin-stat">
      <div className={`admin-stat__value${danger ? " admin-stat__value--danger" : ""}`}>{value}</div>
      <div className="admin-stat__label">{label}</div>
    </div>
  );
}

function mergePage(
  current: ScanSummary,
  findings: readonly BlobReconciliationFinding[],
  scanned: number,
): ScanSummary {
  let missing = current.missing;
  let mismatched = current.mismatched;
  let orphanCandidates = current.orphanCandidates;
  for (const finding of findings) {
    if (finding.kind === "missing_blob") missing += 1;
    else if (finding.kind === "metadata_mismatch") mismatched += 1;
    else orphanCandidates += 1;
  }
  return {
    scanned: current.scanned + scanned,
    findings: current.findings + findings.length,
    missing,
    mismatched,
    orphanCandidates,
    samples: [...current.samples, ...findings].slice(0, FINDING_SAMPLE_LIMIT),
  };
}

function objectKey(finding: BlobReconciliationFinding): string {
  return finding.kind === "missing_blob" ? finding.expected.object_key : finding.actual.object_key;
}
