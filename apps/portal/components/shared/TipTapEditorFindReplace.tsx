import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ArrowDownIcon, ArrowUpIcon, ReplaceIcon, XIcon } from "@portal/components/icons";
import { Button } from "@portal/components/ui/button";
import { Input } from "@portal/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@portal/components/ui/tooltip";
import { IconGripVertical } from "@tabler/icons-react";
import type { TipTapEditorLabels } from "./tiptap-meta";

type TipTapEditorFindReplaceProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  onClose: () => void;
};

type SearchReplaceCommands = Record<"setSearchTerm" | "nextSearchResult" | "prevSearchResult" | "clearSearch" | "setReplaceTerm" | "replaceCurrent" | "replaceAll", (...args: unknown[]) => void>;

type FindReplaceActionProps = {
  label: string;
  children: ReactNode;
  onClick: () => void;
};

function FindReplaceAction({ label, children, onClick }: FindReplaceActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="infini-tiptap-find-replace__button"
            aria-label={label}
            onClick={onClick}
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TipTapEditorFindReplace({ editor, labels, onClose }: TipTapEditorFindReplaceProps) {
  const cmd = editor.commands as unknown as SearchReplaceCommands;
  const store = editor.storage.searchReplace as { searchTerm: string; replaceTerm: string; results: unknown[]; activeIndex: number } | undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (pos || !panelRef.current) return;
    const element = panelRef.current;
    const rect = element.getBoundingClientRect();
    setPos({ x: window.innerWidth - rect.width - 24, y: 80 });
  }, [pos]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelRef.current || !pos) return;
    event.preventDefault();
    dragState.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    setPos({
      x: Math.max(0, drag.origX + (event.clientX - drag.startX)),
      y: Math.max(0, drag.origY + (event.clientY - drag.startY)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!store) return null;
  const count = store.results.length;
  const current = count > 0 ? store.activeIndex + 1 : 0;
  const closePanel = () => {
    cmd.clearSearch();
    onClose();
  };
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    onEnter: () => void,
  ) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="infini-tiptap-find-replace"
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, top: 80 }}
      role="dialog"
      aria-label={labels.findReplace}
    >
      <div
        className="infini-tiptap-find-replace__drag"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <IconGripVertical size={14} aria-hidden="true" />
      </div>
      <div className="infini-tiptap-find-replace__body">
        <div className="infini-tiptap-find-replace__row">
          <Input
            placeholder={labels.findPlaceholder}
            aria-label={labels.findPlaceholder}
            value={store.searchTerm}
            onChange={(event) => cmd.setSearchTerm(event.currentTarget.value)}
            autoFocus
            className="infini-tiptap-find-replace__input"
            onKeyDown={(event) => handleKeyDown(event, () => cmd.nextSearchResult())}
          />
          <span className="infini-tiptap-find-replace__count" aria-live="polite">
            {current}/{count}
          </span>
          <div className="infini-tiptap-find-replace__actions">
            <FindReplaceAction label={labels.findPrev} onClick={() => cmd.prevSearchResult()}>
              <ArrowUpIcon size={14} />
            </FindReplaceAction>
            <FindReplaceAction label={labels.findNext} onClick={() => cmd.nextSearchResult()}>
              <ArrowDownIcon size={14} />
            </FindReplaceAction>
            <FindReplaceAction label={labels.close} onClick={closePanel}>
              <XIcon size={14} />
            </FindReplaceAction>
          </div>
        </div>
        <div className="infini-tiptap-find-replace__row">
          <Input
            placeholder={labels.replacePlaceholder}
            aria-label={labels.replacePlaceholder}
            value={store.replaceTerm}
            onChange={(event) => cmd.setReplaceTerm(event.currentTarget.value)}
            className="infini-tiptap-find-replace__input"
            onKeyDown={(event) => handleKeyDown(event, () => cmd.replaceCurrent())}
          />
          <div className="infini-tiptap-find-replace__actions">
            <FindReplaceAction label={labels.replaceOne} onClick={() => cmd.replaceCurrent()}>
              <ReplaceIcon size={14} />
            </FindReplaceAction>
            <FindReplaceAction label={labels.replaceAllLabel} onClick={() => cmd.replaceAll()}>
              <ReplaceIcon size={14} />
            </FindReplaceAction>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
