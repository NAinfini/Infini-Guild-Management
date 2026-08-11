import { DEFAULT_GAME_RULES } from "@guild/shared";
import { describe, expect, it } from "vitest";
import { UNKNOWN_EVENT_TYPE_COLOR } from "./event-colors";
import { getEventTypeColor } from "./game-rules";

describe("event colours", () => {
  it("uses the colour stored on each configured event type", () => {
    for (const definition of DEFAULT_GAME_RULES.events.types) {
      expect(getEventTypeColor(definition.id)).toBe(definition.color);
    }
  });

  /* Unknown data must remain visually distinct from every valid event type. */
  it("uses a fallback colour that no configured type already claims", () => {
    const claimed = DEFAULT_GAME_RULES.events.types.map((definition) => definition.color);
    expect(claimed).not.toContain(UNKNOWN_EVENT_TYPE_COLOR);
  });
});
