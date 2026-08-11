const LEGACY_PREFIX = "pbkdf2-sha256";
const LEGACY_ITERATIONS_MIN = 10_000;
const ITERATIONS_MAX = 10_000_000;

function decodeCanonicalBase64(value: string, field: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new TypeError(`${field} must be canonical standard base64`);
  }
  if (btoa(binary) !== value) throw new TypeError(`${field} must be canonical standard base64`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Converts the old Worker two-column credential into the sole runtime hash format. */
export function convertLegacyWorkerPasswordHash(input: Readonly<{
  passwordHash: string;
  salt: string;
}>): string {
  const match = /^pbkdf2-sha256\$([1-9]\d*)\$([^$]+)$/.exec(input.passwordHash);
  if (!match || match[0] !== input.passwordHash) {
    throw new TypeError("Legacy password hash format is invalid");
  }
  const iterations = Number(match[1]);
  if (!Number.isSafeInteger(iterations) || iterations < LEGACY_ITERATIONS_MIN || iterations > ITERATIONS_MAX) {
    throw new RangeError(`Legacy PBKDF2 iterations must be between ${LEGACY_ITERATIONS_MIN} and ${ITERATIONS_MAX}`);
  }
  const salt = decodeCanonicalBase64(input.salt, "Legacy password salt");
  const hash = decodeCanonicalBase64(match[2]!, "Legacy password hash");
  if (salt.byteLength !== 16) throw new TypeError("Legacy password salt must contain 16 bytes");
  if (hash.byteLength !== 32) throw new TypeError("Legacy password hash must contain 32 bytes");
  return `${LEGACY_PREFIX}$${iterations}$${base64Url(salt)}$${base64Url(hash)}`;
}
