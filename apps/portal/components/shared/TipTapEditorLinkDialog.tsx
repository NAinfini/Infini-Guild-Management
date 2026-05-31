import { Button, Group, Text } from "@mantine/core";
import type { TipTapEditorLabels } from "./TipTapEditor";

type TipTapEditorLinkDialogProps = {
  labels: TipTapEditorLabels;
  titleId: string;
  url: string;
  onUrlChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onUnset: () => void;
};

export function TipTapEditorLinkDialog({
  labels,
  titleId,
  url,
  onUrlChange,
  onClose,
  onSubmit,
  onUnset,
}: TipTapEditorLinkDialogProps) {
  return (
    <div className="infini-tiptap-link-dialog-backdrop" onMouseDown={onClose}>
      <form
        aria-labelledby={titleId}
        className="infini-tiptap-link-dialog"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="infini-tiptap-link-dialog__header">
          <Text id={titleId} fw={700}>{labels.linkPrompt}</Text>
          <Button size="xs" variant="subtle" type="button" onClick={onClose}>{labels.close}</Button>
        </div>
        <input
          autoFocus
          className="infini-tiptap-link-dialog__input"
          value={url}
          aria-label={labels.linkPrompt}
          onChange={(event) => onUrlChange(event.currentTarget.value)}
        />
        <Group justify="flex-end" gap={8}>
          <Button variant="default" type="button" onClick={onUnset}>{labels.unlink}</Button>
          <Button type="submit">{labels.link}</Button>
        </Group>
      </form>
    </div>
  );
}
