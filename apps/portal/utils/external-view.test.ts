// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isExternalViewSearch } from "./external-view";

describe("external preview search", () => {
  it("accepts only the canonical external preview value", () => {
    expect(isExternalViewSearch("?preview=external&view=month")).toBe(true);
    expect(isExternalViewSearch("?preview=admin")).toBe(false);
    expect(isExternalViewSearch("?view=external")).toBe(false);
    expect(isExternalViewSearch("?external=1")).toBe(false);
  });
});
