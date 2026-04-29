interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function contrastRatio(background: string, foreground: string): number {
  const bg = relativeLuminance(colorToRgb(background));
  const fg = relativeLuminance(colorToRgb(foreground));
  const [lighter, darker] = bg >= fg ? [bg, fg] : [fg, bg];

  return (lighter + 0.05) / (darker + 0.05);
}

export function pickReadableTextColor(
  background: string,
  darkText = "#111111",
  lightText = "#FFFFFF",
): string {
  const darkContrast = contrastRatio(background, darkText);
  const lightContrast = contrastRatio(background, lightText);

  return darkContrast >= lightContrast ? darkText : lightText;
}

export function deriveActiveColor(color: string): string {
  const amount = isDarkColor(color) ? 0.18 : -0.16;
  return shiftLightness(color, amount);
}

function isDarkColor(color: string): boolean {
  return relativeLuminance(colorToRgb(color)) < 0.4;
}

function shiftLightness(color: string, delta: number): string {
  const { r, g, b } = colorToRgb(color);

  const apply = (channel: number): number => {
    const next = channel + channel * delta + 255 * delta;
    return clamp(Math.round(next), 0, 255);
  };

  return rgbToHex({
    r: apply(r),
    g: apply(g),
    b: apply(b),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const toLinear = (value: number): number => {
    const normalized = value / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }

    return Math.pow((normalized + 0.055) / 1.055, 2.4);
  };

  const linearR = toLinear(r);
  const linearG = toLinear(g);
  const linearB = toLinear(b);

  return 0.2126 * linearR + 0.7152 * linearG + 0.0722 * linearB;
}

function colorToRgb(color: string): Rgb {
  const trimmed = color.trim();

  if (trimmed.startsWith("var(")) {
    const resolved = resolveCssVar(trimmed);
    if (resolved) {
      return colorToRgb(resolved);
    }
    return { r: 128, g: 128, b: 128 };
  }

  if (isRgbColor(trimmed)) {
    return parseRgbColor(trimmed);
  }

  return hexToRgb(trimmed);
}

function resolveCssVar(cssVar: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const match = /^var\(\s*(--[^,)]+)/.exec(cssVar);
  if (!match) {
    return null;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || null;
}

function isRgbColor(value: string): boolean {
  return /^rgba?\(/i.test(value);
}

function parseRgbColor(value: string): Rgb {
  const match = /^rgba?\((.+)\)$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid rgb color: ${value}`);
  }

  const channelText = match[1].trim().replace(/\s*\/\s*[\d.]+%?\s*$/, "");
  const channels = (channelText.includes(",") ? channelText.split(",") : channelText.split(/\s+/))
    .map((channel) => channel.trim())
    .filter(Boolean);

  if (channels.length < 3) {
    throw new Error(`Invalid rgb color: ${value}`);
  }

  return {
    r: parseRgbChannel(channels[0]),
    g: parseRgbChannel(channels[1]),
    b: parseRgbChannel(channels[2]),
  };
}

function parseRgbChannel(channel: string): number {
  if (channel.endsWith("%")) {
    const percent = Number.parseFloat(channel.slice(0, -1));
    if (!Number.isFinite(percent)) {
      throw new Error(`Invalid rgb channel: ${channel}`);
    }

    return clamp(Math.round((percent / 100) * 255), 0, 255);
  }

  const value = Number.parseFloat(channel);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid rgb channel: ${channel}`);
  }

  return clamp(Math.round(value), 0, 255);
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex);

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (value: number): string => value.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeHex(hex: string): string {
  const trimmed = hex.trim().replace(/^#/, "");

  if (trimmed.length === 3) {
    return trimmed
      .split("")
      .map((character) => `${character}${character}`)
      .join("")
      .toUpperCase();
  }

  if (trimmed.length !== 6 || /[^0-9A-F]/i.test(trimmed)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return trimmed.toUpperCase();
}
