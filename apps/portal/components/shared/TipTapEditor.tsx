import { forwardRef } from "react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import type { Content } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Alert, ActionIcon, Button, Card, Group, Modal, Progress, Stack, Text, Tooltip } from "@mantine/core";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBold,
  IconItalic,
  IconUnderline,
  IconStrikethrough,
  IconLink,
  IconLinkOff,
  IconH1,
  IconH2,
  IconH3,
  IconList,
  IconListNumbers,
  IconBlockquote,
  IconCode,
  IconTable,
  IconColumnInsertRight,
  IconRowInsertBottom,
  IconTableOff,
  IconPhoto,
} from "@tabler/icons-react";
import { lowlight } from "lowlight";
import "./tiptap-editor.css";

type EditorMode = "json" | "html";

export type TipTapEditorLabels = {
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  link: string;
  unlink: string;
  h1: string;
  h2: string;
  h3: string;
  bullet: string;
  number: string;
  quote: string;
  code: string;
  table: string;
  addCol: string;
  addRow: string;
  delTable: string;
  image: string;
  close: string;
  slashCommands: string;
  linkPrompt: string;
  imageInserted: string;
  imageUploadFailed: string;
  uploading: string;
};

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
  delTable: "Delete table",
  image: "Image",
  close: "Close",
  slashCommands: "Slash commands",
  linkPrompt: "Enter URL",
  imageInserted: "Image inserted",
  imageUploadFailed: "Image upload failed",
  uploading: "Uploading...",
};

/**
 * Rich text editor built on TipTap.
 *
 * Requires the following peer dependencies to be installed:
 * `@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`,
 * `@tiptap/extension-code-block-lowlight`, `@tiptap/extension-image`,
 * `@tiptap/extension-link`, `@tiptap/extension-placeholder`,
 * `@tiptap/extension-table`, `@tiptap/extension-table-cell`,
 * `@tiptap/extension-table-header`, `@tiptap/extension-table-row`,
 * `@tiptap/extension-underline`, `dompurify`, `lowlight`, `@tabler/icons-react`
 */
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

const DEFAULT_DOC_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph" }],
});

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

function serializeValue(editor: Editor, mode: EditorMode): string {
  if (mode === "json") {
    const doc = editor.getJSON() as Record<string, unknown>;
    return JSON.stringify(sanitizeDocJson(doc));
  }

  return DOMPurify.sanitize(editor.getHTML(), {
    ALLOWED_TAGS: [
      "p", "span", "b", "strong", "i", "em", "u", "s",
      "ul", "ol", "li", "blockquote", "code", "pre",
      "table", "thead", "tbody", "tr", "th", "td",
      "a", "img", "br", "h1", "h2", "h3",
    ],
    ALLOWED_ATTR: ["href", "target", "rel", "src", "alt"],
  });
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
    const labels = { ...DEFAULT_LABELS, ...labelsProp };
    const effectiveReadOnly = editable === undefined ? readOnly : !editable;
    const [slashOpen, setSlashOpen] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState(0);
    const [lightboxImageSrc, setLightboxImageSrc] = useState<string | null>(null);
    const [lightboxZoom, setLightboxZoom] = useState(1);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const uploadImageAndInsert = async (editor: Editor, file: File): Promise<void> => {
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
    };

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        Underline,
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
        CodeBlockLowlight.configure({ lowlight }),
        Table.configure({ resizable: true }),
        TableRow,
        TableHeader,
        TableCell,
        Image.configure({
          HTMLAttributes: { loading: "lazy", decoding: "async" },
        }),
        Placeholder.configure({
          placeholder: placeholder ?? "Start typing…",
        }),
      ],
      content: parseContent(value, mode),
      editable: !effectiveReadOnly,
      editorProps: {
        attributes: { class: "infini-tiptap-surface" },
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
        if (current !== incoming) editor.commands.setContent(nextContent, false);
        return;
      }
      const incoming = typeof nextContent === "string" ? nextContent : "";
      if (editor.getHTML() !== incoming) editor.commands.setContent(incoming, false);
    }, [editor, mode, value]);

    const slashCommands = useMemo<SlashCommand[]>(
      () => [
        { id: "heading1", label: labels.h1, run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
        { id: "heading2", label: labels.h2, run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
        { id: "bullet", label: labels.bullet, run: (e) => e.chain().focus().toggleBulletList().run() },
        { id: "ordered", label: labels.number, run: (e) => e.chain().focus().toggleOrderedList().run() },
        { id: "codeblock", label: labels.code, run: (e) => e.chain().focus().toggleCodeBlock().run() },
        { id: "table", label: labels.table, run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3 }).run() },
        { id: "image", label: labels.image, run: () => fileInputRef.current?.click() },
      ],
      [labels],
    );

    if (!editor) return null;

    const insertLink = () => {
      const previousUrl = editor.getAttributes("link").href as string | undefined;
      const url = window.prompt(labels.linkPrompt, previousUrl ?? "https://");
      if (url === null) return;
      if (url.trim() === "") {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
    };

    return (
      <Stack ref={ref} gap={8} w="100%" {...rest}>
        {!effectiveReadOnly ? (
          <div className="infini-tiptap-toolbar">
            <Tooltip label={labels.bold} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBold().run()}><IconBold size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.italic} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleItalic().run()}><IconItalic size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.underline} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleUnderline().run()}><IconUnderline size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.strike} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleStrike().run()}><IconStrikethrough size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.link} withArrow><ActionIcon size="sm" variant="default" onClick={insertLink}><IconLink size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.unlink} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().unsetLink().run()}><IconLinkOff size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.h1} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><IconH1 size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.h2} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IconH2 size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.h3} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><IconH3 size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.bullet} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBulletList().run()}><IconList size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.number} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleOrderedList().run()}><IconListNumbers size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.quote} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBlockquote().run()}><IconBlockquote size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.code} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><IconCode size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.table} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}><IconTable size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.addCol} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().addColumnAfter().run()}><IconColumnInsertRight size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.addRow} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().addRowAfter().run()}><IconRowInsertBottom size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.delTable} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().deleteTable().run()}><IconTableOff size={16} /></ActionIcon></Tooltip>
            <Tooltip label={labels.image} withArrow><ActionIcon size="sm" variant="default" onClick={() => fileInputRef.current?.click()}><IconPhoto size={16} /></ActionIcon></Tooltip>
          </div>
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
          <Alert color="infini-primary" title={labels.uploading} variant="light">
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

        <EditorContent editor={editor} />

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
      </Stack>
    );
  }
);

export const TIPTAP_DEFAULT_JSON = DEFAULT_DOC_JSON;
