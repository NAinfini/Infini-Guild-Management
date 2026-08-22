import DOMPurify from "dompurify";

const TITLE_HTML_OPTIONS: DOMPurify.Config = {
  ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
  ALLOWED_ATTR: ["style"],
};

export function sanitizeTitleHtml(html: string): string {
  return DOMPurify.sanitize(html, TITLE_HTML_OPTIONS);
}
