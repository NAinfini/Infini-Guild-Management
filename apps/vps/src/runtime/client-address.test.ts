import { describe, expect, it } from "vitest";
import { resolveVpsClientAddress } from "./client-address.js";

function request(remoteAddress: string, forwarded?: string) {
  return {
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    socket: { remoteAddress },
  } as Parameters<typeof resolveVpsClientAddress>[0];
}

describe("resolveVpsClientAddress", () => {
  it("ignores spoofed forwarding headers from untrusted peers", () => {
    expect(resolveVpsClientAddress(request("203.0.113.8", "1.1.1.1"), new Set(["127.0.0.1"])))
      .toBe("203.0.113.8");
  });

  it("walks a trusted proxy chain from right to left", () => {
    expect(resolveVpsClientAddress(
      request("::ffff:127.0.0.1", "198.51.100.7, 10.0.0.2"),
      new Set(["127.0.0.1", "10.0.0.2"]),
    )).toBe("198.51.100.7");
  });

  it("rejects malformed forwarding data from a trusted peer", () => {
    expect(() => resolveVpsClientAddress(
      request("127.0.0.1", "attacker-controlled"),
      new Set(["127.0.0.1"]),
    )).toThrow(/valid IP/);
  });
});
