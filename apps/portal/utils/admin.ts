import { format } from "date-fns";

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return format(date, "yyyy-MM-dd HH:mm");
}

export function toIsoOrUndefined(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function downloadFileBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function auditExportDatePart(value: string): string {
  return value && value.trim().length > 0 ? value.trim() : "auto";
}

export function maskIdentifier(value: string, isAdmin: boolean): string {
  if (isAdmin) {
    return value;
  }
  if (value.length <= 6) {
    return `${value.slice(0, 1)}***`;
  }
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

export function formatAuditDiffHeader(diffTitle: string | null, detailText: string | null): string {
  if (diffTitle && diffTitle.trim().length > 0) {
    return diffTitle.trim();
  }
  if (!detailText || detailText.trim().length === 0) {
    return "-";
  }
  try {
    const parsed = JSON.parse(detailText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed).slice(0, 2);
      if (entries.length > 0) {
        return entries
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join(" | ");
      }
    }
  } catch {
    // ignore parse errors, fallback to raw
  }
  return detailText.length > 100 ? `${detailText.slice(0, 100)}...` : detailText;
}
