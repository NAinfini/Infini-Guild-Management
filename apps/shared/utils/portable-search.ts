export const PORTABLE_LIKE_PATTERN_MAX_BYTES = 50;

export function escapeLikePattern(value: string): string {
  return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export function isPortableLikeSearch(value: string): boolean {
  return new TextEncoder().encode(escapeLikePattern(value)).byteLength <= PORTABLE_LIKE_PATTERN_MAX_BYTES;
}

export function lowercaseLikePattern(value: string): string {
  return escapeLikePattern(value.toLowerCase());
}

export function isPortableLowercaseLikeSearch(value: string): boolean {
  return new TextEncoder().encode(lowercaseLikePattern(value)).byteLength <= PORTABLE_LIKE_PATTERN_MAX_BYTES;
}
