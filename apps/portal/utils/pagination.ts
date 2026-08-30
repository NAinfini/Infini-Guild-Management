export type VisiblePage = number | "ellipsis";

export function buildVisiblePages(currentPage: number, pageCount: number): VisiblePage[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);

  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, pageCount])]
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);
  const result: VisiblePage[] = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1]! > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}
