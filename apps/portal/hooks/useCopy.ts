import { notifications } from "@mantine/notifications";
import { useCallback, useMemo, useState } from "react";
import { presentAppError } from "./useAppError";
import { buildMentionList, copyPlainText, mentionText, type MentionInput } from "../utils/copy";
import { portalToast } from "../overlays";

type CopyOptions = {
  successText?: string;
};

type TeamCopyOptions = {
  teamName?: string;
  successText?: string;
};

const COPIED_FLAG_WINDOW_MS = 1200;

function showToast(status: "success" | "warning", text: string) {
  const delivered = portalToast({ title: text, status });
  if (!delivered) {
    if (status === "success") {
      notifications.show({
        color: "green",
        message: text,
        autoClose: 4500,
        withCloseButton: true,
      });
      return;
    }
    notifications.show({
      color: "yellow",
      message: text,
      autoClose: 4500,
      withCloseButton: true,
    });
  }
}

export function useCopy() {
  const [lastCopiedAt, setLastCopiedAt] = useState<number | null>(null);
  const [lastValue, setLastValue] = useState<string>("");

  const copyText = useCallback(async (value: string, options: CopyOptions = {}) => {
    const normalized = value.trim();
    if (!normalized) {
      showToast("warning", "Nothing to copy");
      return false;
    }

    try {
      await copyPlainText(normalized);
      setLastCopiedAt(Date.now());
      setLastValue(normalized);
      showToast("success", options.successText ?? "Copied");
      return true;
    } catch (error) {
      presentAppError(error, "Copy failed");
      return false;
    }
  }, []);

  const copyMention = useCallback(
    async (member: MentionInput, options: CopyOptions = {}) =>
      copyText(mentionText(member.wechatName, member.username), {
        successText: options.successText ?? "Mention copied",
      }),
    [copyText],
  );

  const copyMentionList = useCallback(
    async (members: MentionInput[], options: TeamCopyOptions = {}) =>
      copyText(buildMentionList(members, options.teamName), {
        successText: options.successText ?? "Mentions copied",
      }),
    [copyText],
  );

  const copiedRecently = useMemo(() => {
    if (lastCopiedAt === null) {
      return false;
    }
    return Date.now() - lastCopiedAt <= COPIED_FLAG_WINDOW_MS;
  }, [lastCopiedAt]);

  return {
    copyText,
    copyMention,
    copyMentionList,
    copiedRecently,
    lastValue,
  };
}
