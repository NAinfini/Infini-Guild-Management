const encoder = new TextEncoder();
const PASSWORD_PREFIX = "pbkdf2-sha256";
const PASSWORD_KEY_BITS = 256;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_ITERATIONS_MAX = 10_000_000;

/** Cloudflare-safe production floor/default. Deployments may raise this through runtime configuration. */
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

export function readPasswordHashIterations(encoded: string): number | null {
  const match = /^pbkdf2-sha256\$(\d+)\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.exec(encoded);
  if (!match) return null;
  const iterations = Number(match[1]);
  return Number.isInteger(iterations) && iterations > 0 ? iterations : null;
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
  try {
    const match = /^pbkdf2-sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(encoded);
    if (!match) return false;
    const iterations = Number(match[1]);
    if (!Number.isInteger(iterations) || iterations < PASSWORD_HASH_ITERATIONS || iterations > PASSWORD_ITERATIONS_MAX) return false;
    const salt = fromBase64Url(match[2]!);
    const expected = fromBase64Url(match[3]!);
    if (salt.length !== PASSWORD_SALT_BYTES || expected.length !== PASSWORD_KEY_BITS / 8) return false;
    return constantTimeEqual(await derive(password, salt, iterations), expected);
  } catch {
    return false;
  }
}

export function createOpaqueToken(byteLength = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function digestToken(token: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));
}

export type InviteTokenCodec = {
  encode(id: string): Promise<string>;
  decode(token: string): Promise<string | null>;
};

export function createInviteTokenCodec(secret: string): InviteTokenCodec {
  if (encoder.encode(secret).byteLength < 32) throw new Error("Invite token secret must contain at least 32 bytes");
  const key = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  async function signature(id: string): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.sign("HMAC", await key, encoder.encode(id)));
  }

  return {
    async encode(id) {
      return `${id}.${base64Url(await signature(id))}`;
    },
    async decode(token) {
      const separator = token.lastIndexOf(".");
      if (separator < 1) return null;
      const id = token.slice(0, separator);
      let supplied: Uint8Array;
      try {
        supplied = fromBase64Url(token.slice(separator + 1));
      } catch {
        return null;
      }
      return constantTimeEqual(await signature(id), supplied) ? id : null;
    },
  };
}
