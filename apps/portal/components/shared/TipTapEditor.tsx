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
import { Alert, Button, Card, Group, Modal, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import DOMPurify from "dompurify";
import { useEffect, useMemo, useRef, useState } from "react";
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
      return JSON.parse(value) as Content;
    } catch {
      return value;
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
        color: "green",
        message: "Image inserted",
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
        label: "Heading 1",
        run: (nextEditor) => nextEditor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: "heading2",
        label: "Heading 2",
        run: (nextEditor) => nextEditor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: "bullet",
        label: "Bullet List",
        run: (nextEditor) => nextEditor.chain().focus().toggleBulletList().run(),
      },
      {
        id: "ordered",
        label: "Numbered List",
        run: (nextEditor) => nextEditor.chain().focus().toggleOrderedList().run(),
      },
      {
        id: "codeblock",
        label: "Code Block",
        run: (nextEditor) => nextEditor.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: "table",
        label: "Table 3x3",
        run: (nextEditor) => nextEditor.chain().focus().insertTable({ rows: 3, cols: 3 }).run(),
      },
      {
        id: "image",
        label: "Image Upload",
        run: () => fileInputRef.current?.click(),
      },
    ],
    [],
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
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleBold().run()}>
            Bold
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleItalic().run()}>
            Italic
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleUnderline().run()}>
            Underline
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleStrike().run()}>
            Strike
          </Button>
          <Button size="xs" variant="default" onClick={insertLink}>
            Link
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().unsetLink().run()}>
            Unlink
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            H1
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            H2
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            H3
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleBulletList().run()}>
            Bullet
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            Number
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            Quote
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            Code
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run()}
          >
            Table
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            +Col
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().addRowAfter().run()}>
            +Row
          </Button>
          <Button size="xs" variant="default" onClick={() => editor.chain().focus().deleteTable().run()}>
            Del Table
          </Button>
          <Button size="xs" variant="default" onClick={() => fileInputRef.current?.click()}>
            Image
          </Button>
        </div>
      ) : null}

      {slashOpen && !effectiveReadOnly ? (
        <Card withBorder padding="sm" className={styles.slashMenu}>
          <Text c="dimmed" size="sm">
            Slash Commands
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
        <Alert color="blue" title="Uploading image..." variant="light">
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
