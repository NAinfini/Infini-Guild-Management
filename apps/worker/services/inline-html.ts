import { CSS_VALUE_DENYLIST, SAFE_CSS_VALUE_PATTERN } from "@guild/shared";

/*
 * The one sanitizer for member-authored inline HTML fragments (profile titles,
 * badge labels). Both surfaces share the same contract — a short styled label —
 * so they must share one implementation: the last time these diverged, one copy
 * re-emitted the style attribute without validating its value.
 */

const ALLOWED_INLINE_TAGS = new Set(["span", "b", "strong", "i", "em", "u", "br"]);
const STYLE_PROP_ALLOWLIST = new Set(["color", "font-weight", "font-style", "text-decoration", "background-color"]);

function sanitizeStyleAttr(raw: string): string {
  const declarations = raw.split(";").map((d) => d.trim()).filter(Boolean);
  const safe = declarations.filter((decl) => {
    const colonIdx = decl.indexOf(":");
    if (colonIdx === -1) return false;
    const prop = decl.slice(0, colonIdx).trim().toLowerCase();
    if (!STYLE_PROP_ALLOWLIST.has(prop)) return false;
    const value = decl.slice(colonIdx + 1).trim();
    if (!SAFE_CSS_VALUE_PATTERN.test(value)) return false;
    return !CSS_VALUE_DENYLIST.test(value);
  });
  return safe.join("; ");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape-then-reconstruct sanitizer.
 *
 * Every `&`, `<` and `>` in the input is escaped first, so the only markup the
 * output can contain is markup this function emits itself from the fixed
 * allowlist below. A subtractive sanitizer (regex that strips disallowed tags)
 * is structurally unsafe here: anything its pattern fails to match — unclosed
 * tags, comment tricks, malformed attributes — survives into the output.
 *
 * Rendering code still sanitizes with DOMPurify; this keeps the *stored* value
 * trustworthy so any future consumer (export, digest mail, SSR) is safe too.
 */
export function sanitizeInlineHtml(html: string): string {
  return escapeHtml(html).replace(
    /&lt;(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^&]|&(?!gt;))*)&gt;/g,
    (_match, slash: string, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();
      if (!ALLOWED_INLINE_TAGS.has(tag)) return "";
      if (tag === "br") return "<br>";
      if (slash) return `</${tag}>`;
      const styleMatch = attrs.match(/\sstyle\s*=\s*"([^"]*)"/i);
      const safeStyle = styleMatch ? sanitizeStyleAttr(styleMatch[1]!) : "";
      return safeStyle ? `<${tag} style="${safeStyle}">` : `<${tag}>`;
    },
  );
}
