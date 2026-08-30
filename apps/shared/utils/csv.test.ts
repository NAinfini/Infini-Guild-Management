import { describe, expect, it } from "vitest";
import { formatCsvCell, neutralizeSpreadsheetFormula } from "./csv";

describe("CSV output safety", () => {
  it.each(["=SUM(1,2)", "+cmd", "-1+2", "@IMPORT", "  =SUM(1,2)", "\t@IMPORT"])(
    "neutralizes formula-leading cell %j",
    (value) => {
      expect(neutralizeSpreadsheetFormula(value)).toBe(`'${value}`);
    },
  );

  it("leaves ordinary values unchanged and applies RFC-style quoting", () => {
    expect(formatCsvCell("Guild member")).toBe("Guild member");
    expect(formatCsvCell('A "quoted", value')).toBe('"A ""quoted"", value"');
    expect(formatCsvCell(null, { alwaysQuote: true })).toBe('""');
  });
});
