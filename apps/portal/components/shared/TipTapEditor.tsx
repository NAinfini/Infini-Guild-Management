import { forwardRef } from "react";
import {
  TIPTAP_DEFAULT_JSON as _TIPTAP_DEFAULT_JSON,
  buildTipTapEditorLabels as _buildTipTapEditorLabels,
  type TipTapEditorLabels as _TipTapEditorLabels,
} from "./tiptap-meta";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { TextStyle } from "@tiptap/extension-text-style";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Image from "@tiptap/extension-image";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import { Youtube } from "@tiptap/extension-youtube";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import type { Content } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Alert, Button, Card, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import DOMPurify from "dompurify";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { common, createLowlight } from "lowlight";
import { Bilibili, isValidBilibiliUrl } from "./tiptap-ext-bilibili";
import { SearchReplace } from "./tiptap-ext-search-replace";

import { TipTapEditorToolbar } from "./TipTapEditorToolbar";
import { TipTapEditorContextMenu } from "./TipTapEditorContextMenu";
import { TipTapEditorLinkDialog } from "./TipTapEditorLinkDialog";
import { TipTapEditorFindReplace } from "./TipTapEditorFindReplace";
import { TipTapEditorToc } from "./TipTapEditorToc";

const lowlight = createLowlight(common);
import "./tiptap-editor.css";

type EditorMode = "json" | "html";

// Re-exported from tiptap-meta for backward compatibility.
export type TipTapEditorLabels = _TipTapEditorLabels;

const DEFAULT_LABELS: TipTapEditorLabels = {
  bold: "Bold",
  italic: "Italic",
  underline: "Underline",
  strike: "Strikethrough",
  link: "Link",
  unlink: "Unlink",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "Bullet list",
  number: "Numbered list",
  quote: "Blockquote",
  code: "Code block",
  table: "Table",
  addCol: "Add column",
  addRow: "Add row",
  delCol: "Delete column",
  delRow: "Delete row",
  delTable: "Delete table",
  image: "Image",
  textColor: "Text color",
  customTextColor: "Custom text color",
  highlight: "Highlight",
  customHighlightColor: "Custom background color",
  clearFormatting: "Clear formatting",
  alignLeft: "Align left",
  alignCenter: "Align center",
  alignRight: "Align right",
  divider: "Divider",
  taskList: "Task checklist",
  undo: "Undo",
  redo: "Redo",
  moreFormatting: "More formatting",
  moreInsert: "Insert",
  close: "Close",
  slashCommands: "Slash commands",
  linkPrompt: "Enter URL",
  imageInserted: "Image inserted",
  imageUploadFailed: "Image upload failed",
  uploading: "Uploading...",
  youtube: "YouTube",
  bilibili: "Bilibili",
  videoUrl: "Video URL",
  embedVideo: "Embed video",
  details: "Toggle section",
  findReplace: "Find & Replace",
  findPlaceholder: "Find...",
  replacePlaceholder: "Replace...",
  findNext: "Next",
  findPrev: "Previous",
  replaceOne: "Replace",
  replaceAllLabel: "Replace all",
  tableOfContents: "Table of Contents",
  words: "words",
  characters: "characters",
};

// Re-exported from tiptap-meta for backward compatibility.
export const buildTipTapEditorLabels = _buildTipTapEditorLabels;

export type TipTapEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode?: EditorMode;
  readOnly?: boolean;
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
  /** Optional image converter. If omitted, the raw file is used as-is. */
  convertImage?: (file: File, onProgress?: (percent: number) => void) => Promise<File>;
  onError?: (error: unknown, context: string) => void;
  onNotify?: (msg: string, type: "success" | "error") => void;
  labels?: Partial<TipTapEditorLabels>;
};

type SlashCommand = {
  id: string;
  label: string;
  run: (editor: Editor) => void;
};

const DEFAULT_DOC_JSON = _TIPTAP_DEFAULT_JSON;

function parseContent(value: string, mode: EditorMode): Content {
  if (!value.trim()) {
    return mode === "json" ? (JSON.parse(DEFAULT_DOC_JSON) as Content) : "<p></p>";
  }

  if (mode === "json") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        return parsed as Content;
      }
      return JSON.parse(DEFAULT_DOC_JSON) as Content;
    } catch {
      return JSON.parse(DEFAULT_DOC_JSON) as Content;
    }
  }

  return value;
}

function sanitizeDocJson(doc: Record<string, unknown>): Record<string, unknown> {
  if (!doc || typeof doc !== "object") return doc;
  const node = doc as { type?: string; attrs?: { src?: string }; content?: unknown[] };
  if (node.type === "image" && node.attrs?.src) {
    const src = node.attrs.src;
    if (!/^https?:\/\//i.test(src)) {
      node.attrs.src = "";
    }
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => sanitizeDocJson(child as Record<string, unknown>));
  }
  return doc;
}

export function sanitizeTipTapHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_TAGS: [
      "p", "span", "b", "strong", "i", "em", "u", "s",
      "mark", "ul", "ol", "li", "blockquote", "code", "pre",
      "table", "thead", "tbody", "tr", "th", "td",
      "a", "img", "br", "h1", "h2", "h3", "hr",
      "label", "input", "div", "iframe",
      "details", "summary",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "style", "data-type", "data-checked", "type", "checked", "disabled", "data-bilibili-video", "allowfullscreen", "sandbox", "width", "height", "frameborder", "allow", "open"],
  });
}

function serializeValue(editor: Editor, mode: EditorMode): string {
  if (mode === "json") {
    const doc = editor.getJSON() as Record<string, unknown>;
    return JSON.stringify(sanitizeDocJson(doc));
  }

  return sanitizeTipTapHtml(editor.getHTML());
}

function removeSlashTrigger(editor: Editor): void {
  const position = editor.state.selection.from;
  if (position <= 1) return;
  const previousChar = editor.state.doc.textBetween(position - 1, position, "", "");
  if (previousChar === "/") {
    editor.chain().focus().deleteRange({ from: position - 1, to: position }).run();
  }
}

export const TipTapEditor = forwardRef<HTMLDivElement, TipTapEditorProps>(
  function TipTapEditor({
    value,
    onChange,
    placeholder,
    mode = "json",
    readOnly = false,
    editable,
    onImageUpload,
    convertImage,
    onError,
    onNotify,
    labels: labelsProp,
    ...rest
  }, ref) {
    const labels = useMemo(() => ({ ...DEFAULT_LABELS, ...labelsProp }), [labelsProp]);
    const effectiveReadOnly = editable === undefined ? readOnly : !editable;
    const [slashOpen, setSlashOpen] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState(0);
    const [lightboxImageSrc, setLightboxImageSrc] = useState<string | null>(null);
    const [lightboxZoom, setLightboxZoom] = useState(1);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState("https://");
    const [linkSelection, setLinkSelection] = useState<{ from: number; to: number } | null>(null);
    const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [findReplaceOpen, setFindReplaceOpen] = useState(false);
    const [videoDialogOpen, setVideoDialogOpen] = useState(false);
    const [videoUrl, setVideoUrl] = useState("");
    const linkDialogTitleId = useId();
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const uploadImageAndInsert = useCallback(async (editor: Editor, file: File): Promise<void> => {
      try {
        setIsUploadingImage(true);
        setImageUploadProgress(5);
        const converted = convertImage
          ? await convertImage(file, (percent) => setImageUploadProgress(percent))
          : file;
        const source = onImageUpload ? await onImageUpload(converted) : URL.createObjectURL(converted);
        setImageUploadProgress(100);
        editor.chain().focus().setImage({ src: source, alt: converted.name }).run();
        onNotify?.(labels.imageInserted, "success");
      } catch (error) {
        onError?.(error, labels.imageUploadFailed);
        onNotify?.(labels.imageUploadFailed, "error");
      } finally {
        setTimeout(() => {
          setIsUploadingImage(false);
          setImageUploadProgress(0);
        }, 300);
      }
    }, [convertImage, onImageUpload, onNotify, onError, labels]);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          horizontalRule: false,
          link: {
            openOnClick: false,
            HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
          },
        }),
        CodeBlockLowlight.configure({ lowlight }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
        HorizontalRule,
        TaskList,
        TaskItem.configure({ nested: true }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({
          HTMLAttributes: { loading: "lazy", decoding: "async" },
        }),
        Youtube.configure({ nocookie: true, HTMLAttributes: { class: "infini-tiptap-embed" } }),
        Bilibili,
        Details.configure({ persist: true }),
        DetailsContent,
        DetailsSummary,
        CharacterCount,
        SearchReplace,
        Placeholder.configure({
          placeholder: placeholder ?? "Start typing...",
        }),
      ],
      content: parseContent(value, mode),
      editable: !effectiveReadOnly,
      editorProps: {
        attributes: { class: "infini-tiptap-surface" },
        handleDOMEvents: {
          contextmenu: (_view: unknown, event: Event) => {
            if (effectiveReadOnly) return false;
            event.preventDefault();
            const me = event as MouseEvent;
            setContextMenuPos({ x: me.clientX, y: me.clientY });
            return true;
          },
        },
        handlePaste: (_view: unknown, event: ClipboardEvent) => {
          if (effectiveReadOnly || !editor) return false;
          const files = Array.from((event.clipboardData?.files ?? []) as FileList).filter((f) => f.type.startsWith("image/"));
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadImageAndInsert(editor, files[0] as File);
          return true;
        },
        handleDrop: (_view: unknown, event: DragEvent) => {
          if (effectiveReadOnly || !editor) return false;
          const files = Array.from((event.dataTransfer?.files ?? []) as FileList).filter((f) => f.type.startsWith("image/"));
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadImageAndInsert(editor, files[0] as File);
          return true;
        },
        handleClick: (_view: unknown, _position: number, event: MouseEvent) => {
          if (!effectiveReadOnly) return false;
          const target = event.target;
          if (!(target instanceof HTMLImageElement)) return false;
          const source = target.currentSrc || target.src;
          if (!source) return false;
          setLightboxImageSrc(source);
          setLightboxZoom(1);
          return true;
        },
        handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
          if (effectiveReadOnly) return false;
          if (event.key === "/") setSlashOpen(true);
          if (event.key === "Escape") setSlashOpen(false);
          if ((event.ctrlKey || event.metaKey) && event.key === "f") {
            event.preventDefault();
            setFindReplaceOpen(true);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: nextEditor }: { editor: Editor }) => {
        onChange(serializeValue(nextEditor, mode));
      },
    });

    useEffect(() => {
      if (!editor) return;
      const nextContent = parseContent(value, mode);
      if (mode === "json") {
        const current = JSON.stringify(editor.getJSON());
        const incoming = typeof nextContent === "string" ? nextContent : JSON.stringify(nextContent);
        if (current !== incoming) editor.commands.setContent(nextContent, { emitUpdate: false });
        return;
      }
      const incoming = typeof nextContent === "string" ? nextContent : "";
      if (editor.getHTML() !== incoming) editor.commands.setContent(incoming, { emitUpdate: false });
    }, [editor, mode, value]);

    const slashCommands = useMemo<SlashCommand[]>(
      () => [
        { id: "heading1", label: labels.h1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
        { id: "heading2", label: labels.h2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
        { id: "heading3", label: labels.h3, run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
        { id: "bullet", label: labels.bullet, run: (e) => e.chain().focus().toggleBulletList().run() },
        { id: "ordered", label: labels.number, run: (e) => e.chain().focus().toggleOrderedList().run() },
        { id: "task", label: labels.taskList, run: (e) => e.chain().focus().toggleTaskList().run() },
        { id: "quote", label: labels.quote, run: (e) => e.chain().focus().toggleBlockquote().run() },
        { id: "codeblock", label: labels.code, run: (e) => e.chain().focus().toggleCodeBlock().run() },
        { id: "divider", label: labels.divider, run: (e) => e.chain().focus().setHorizontalRule().run() },
        { id: "table", label: labels.table, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3 }).run() },
        { id: "image", label: labels.image, run: () => fileInputRef.current?.click() },
        { id: "details", label: labels.details, run: (e) => (e.commands as unknown as { setDetails: () => void }).setDetails() },
        { id: "video", label: labels.embedVideo, run: () => setVideoDialogOpen(true) },
      ],
      [labels],
    );

    if (!editor) return null;

    const openLinkDialog = () => {
      const previousUrl = editor.getAttributes("link").href as string | undefined;
      setLinkSelection({ from: editor.state.selection.from, to: editor.state.selection.to });
      setLinkUrl(previousUrl ?? "https://");
      setLinkDialogOpen(true);
    };

    const closeLinkDialog = () => {
      setLinkDialogOpen(false);
      setLinkSelection(null);
    };

    const runLinkCommand = (mode: "set" | "unset") => {
      let chain = editor.chain().focus();
      if (linkSelection) {
        chain = chain.setTextSelection(linkSelection);
      }
      if (mode === "unset" || linkUrl.trim() === "") {
        chain.extendMarkRange("link").unsetLink().run();
        closeLinkDialog();
        return;
      }
      chain.extendMarkRange("link").setLink({ href: linkUrl.trim() }).run();
      closeLinkDialog();
    };

    const insertVideo = () => {
      const url = videoUrl.trim();
      if (!url) return;
      if (isValidBilibiliUrl(url)) {
        (editor.commands as unknown as { setBilibiliVideo: (opts: { src: string }) => void }).setBilibiliVideo({ src: url });
      } else {
        editor.commands.setYoutubeVideo({ src: url });
      }
      setVideoUrl("");
      setVideoDialogOpen(false);
    };

    const charCount = editor.storage.characterCount as { characters: () => number; words: () => number };

    return (
      <Stack ref={ref} gap={8} w="100%" {...rest}>
        {!effectiveReadOnly ? (
          <TipTapEditorToolbar
            editor={editor}
            labels={labels}
            onInsertLink={openLinkDialog}
            onInsertImage={() => fileInputRef.current?.click()}
            onInsertVideo={() => setVideoDialogOpen(true)}
            onToggleFindReplace={() => setFindReplaceOpen((v) => !v)}
          />
        ) : null}

        {findReplaceOpen && !effectiveReadOnly ? (
          <TipTapEditorFindReplace
            editor={editor}
            labels={labels}
            onClose={() => setFindReplaceOpen(false)}
          />
        ) : null}

        {slashOpen && !effectiveReadOnly ? (
          <Card withBorder padding="sm" className="infini-tiptap-slash-menu">
            <Text c="dimmed" size="sm">{labels.slashCommands}</Text>
            <Group gap={8} wrap="wrap" mt={8}>
              {slashCommands.map((command) => (
                <Button
                  size="xs"
                  variant="default"
                  key={command.id}
                  onClick={() => {
                    removeSlashTrigger(editor);
                    command.run(editor);
                    setSlashOpen(false);
                  }}
                >
                  {command.label}
                </Button>
              ))}
              <Button size="xs" variant="default" onClick={() => setSlashOpen(false)}>
                {labels.close}
              </Button>
            </Group>
          </Card>
        ) : null}

        {isUploadingImage ? (
          <Alert color="blue" title={labels.uploading} variant="light">
            <Progress value={imageUploadProgress} size="sm" mt={8} />
          </Alert>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadImageAndInsert(editor, file);
            event.target.value = "";
          }}
        />

        <div className="infini-tiptap-layout">
          <div className="infini-tiptap-layout__main">
            <EditorContent editor={editor} />

            {!effectiveReadOnly ? (
              <Text size="xs" c="dimmed" ta="right" className="infini-tiptap-word-count">
                {charCount.words()} {labels.words} · {charCount.characters()} {labels.characters}
              </Text>
            ) : null}
          </div>

          <TipTapEditorToc editor={editor} labels={labels} />
        </div>

        {linkDialogOpen ? (
          <TipTapEditorLinkDialog
            labels={labels}
            titleId={linkDialogTitleId}
            url={linkUrl}
            onUrlChange={setLinkUrl}
            onClose={closeLinkDialog}
            onSubmit={() => runLinkCommand("set")}
            onUnset={() => runLinkCommand("unset")}
          />
        ) : null}

        <Modal opened={Boolean(lightboxImageSrc)} onClose={() => setLightboxImageSrc(null)} size={960} keepMounted={false}>
          {lightboxImageSrc ? (
            <Stack gap={8} w="100%">
              <Group gap={8}>
                <Button variant="default" onClick={() => setLightboxZoom((v) => Math.max(1, Number((v - 0.2).toFixed(2))))}>-</Button>
                <Button variant="default" onClick={() => setLightboxZoom(1)}>100%</Button>
                <Button variant="default" onClick={() => setLightboxZoom((v) => Math.min(2.6, Number((v + 0.2).toFixed(2))))}>+</Button>
              </Group>
              <div
                className="infini-tiptap-lightbox-viewport"
                style={{ cursor: lightboxZoom > 1 ? "zoom-out" : "zoom-in" }}
                onWheel={(event) => {
                  event.preventDefault();
                  const direction = event.deltaY < 0 ? 0.12 : -0.12;
                  setLightboxZoom((v) => Math.min(2.6, Math.max(1, Number((v + direction).toFixed(2)))));
                }}
                onDoubleClick={() => setLightboxZoom((v) => (v > 1 ? 1 : 2.2))}
              >
                <img
                  src={lightboxImageSrc}
                  alt="Enlarged preview"
                  loading="lazy"
                  decoding="async"
                  className="infini-tiptap-lightbox-image"
                  style={{ transform: `scale(${lightboxZoom})` }}
                />
              </div>
            </Stack>
          ) : null}
        </Modal>

        {contextMenuPos && !effectiveReadOnly ? (
          <TipTapEditorContextMenu
            editor={editor}
            labels={labels}
            position={contextMenuPos}
            onClose={() => setContextMenuPos(null)}
            onInsertLink={openLinkDialog}
            onInsertImage={() => fileInputRef.current?.click()}
            onInsertVideo={() => setVideoDialogOpen(true)}
          />
        ) : null}

        <Modal opened={videoDialogOpen} onClose={() => setVideoDialogOpen(false)} title={labels.embedVideo} size="sm" keepMounted={false}>
          <Stack gap={12}>
            <Text size="sm" c="dimmed">{labels.youtube} / {labels.bilibili}</Text>
            <input
              className="infini-tiptap-link-dialog__input"
              placeholder={labels.videoUrl}
              aria-label={labels.videoUrl}
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") insertVideo(); }}
              autoFocus
            />
            <Group justify="flex-end">
              <Button size="sm" onClick={insertVideo}>{labels.embedVideo}</Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    );
  }
);

// Re-exported from tiptap-meta for backward compatibility.
export const TIPTAP_DEFAULT_JSON = _TIPTAP_DEFAULT_JSON;
