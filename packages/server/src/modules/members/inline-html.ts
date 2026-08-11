import { isSafeCssValue } from "@guild/shared";

const INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "br"]);
const STYLE_PROPERTIES = new Set([
  "color",
  "background-color",
  "font-weight",
  "font-style",
  "font-size",
  "letter-spacing",
  "text-decoration",
  "text-decoration-line",
  "display",
]);

/** Escape all input markup, then reconstruct only the fixed inline contract. */
export function sanitizeInlineHtml(html: string): string {
  return escapeHtml(html).replace(
    /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^&]|&(?!gt;))*)&gt;/g,
    (_match, slash: string, rawTag: string, attributes: string) => {
      const tag = rawTag.toLowerCase();
      if (!INLINE_TAGS.has(tag)) return "";
      if (tag === "br") return "<br>";
      if (slash) return `</${tag}>`;
      const style = /\sstyle\s*=\s*"([^"]*)"/i.exec(attributes)?.[1];
      const safeStyle = style === undefined ? "" : sanitizeStyle(style);
      return safeStyle ? `<${tag} style="${safeStyle}">` : `<${tag}>`;
    },
  );
}

function sanitizeStyle(value: string): string {
  return value.split(";").map((declaration) => declaration.trim()).filter(Boolean).filter((declaration) => {
    const separator = declaration.indexOf(":");
    if (separator < 1) return false;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const cssValue = declaration.slice(separator + 1).trim();
    return STYLE_PROPERTIES.has(property) && isSafeCssValue(cssValue);
  }).join("; ");
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
