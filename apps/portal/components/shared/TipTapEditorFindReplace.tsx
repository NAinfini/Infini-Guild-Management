import type { Editor } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useRef, useEffect, useState, useCallback } from "react";
import { ActionIcon, Group, TextInput, Tooltip, Text } from "@mantine/core";
import { ArrowDownIcon, ArrowUpIcon, ReplaceIcon, XIcon } from "@portal/components/icons";
import { IconGripVertical } from "@tabler/icons-react";
import type { TipTapEditorLabels } from "./TipTapEditor";

type TipTapEditorFindReplaceProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
  onClose: () => void;
};

type SearchReplaceCommands = Record<"setSearchTerm" | "nextSearchResult" | "prevSearchResult" | "clearSearch" | "setReplaceTerm" | "replaceCurrent" | "replaceAll", (...args: unknown[]) => void>;

export function TipTapEditorFindReplace({ editor, labels, onClose }: TipTapEditorFindReplaceProps) {
  const cmd = editor.commands as unknown as SearchReplaceCommands;
  const store = editor.storage.searchReplace as { searchTerm: string; replaceTerm: string; results: unknown[]; activeIndex: number } | undefined;
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (pos || !panelRef.current) return;
    const el = panelRef.current;
    const rect = el.getBoundingClientRect();
    setPos({ x: window.innerWidth - rect.width - 24, y: 80 });
  }, [pos]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!panelRef.current || !pos) return;
    e.preventDefault();
    dragState.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    setPos({
      x: Math.max(0, ds.origX + (e.clientX - ds.startX)),
      y: Math.max(0, ds.origY + (e.clientY - ds.startY)),
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  if (!store) return null;
  const count = store.results.length;
  const current = count > 0 ? store.activeIndex + 1 : 0;

  return createPortal(
    <div
      ref={panelRef}
      className="infini-tiptap-find-replace"
      style={pos ? { left: pos.x, top: pos.y } : { right: 24, top: 80 }}
    >
      <div
        className="infini-tiptap-find-replace__drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <IconGripVertical size={14} />
      </div>
      <div className="infini-tiptap-find-replace__body">
        <div className="infini-tiptap-find-replace__row">
          <TextInput
            size="xs"
            placeholder={labels.findPlaceholder}
            aria-label={labels.findPlaceholder}
            value={store.searchTerm}
            onChange={(e) => cmd.setSearchTerm(e.currentTarget.value)}
            autoFocus
            className="infini-tiptap-find-replace__input"
            onKeyDown={(e) => {
              if (e.key === "Enter") cmd.nextSearchResult();
              if (e.key === "Escape") {
                cmd.clearSearch();
                onClose();
              }
            }}
          />
          <Text size="xs" c="dimmed" className="infini-tiptap-find-replace__count">
            {current}/{count}
          </Text>
          <Group gap={2}>
            <Tooltip label={labels.findPrev} withArrow zIndex={1060}>
              <ActionIcon size="sm" variant="subtle" onClick={() => cmd.prevSearchResult()} aria-label={labels.findPrev}>
                <ArrowUpIcon size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={labels.findNext} withArrow zIndex={1060}>
              <ActionIcon size="sm" variant="subtle" onClick={() => cmd.nextSearchResult()} aria-label={labels.findNext}>
                <ArrowDownIcon size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={labels.close} withArrow zIndex={1060}>
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => {
                  cmd.clearSearch();
                  onClose();
                }}
                aria-label={labels.close}
              >
                <XIcon size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>
        <div className="infini-tiptap-find-replace__row">
          <TextInput
            size="xs"
            placeholder={labels.replacePlaceholder}
            aria-label={labels.replacePlaceholder}
            value={store.replaceTerm}
            onChange={(e) => cmd.setReplaceTerm(e.currentTarget.value)}
            className="infini-tiptap-find-replace__input"
            onKeyDown={(e) => {
              if (e.key === "Enter") cmd.replaceCurrent();
              if (e.key === "Escape") {
                cmd.clearSearch();
                onClose();
              }
            }}
          />
          <Group gap={2}>
            <Tooltip label={labels.replaceOne} withArrow zIndex={1060}>
              <ActionIcon size="sm" variant="subtle" onClick={() => cmd.replaceCurrent()} aria-label={labels.replaceOne}>
                <ReplaceIcon size={14} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={labels.replaceAllLabel} withArrow zIndex={1060}>
              <ActionIcon size="sm" variant="subtle" onClick={() => cmd.replaceAll()} aria-label={labels.replaceAllLabel}>
                <ReplaceIcon size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </div>
      </div>
    </div>,
    document.body,
  );
}
