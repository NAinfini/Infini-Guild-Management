type MentionInput = {
  display_name: string;
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

function mentionText(display_name: string): string {
  return `@${display_name}`;
}

export function buildMentionList(items: MentionInput[], teamName?: string): string {
  const mentions = items.map((item) => mentionText(item.display_name));
  if (teamName && teamName.trim()) {
    return `${teamName.trim()}: ${mentions.join(", ")}`;
  }
  return mentions.join(", ");
}
