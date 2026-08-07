import DOMPurify from "dompurify";

const TITLE_HTML_OPTIONS: DOMPurify.Config = {
  ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
  ALLOWED_ATTR: ["style"],
};

export function sanitizeTitleHtml(html: string): string {
  return DOMPurify.sanitize(html, TITLE_HTML_OPTIONS);
}

/**
 * The visible words of a title, with markup and entities resolved.
 *
 * Reads `textContent` off a parsed document rather than sanitizing to an
 * empty tag whitelist: the latter returns escaped HTML, so a title containing
 * `&` would come back as `&amp;` and get escaped a second time on the way out.
 */
export function titleHtmlToText(html: string): string {
  const parsed = new DOMParser().parseFromString(sanitizeTitleHtml(html), "text/html");
  return parsed.body.textContent ?? "";
}
