export const RESULT_TAG_COLOR = {
  win: "green",
  loss: "red",
  draw: "blue",
} as const satisfies Record<string, string>;

export function resolveResultTagColor(result: string | null | undefined): string {
  return (result && RESULT_TAG_COLOR[result as keyof typeof RESULT_TAG_COLOR]) ?? "gray";
}
