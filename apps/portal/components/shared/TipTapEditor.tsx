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
import { notifications } from "@mantine/notifications";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { presentAppError } from "../../hooks/useAppError";
import { convertImageToWebP } from "../../utils/media-conversion";
import styles from "./TipTapEditor.module.css";

type EditorMode = "json" | "html";

type TipTapEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode?: EditorMode;
  readOnly?: boolean;
  editable?: boolean;
  onImageUpload?: (file: File) => Promise<string>;
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

function serializeValue(editor: Editor, mode: EditorMode): string {
  if (mode === "json") {
    return JSON.stringify(editor.getJSON());
  }

  return DOMPurify.sanitize(editor.getHTML(), {
    ALLOWED_TAGS: [
      "p",
      "span",
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
      "br",
      "h1",
      "h2",
      "h3",
    ],
    ALLOWED_ATTR: ["style", "href", "target", "rel", "src", "alt"],
  });
}

function removeSlashTrigger(editor: Editor): void {
  const position = editor.state.selection.from;
  if (position <= 1) {
    return;
  }
  const previousChar = editor.state.doc.textBetween(position - 1, position, "", "");
  if (previousChar === "/") {
    editor.chain().focus().deleteRange({ from: position - 1, to: position }).run();
  }
}

export function TipTapEditor({
  value,
  onChange,
  placeholder,
  mode = "json",
  readOnly = false,
  editable,
  onImageUpload,
}: TipTapEditorProps) {
  const { t } = useTranslation("editor");
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
      const converted = await convertImageToWebP(file, (percent) => setImageUploadProgress(percent));
      const source = onImageUpload ? await onImageUpload(converted) : URL.createObjectURL(converted);
      setImageUploadProgress(100);
      editor.chain().focus().setImage({ src: source, alt: converted.name }).run();
      notifications.show({
        color: "infini-success",
        message: t("message.imageInserted"),
      });
    } catch (error) {
      presentAppError(error, "Image upload failed");
    } finally {
      setTimeout(() => {
        setIsUploadingImage(false);
        setImageUploadProgress(0);
      }, 300);
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({
        HTMLAttributes: {
          loading: "lazy",
          decoding: "async",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Start typing…",
      }),
    ],
    content: parseContent(value, mode),
    editable: !effectiveReadOnly,
    editorProps: {
      attributes: {
        class: styles.editorSurface,
      },
      handlePaste: (_view, event) => {
        if (effectiveReadOnly) {
          return false;
        }
        if (!editor) {
          return false;
        }
        const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) {
          return false;
        }
        event.preventDefault();
        void uploadImageAndInsert(editor, files[0] as File);
        return true;
      },
      handleDrop: (_view, event) => {
        if (effectiveReadOnly) {
          return false;
        }
        if (!editor) {
          return false;
        }
        const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
          file.type.startsWith("image/"),
        );
        if (files.length === 0) {
          return false;
        }
        event.preventDefault();
        void uploadImageAndInsert(editor, files[0] as File);
        return true;
      },
      handleClick: (_view, _position, event) => {
        if (!effectiveReadOnly) {
          return false;
        }
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) {
          return false;
        }
        const source = target.currentSrc || target.src;
        if (!source) {
          return false;
        }
        setLightboxImageSrc(source);
        setLightboxZoom(1);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (effectiveReadOnly) {
          return false;
        }
        if (event.key === "/") {
          setSlashOpen(true);
        }
        if (event.key === "Escape") {
          setSlashOpen(false);
        }
        return false;
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      onChange(serializeValue(nextEditor, mode));
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const nextContent = parseContent(value, mode);
    if (mode === "json") {
      const current = JSON.stringify(editor.getJSON());
      const incoming = typeof nextContent === "string" ? nextContent : JSON.stringify(nextContent);
      if (current !== incoming) {
        editor.commands.setContent(nextContent, false);
      }
      return;
    }

    const incoming = typeof nextContent === "string" ? nextContent : "";
    if (editor.getHTML() !== incoming) {
      editor.commands.setContent(incoming, false);
    }
  }, [editor, mode, value]);

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "heading1",
        label: t("toolbar.h1"),
        run: (nextEditor) => nextEditor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "heading2",
        label: t("toolbar.h2"),
        run: (nextEditor) => nextEditor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "bullet",
        label: t("toolbar.bullet"),
        run: (nextEditor) => nextEditor.chain().focus().toggleBulletList().run(),
      },
      {
        id: "ordered",
        label: t("toolbar.number"),
        run: (nextEditor) => nextEditor.chain().focus().toggleOrderedList().run(),
      },
      {
        id: "codeblock",
        label: t("toolbar.code"),
        run: (nextEditor) => nextEditor.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: "table",
        label: t("toolbar.table"),
        run: (nextEditor) => nextEditor.chain().focus().insertTable({ rows: 3, cols: 3 }).run(),
      },
      {
        id: "image",
        label: t("toolbar.image"),
        run: () => fileInputRef.current?.click(),
      },
    ],
    [t],
  );

  if (!editor) {
    return null;
  }

  const insertLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previousUrl ?? "https://");
    if (url === null) {
      return;
    }
    if (url.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <Stack gap={8} w="100%">
      {!effectiveReadOnly ? (
        <div className={styles.toolbar}>
          <Tooltip label={t("toolbar.bold")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBold().run()}><IconBold size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.italic")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleItalic().run()}><IconItalic size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.underline")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleUnderline().run()}><IconUnderline size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.strike")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleStrike().run()}><IconStrikethrough size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.link")} withArrow><ActionIcon size="sm" variant="default" onClick={insertLink}><IconLink size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.unlink")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().unsetLink().run()}><IconLinkOff size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.h1")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}><IconH1 size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.h2")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><IconH2 size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.h3")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><IconH3 size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.bullet")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBulletList().run()}><IconList size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.number")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleOrderedList().run()}><IconListNumbers size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.quote")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleBlockquote().run()}><IconBlockquote size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.code")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().toggleCodeBlock().run()}><IconCode size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.table")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}><IconTable size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.addCol")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().addColumnAfter().run()}><IconColumnInsertRight size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.addRow")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().addRowAfter().run()}><IconRowInsertBottom size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.delTable")} withArrow><ActionIcon size="sm" variant="default" onClick={() => editor.chain().focus().deleteTable().run()}><IconTableOff size={16} /></ActionIcon></Tooltip>
          <Tooltip label={t("toolbar.image")} withArrow><ActionIcon size="sm" variant="default" onClick={() => fileInputRef.current?.click()}><IconPhoto size={16} /></ActionIcon></Tooltip>
        </div>
      ) : null}

      {slashOpen && !effectiveReadOnly ? (
        <Card withBorder padding="sm" className={styles.slashMenu}>
          <Text c="dimmed" size="sm">
            {t("slashCommands")}
          </Text>
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
              Close
            </Button>
          </Group>
        </Card>
      ) : null}

      {isUploadingImage ? (
        <Alert color="infini-primary" title="Uploading image..." variant="light">
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
          if (file) {
            void uploadImageAndInsert(editor, file);
          }
          event.target.value = "";
        }}
      />

      <EditorContent editor={editor} />

      <Modal opened={Boolean(lightboxImageSrc)} onClose={() => setLightboxImageSrc(null)} size={960} keepMounted={false}>
        {lightboxImageSrc ? (
          <Stack gap={8} w="100%">
            <Group gap={8}>
              <Button variant="default" onClick={() => setLightboxZoom((value) => Math.max(1, Number((value - 0.2).toFixed(2))))}>
                -
              </Button>
              <Button variant="default" onClick={() => setLightboxZoom(1)}>
                100%
              </Button>
              <Button variant="default" onClick={() => setLightboxZoom((value) => Math.min(2.6, Number((value + 0.2).toFixed(2))))}>
                +
              </Button>
            </Group>
            <div
              className={styles.lightboxViewport}
              style={{ cursor: lightboxZoom > 1 ? "zoom-out" : "zoom-in" }}
              onWheel={(event) => {
                event.preventDefault();
                const direction = event.deltaY < 0 ? 0.12 : -0.12;
                setLightboxZoom((value) => Math.min(2.6, Math.max(1, Number((value + direction).toFixed(2)))));
              }}
              onDoubleClick={() => setLightboxZoom((value) => (value > 1 ? 1 : 2.2))}
            >
              <img
                src={lightboxImageSrc}
                alt="Announcement image"
                loading="lazy"
                decoding="async"
                className={styles.lightboxImage}
                style={{ transform: `scale(${lightboxZoom})` }}
              />
            </div>
          </Stack>
        ) : null}
      </Modal>
    </Stack>
  );
}

export const TIPTAP_DEFAULT_JSON = DEFAULT_DOC_JSON;

