import { Button, Group, Modal } from "@mantine/core";
import type { TipTapEditorLabels } from "./tiptap-meta";

type TipTapEditorLinkDialogProps = {
  labels: TipTapEditorLabels;
  url: string;
  onUrlChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onUnset: () => void;
};

export function TipTapEditorLinkDialog({
  labels,
  url,
  onUrlChange,
  onClose,
  onSubmit,
  onUnset,
}: TipTapEditorLinkDialogProps) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <Modal
      opened
      onClose={onClose}
      title={labels.linkPrompt}
      size="sm"
      keepMounted={false}
      closeOnEscape={false}
      returnFocus={false}
      overlayProps={{ className: "infini-tiptap-link-dialog-backdrop" }}
      closeButtonProps={{
        "aria-label": labels.close,
        mod: { "data-mantine-stop-propagation": true },
      }}
      onKeyDown={handleKeyDown}
    >
      <form
        className="infini-tiptap-link-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <input
          autoFocus
          className="infini-tiptap-link-dialog__input"
          value={url}
          aria-label={labels.linkPrompt}
          data-mantine-stop-propagation="true"
          onChange={(event) => onUrlChange(event.currentTarget.value)}
        />
        <Group justify="flex-end" gap={8}>
          <Button
            variant="default"
            type="button"
            data-mantine-stop-propagation="true"
            onClick={onUnset}
          >
            {labels.unlink}
          </Button>
          <Button type="submit" data-mantine-stop-propagation="true">
            {labels.link}
          </Button>
        </Group>
      </form>
    </Modal>
  );
}
