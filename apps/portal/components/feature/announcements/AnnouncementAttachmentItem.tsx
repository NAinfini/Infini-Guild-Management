import type { AnnouncementAttachment } from "@guild/shared";
import { ArrowDownIcon, FileTextIcon, XIcon } from "@portal/components/icons";
import { Button, buttonVariants } from "@portal/components/ui/button";
import {
  TOOLTIP_CLOSE_DELAY_MS,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { cn } from "@portal/lib/utils";
import { resolveMediaUrl } from "@portal/utils/media";

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AnnouncementAttachmentItem({
  attachment,
  removeLabel,
  downloadLabel,
  onRemove,
}: {
  attachment: AnnouncementAttachment;
  removeLabel: string;
  downloadLabel: string;
  onRemove?: (mediaId: string) => void;
}) {
  const extension = attachment.name.split(".").pop()?.toUpperCase();

  return (
    <div className="announcement-attachment-item">
      <FileTextIcon size={24} className="announcement-attachment-icon" aria-hidden="true" />
      <div className="announcement-attachment-copy">
        <Tooltip>
          <TooltipTrigger
            delay={500}
            closeDelay={TOOLTIP_CLOSE_DELAY_MS}
            render={<span className="announcement-attachment-name" />}
          >
            {attachment.name}
          </TooltipTrigger>
          <TooltipContent>{attachment.name}</TooltipContent>
        </Tooltip>
        <span className="announcement-attachment-meta">
          {extension} · {formatAttachmentSize(attachment.byte_size)}
        </span>
      </div>
      {onRemove ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          aria-label={removeLabel}
          onClick={() => onRemove(attachment.media_id)}
        >
          <XIcon size={18} aria-hidden="true" />
        </Button>
      ) : (
        <a
          data-slot="button"
          className={cn(buttonVariants({ size: "icon", variant: "ghost" }))}
          aria-label={downloadLabel}
          href={resolveMediaUrl(attachment.media_id, "full")}
          download={attachment.name}
        >
          <ArrowDownIcon size={18} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
