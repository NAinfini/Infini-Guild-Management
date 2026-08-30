import { inviteCodeSchema, INVITE_CODE_LENGTH } from "@guild/shared";

const encoder = new TextEncoder();
const PASSWORD_PREFIX = "pbkdf2-sha256";
const PASSWORD_KEY_BITS = 256;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_VERIFICATION_ITERATIONS_MIN = 10_000;
const PASSWORD_ITERATIONS_MAX = 10_000_000;
const DUMMY_PASSWORD_SALT = new Uint8Array(PASSWORD_SALT_BYTES);
const DUMMY_PASSWORD_HASH = new Uint8Array(PASSWORD_KEY_BITS / 8);
const INVITE_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const INVITE_CODE_RANDOM_LIMIT = Math.floor(256 / INVITE_CODE_ALPHABET.length) * INVITE_CODE_ALPHABET.length;

/** Default and minimum cost for every newly written password hash. */
export const PASSWORD_HASH_ITERATIONS = 10_000;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt: salt as unknown as BufferSource },
    material,
    PASSWORD_KEY_BITS,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

type ParsedPasswordHash = Readonly<{
  iterations: number;
  salt: Uint8Array;
  expected: Uint8Array;
}>;

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  try {
    const match = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
    if (!match) return null;
    const iterations = Number(match[1]);
    if (!Number.isInteger(iterations)
      || iterations < PASSWORD_VERIFICATION_ITERATIONS_MIN
      || iterations > PASSWORD_ITERATIONS_MAX) return null;
    const salt = fromBase64Url(match[2]!);
    const expected = fromBase64Url(match[3]!);
    return salt.length === PASSWORD_SALT_BYTES && expected.length === PASSWORD_KEY_BITS / 8
      ? { iterations, salt, expected }
      : null;
  } catch {
    return null;
  }
}

export function readPasswordHashIterations(encoded: string): number | null {
  return parsePasswordHash(encoded)?.iterations ?? null;
}

export function requireSafePasswordIterations(iterations: number): number {
  if (!Number.isInteger(iterations) || iterations < PASSWORD_HASH_ITERATIONS || iterations > PASSWORD_ITERATIONS_MAX) {
    throw new RangeError(`PBKDF2 iterations must be between ${PASSWORD_HASH_ITERATIONS} and ${PASSWORD_ITERATIONS_MAX}`);
  }
  return iterations;
}

export async function createPasswordHash(
  password: string,
  iterations = PASSWORD_HASH_ITERATIONS,
): Promise<string> {
  requireSafePasswordIterations(iterations);
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `${PASSWORD_PREFIX}$${iterations}$${base64Url(salt)}$${base64Url(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  return parsed !== null
    && constantTimeEqual(await derive(password, parsed.salt, parsed.iterations), parsed.expected);
}

export async function verifyPasswordWithinBudget(
  password: string,
  encoded: string,
  iterationBudget = PASSWORD_HASH_ITERATIONS,
): Promise<Readonly<{ valid: boolean; iterations: number | null }>> {
  requireSafePasswordIterations(iterationBudget);
  const parsed = parsePasswordHash(encoded);
  const candidate = parsed !== null && parsed.iterations <= iterationBudget
    ? parsed
    : { iterations: iterationBudget, salt: DUMMY_PASSWORD_SALT, expected: DUMMY_PASSWORD_HASH };
  const valid = constantTimeEqual(
    await derive(password, candidate.salt, candidate.iterations),
    candidate.expected,
  );
  await derive(password, DUMMY_PASSWORD_SALT, iterationBudget - candidate.iterations + 1);
  return {
    valid: parsed === candidate && valid,
    iterations: parsed === candidate ? candidate.iterations : null,
  };
}

export function createOpaqueToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function digestToken(token: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export function createInviteCode(): string {
  let code = "";
  while (code.length < INVITE_CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= INVITE_CODE_RANDOM_LIMIT) continue;
      code += INVITE_CODE_ALPHABET[byte % INVITE_CODE_ALPHABET.length];
      if (code.length === INVITE_CODE_LENGTH) break;
    }
  }
  return code;
}

export function normalizeInviteCode(value: string): string | null {
  const parsed = inviteCodeSchema.safeParse(value.trim().toUpperCase());
  return parsed.success ? parsed.data : null;
}
