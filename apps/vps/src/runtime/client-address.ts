import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

const MAX_FORWARDED_BYTES = 1_024;
const MAX_FORWARDED_HOPS = 32;

export function resolveVpsClientAddress(
  request: Pick<IncomingMessage, "headers" | "socket">,
  trustedProxyAddresses: ReadonlySet<string>,
): string {
  const peer = normalizeIp(request.socket.remoteAddress ?? "");
  if (!trustedProxyAddresses.has(peer)) return peer;

  const header = request.headers["x-forwarded-for"];
  const forwarded = Array.isArray(header) ? header.join(",") : header;
  if (!forwarded) return peer;
  if (Buffer.byteLength(forwarded, "utf8") > MAX_FORWARDED_BYTES) {
    throw new TypeError("X-Forwarded-For is too large");
  }
  const chain = forwarded.split(",").map((value) => normalizeIp(value.trim()));
  if (chain.length > MAX_FORWARDED_HOPS) throw new TypeError("X-Forwarded-For has too many hops");
  chain.push(peer);

  let index = chain.length - 1;
  while (index > 0 && trustedProxyAddresses.has(chain[index]!)) index -= 1;
  return chain[index]!;
}

function normalizeIp(value: string): string {
  const withoutZone = value.includes("%") ? value.slice(0, value.indexOf("%")) : value;
  const normalized = withoutZone.startsWith("::ffff:") && isIP(withoutZone.slice(7)) === 4
    ? withoutZone.slice(7)
    : withoutZone;
  if (isIP(normalized) === 0) throw new TypeError("Client address is not a valid IP address");
  return normalized;
}
