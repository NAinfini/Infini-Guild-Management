export type MentionInput = {
  username: string;
  wechatName?: string | null;
};

export async function copyPlainText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("Clipboard API is unavailable");
  }
}

export function mentionText(wechatName: string | null | undefined, username: string): string {
  return `@${wechatName && wechatName.trim() ? wechatName.trim() : username}`;
}

export function buildMentionList(items: MentionInput[], teamName?: string): string {
  const mentions = items.map((item) => mentionText(item.wechatName, item.username));
  if (teamName && teamName.trim()) {
    return `${teamName.trim()}: ${mentions.join(", ")}`;
  }
  return mentions.join(", ");
}
