import { XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={false}
        overlayClassName="infini-tiptap-link-dialog-backdrop"
        className="sm:max-w-sm"
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{labels.linkPrompt}</DialogTitle>
          <DialogClose
            render={(
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-2 top-2"
                aria-label={labels.close}
              />
            )}
          >
            <XIcon aria-hidden />
          </DialogClose>
        </DialogHeader>
        <form
          className="infini-tiptap-link-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Input
            autoFocus
            className="infini-tiptap-link-dialog__input"
            value={url}
            aria-label={labels.linkPrompt}
            onChange={(event) => onUrlChange(event.currentTarget.value)}
          />
          <div className="flex justify-end gap-[var(--space-sm)]">
            <Button variant="outline" type="button" onClick={onUnset}>
              {labels.unlink}
            </Button>
            <Button type="submit">{labels.link}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
