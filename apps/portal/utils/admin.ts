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
