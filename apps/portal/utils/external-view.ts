export function isExternalViewSearch(searchStr: string | undefined): boolean {
  if (!searchStr) {
    return false;
  }

  const queryText = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  const query = new URLSearchParams(queryText);
  const external = query.get("external");
  const view = query.get("view");

  if (external) {
    const normalized = external.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  if (view) {
    return view.trim().toLowerCase() === "external";
  }

  return false;
}
