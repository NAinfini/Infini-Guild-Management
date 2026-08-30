import DOMPurify, { type Config } from "dompurify";

const TITLE_HTML_OPTIONS = {
  ALLOWED_TAGS: ["span", "b", "strong", "i", "em", "u", "br"],
  ALLOWED_ATTR: ["style"],
} satisfies Config;

export function sanitizeTitleHtml(html: string): string {
  return DOMPurify.sanitize(html, TITLE_HTML_OPTIONS);
}
