import { HttpRangeError } from "./http-range-error.js";

export type RequestedByteRange =
  | Readonly<{ kind: "closed"; offset: number; length: number }>
  | Readonly<{ kind: "open"; offset: number }>
  | Readonly<{ kind: "suffix"; length: number }>;

export function parseRange(value: string | undefined): RequestedByteRange | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || value.includes(",")) throw new HttpRangeError("Only one valid byte range is supported");
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) throw new HttpRangeError("Invalid byte range");

  if (!startText) {
    const length = safeInteger(endText);
    if (length < 1) throw new HttpRangeError("Invalid byte range");
    return { kind: "suffix", length };
  }

  const offset = safeInteger(startText);
  if (!endText) return { kind: "open", offset };
  const end = safeInteger(endText);
  if (end < offset || end - offset >= Number.MAX_SAFE_INTEGER) throw new HttpRangeError("Invalid byte range");
  return { kind: "closed", offset, length: end - offset + 1 };
}

function safeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new HttpRangeError("Invalid byte range");
  return parsed;
}
