export function isIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function toIsoOrNow(value: string | undefined): string {
  if (value && isIsoDate(value)) {
    return value;
  }
  return new Date().toISOString();
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
