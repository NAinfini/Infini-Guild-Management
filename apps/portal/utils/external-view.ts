export function isExternalViewSearch(searchStr: string | undefined): boolean {
  if (!searchStr) {
    return false;
  }

  const queryText = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  return new URLSearchParams(queryText).get("preview") === "external";
}
