export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

export function formatCsvCell(
  value: unknown,
  options: Readonly<{ alwaysQuote?: boolean }> = {},
): string {
  const text = neutralizeSpreadsheetFormula(
    value === null || value === undefined ? "" : String(value),
  );
  return options.alwaysQuote || /[",\r\n]/.test(text)
    ? `"${text.replaceAll("\"", "\"\"")}"`
    : text;
}
