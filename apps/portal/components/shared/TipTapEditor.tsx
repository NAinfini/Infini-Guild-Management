import { canonicalizeRichTextLinkAttributes, IMAGE_FILE_ACCEPT } from "@guild/shared";
import { forwardRef } from "react";
import {
  TIPTAP_DEFAULT_JSON,
  buildTipTapEditorLabels,
  type TipTapEditorLabels,
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
import DOMPurify from "dompurify";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { common, createLowlight } from "lowlight";
import { XIcon } from "@portal/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@portal/components/ui/alert";
import { Button } from "@portal/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@portal/components/ui/dialog";
import { Input } from "@portal/components/ui/input";
import { Progress } from "@portal/components/ui/progress";
import { Bilibili, isValidBilibiliUrl } from "./tiptap-ext-bilibili";
import { SearchReplace } from "./tiptap-ext-search-replace";

import { TipTapEditorToolbar } from "./TipTapEditorToolbar";
import { TipTapEditorContextMenu } from "./TipTapEditorContextMenu";
import { TipTapEditorLinkDialog } from "./TipTapEditorLinkDialog";
import { TipTapEditorFindReplace } from "./TipTapEditorFindReplace";
import { withMediaVariant } from "../../utils/media";
import { TipTapEditorToc } from "./TipTapEditorToc";

const lowlight = createLowlight(common);
import "./tiptap-editor.css";

type EditorMode = "json" | "html";

type LightboxImage = {
  src: string;
  alt: string;
};

const LIGHTBOX_ZOOM_MIN = 1;
const LIGHTBOX_ZOOM_MAX = 2.6;
const LIGHTBOX_ZOOM_STEP = 0.2;
const RICH_TEXT_MEDIA_VIEW_PATH = /^\/api\/media\/[A-Za-z0-9_-]{21}\/view$/;

export type TipTapEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode?: EditorMode;
  readOnly?: boolean;
  editable?: boolean;
  showTableOfContents?: boolean;
  ariaLabel?: string;
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

const DEFAULT_DOC_JSON = TIPTAP_DEFAULT_JSON;

function parseContent(value: string, mode: EditorMode): Content {
  if (!value.trim()) {
    return mode === "json" ? (JSON.parse(DEFAULT_DOC_JSON) as Content) : "<p></p>";
  }

  if (mode === "json") {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && parsed.type === "doc") {
        return (sanitizeDocJson(parsed) ?? JSON.parse(DEFAULT_DOC_JSON)) as Content;
      }
      return JSON.parse(DEFAULT_DOC_JSON) as Content;
    } catch {
      return JSON.parse(DEFAULT_DOC_JSON) as Content;
    }
  }

  return value;
}

function richTextOrigin(): string {
  return typeof window === "undefined" ? "http://portal.invalid" : window.location.origin;
}

function canonicalRichTextImageSource(source: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(source, origin);
  } catch {
    return null;
  }
  return url.origin === origin
    && RICH_TEXT_MEDIA_VIEW_PATH.test(url.pathname)
    && !url.search
    && !url.hash
    ? url.pathname
    : null;
}

function sanitizeRichTextMarks(marks: unknown, origin: string): unknown[] | undefined {
  if (!Array.isArray(marks)) return undefined;
  return marks.flatMap((mark) => {
    if (!mark || typeof mark !== "object" || Array.isArray(mark)
      || (mark as { type?: unknown }).type !== "link") return [mark];
    const attrs = (mark as { attrs?: unknown }).attrs;
    const canonical = canonicalizeRichTextLinkAttributes(
      attrs && typeof attrs === "object" && !Array.isArray(attrs)
        ? attrs as Record<string, unknown>
        : {},
      origin,
    );
    return canonical ? [{ ...mark, attrs: canonical }] : [];
  });
}

function sanitizeDocJson(
  doc: Record<string, unknown>,
  origin = richTextOrigin(),
): Record<string, unknown> | null {
  const node = doc as {
    type?: string;
    attrs?: Record<string, unknown>;
    marks?: unknown;
    content?: unknown[];
  };
  const marks = sanitizeRichTextMarks(node.marks, origin);
  const sanitized = marks === undefined ? { ...doc } : { ...doc, marks };
  if (node.type === "image") {
    const source = typeof node.attrs?.src === "string"
      ? canonicalRichTextImageSource(node.attrs.src, origin)
      : null;
    return source ? { ...sanitized, attrs: { ...node.attrs, src: source } } : null;
  }
  if (!Array.isArray(node.content)) return sanitized;
  return {
    ...sanitized,
    content: node.content.flatMap((child) => {
      if (!child || typeof child !== "object" || Array.isArray(child)) return [];
      const childSanitized = sanitizeDocJson(child as Record<string, unknown>, origin);
      return childSanitized ? [childSanitized] : [];
    }),
  };
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
    return JSON.stringify(sanitizeDocJson(doc) ?? JSON.parse(DEFAULT_DOC_JSON));
  }

  return sanitizeTipTapHtml(editor.getHTML());
}

function formatWordCount(template: string, words: number, characters: number): string {
  return template
    .replace("{{words}}", String(words))
    .replace("{{characters}}", String(characters));
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
    showTableOfContents = true,
    ariaLabel,
    onImageUpload,
    convertImage,
    onError,
    onNotify,
    labels: labelsProp,
    ...rest
  }, ref) {
    const { t } = useTranslation("editor");
    const translatedLabels = useMemo(() => buildTipTapEditorLabels(t), [t]);
    const labels = useMemo(
      () => ({ ...translatedLabels, ...labelsProp }),
      [translatedLabels, labelsProp],
    );
    const effectiveReadOnly = editable === undefined ? readOnly : !editable;
    const [slashOpen, setSlashOpen] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const [imageUploadProgress, setImageUploadProgress] = useState(0);
    const [lightboxImage, setLightboxImage] = useState<LightboxImage | null>(null);
    const [lightboxZoom, setLightboxZoom] = useState(LIGHTBOX_ZOOM_MIN);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState("https://");
    const [linkSelection, setLinkSelection] = useState<{ from: number; to: number } | null>(null);
    const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [findReplaceOpen, setFindReplaceOpen] = useState(false);
    const [videoDialogOpen, setVideoDialogOpen] = useState(false);
    const [videoUrl, setVideoUrl] = useState("");
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const linkToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
    const videoToolbarTriggerRef = useRef<HTMLButtonElement | null>(null);
    const wasLinkDialogOpenRef = useRef(false);
    const wasVideoDialogOpenRef = useRef(false);

    useEffect(() => {
      if (wasLinkDialogOpenRef.current && !linkDialogOpen) {
        linkToolbarTriggerRef.current?.focus();
      }
      wasLinkDialogOpenRef.current = linkDialogOpen;
    }, [linkDialogOpen]);

    useEffect(() => {
      if (wasVideoDialogOpenRef.current && !videoDialogOpen) {
        videoToolbarTriggerRef.current?.focus();
      }
      wasVideoDialogOpenRef.current = videoDialogOpen;
    }, [videoDialogOpen]);

    const openLightbox = useCallback((image: HTMLImageElement): boolean => {
      const source = image.currentSrc || image.src;
      if (!source) return false;
      const originalAlt = image.getAttribute("alt");
      setLightboxImage({
        src: withMediaVariant(source, "full"),
        alt: originalAlt?.trim() ? originalAlt : labels.lightboxPreview,
      });
      setLightboxZoom(LIGHTBOX_ZOOM_MIN);
      return true;
    }, [labels.lightboxPreview]);

    const closeLightbox = useCallback(() => {
      setLightboxImage(null);
      setLightboxZoom(LIGHTBOX_ZOOM_MIN);
    }, []);

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
        // Read-only content is prose, not a field: the input frame and the 180px
        // min-height made published announcements look like an empty textarea.
        attributes: {
          class: effectiveReadOnly ? "infini-tiptap-surface infini-tiptap-surface--readonly" : "infini-tiptap-surface",
          ...(!effectiveReadOnly
            ? {
              role: "textbox",
              "aria-multiline": "true",
              ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
            }
            : {}),
        },
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
          return openLightbox(target);
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
      // React re-runs passive effects when a Suspense boundary re-shows its
      // content (reconnectPassiveEffects), but `useEditor`'s cleanup has already
      // called `editor.destroy()` by then — a destroyed editor nulls its
      // commandManager, so `editor.commands` throws and takes the whole route
      // down through the error boundary. Seen on /announcements and /wiki.
      if (!editor || editor.isDestroyed) return;
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

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;

      const syncReadOnlyImages = () => {
        const images = editor.view.dom.querySelectorAll("img");
        for (const image of images) {
          if (effectiveReadOnly) {
            const originalAlt = image.getAttribute("alt");
            image.tabIndex = 0;
            image.setAttribute("role", "button");
            image.setAttribute("aria-haspopup", "dialog");
            image.setAttribute(
              "aria-label",
              originalAlt?.trim() ? originalAlt : labels.lightboxPreview,
            );
            image.setAttribute("data-tiptap-lightbox-trigger", "true");
          } else if (image.getAttribute("data-tiptap-lightbox-trigger") === "true") {
            image.removeAttribute("tabindex");
            image.removeAttribute("role");
            image.removeAttribute("aria-haspopup");
            image.removeAttribute("aria-label");
            image.removeAttribute("data-tiptap-lightbox-trigger");
          }
        }
      };

      syncReadOnlyImages();
      editor.on("update", syncReadOnlyImages);
      const handleReadOnlyImageKeyDown = (event: KeyboardEvent) => {
        const target = event.target;
        if (
          effectiveReadOnly
          && (event.key === "Enter" || event.key === " ")
          && target instanceof HTMLImageElement
        ) {
          event.preventDefault();
          openLightbox(target);
        }
      };
      editor.view.dom.addEventListener("keydown", handleReadOnlyImageKeyDown);
      return () => {
        editor.off("update", syncReadOnlyImages);
        editor.view.dom.removeEventListener("keydown", handleReadOnlyImageKeyDown);
      };
    }, [editor, effectiveReadOnly, labels.lightboxPreview, openLightbox, value]);

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
    const lightboxZoomPercent = Math.round(lightboxZoom * 100);
    const lightboxZoomAnnouncement = labels.lightboxZoomLevel.replace(
      "{{percent}}",
      String(lightboxZoomPercent),
    );

    return (
      <div ref={ref} className="infini-tiptap-editor" {...rest}>
        {!effectiveReadOnly ? (
          <TipTapEditorToolbar
            editor={editor}
            labels={labels}
            onInsertLink={openLinkDialog}
            onInsertImage={() => fileInputRef.current?.click()}
            onInsertVideo={() => setVideoDialogOpen(true)}
            onToggleFindReplace={() => setFindReplaceOpen((v) => !v)}
            linkTriggerRef={linkToolbarTriggerRef}
            videoTriggerRef={videoToolbarTriggerRef}
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
          <section className="infini-tiptap-slash-menu" aria-label={labels.slashCommands}>
            <p className="infini-tiptap-slash-menu__title">{labels.slashCommands}</p>
            <div className="infini-tiptap-slash-menu__actions">
              {slashCommands.map((command) => (
                <Button
                  size="xs"
                  variant="outline"
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
              <Button type="button" size="xs" variant="outline" onClick={() => setSlashOpen(false)}>
                {labels.close}
              </Button>
            </div>
          </section>
        ) : null}

        {isUploadingImage ? (
          <Alert className="infini-tiptap-upload-status">
            <AlertTitle>{labels.uploading}</AlertTitle>
            <AlertDescription>
              <Progress value={imageUploadProgress} />
            </AlertDescription>
          </Alert>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_FILE_ACCEPT}
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
              <p className="infini-tiptap-word-count">
                {formatWordCount(labels.wordCount, charCount.words(), charCount.characters())}
              </p>
            ) : null}
          </div>

          {showTableOfContents ? <TipTapEditorToc editor={editor} labels={labels} /> : null}
        </div>

        {linkDialogOpen ? (
          <TipTapEditorLinkDialog
            labels={labels}
            url={linkUrl}
            onUrlChange={setLinkUrl}
            onClose={closeLinkDialog}
            onSubmit={() => runLinkCommand("set")}
            onUnset={() => runLinkCommand("unset")}
          />
        ) : null}

        <Dialog
          open={Boolean(lightboxImage)}
          onOpenChange={(open) => {
            if (!open) closeLightbox();
          }}
        >
          {lightboxImage ? (
            <DialogContent
              showCloseButton={false}
              finalFocus={false}
              overlayClassName="infini-tiptap-link-dialog-backdrop"
              className="infini-tiptap-lightbox-dialog sm:!max-w-[min(60rem,calc(100%-2rem))]"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DialogHeader className="infini-tiptap-lightbox__header">
                <DialogTitle>{labels.lightboxTitle}</DialogTitle>
                <DialogClose
                  render={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="infini-tiptap-dialog-close"
                      aria-label={labels.close}
                    />
                  )}
                >
                  <XIcon aria-hidden="true" />
                </DialogClose>
              </DialogHeader>
              <div className="infini-tiptap-lightbox">
                <div className="infini-tiptap-lightbox-controls">
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={labels.lightboxZoomOut}
                    disabled={lightboxZoom <= LIGHTBOX_ZOOM_MIN}
                    onClick={() => {
                      setLightboxZoom((zoom) => Math.max(
                        LIGHTBOX_ZOOM_MIN,
                        Number((zoom - LIGHTBOX_ZOOM_STEP).toFixed(2)),
                      ));
                    }}
                  >
                    -
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={labels.lightboxZoomReset}
                    disabled={lightboxZoom === LIGHTBOX_ZOOM_MIN}
                    onClick={() => setLightboxZoom(LIGHTBOX_ZOOM_MIN)}
                  >
                    {lightboxZoomPercent}%
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={labels.lightboxZoomIn}
                    disabled={lightboxZoom >= LIGHTBOX_ZOOM_MAX}
                    onClick={() => {
                      setLightboxZoom((zoom) => Math.min(
                        LIGHTBOX_ZOOM_MAX,
                        Number((zoom + LIGHTBOX_ZOOM_STEP).toFixed(2)),
                      ));
                    }}
                  >
                    +
                  </Button>
                </div>
                <span className="sr-only" aria-live="polite">
                  {lightboxZoomAnnouncement}
                </span>
                <div
                  className="infini-tiptap-lightbox-viewport"
                  style={{ cursor: lightboxZoom > LIGHTBOX_ZOOM_MIN ? "zoom-out" : "zoom-in" }}
                  onWheel={(event) => {
                    event.preventDefault();
                    const direction = event.deltaY < 0 ? 0.12 : -0.12;
                    setLightboxZoom((zoom) => Math.min(
                      LIGHTBOX_ZOOM_MAX,
                      Math.max(
                        LIGHTBOX_ZOOM_MIN,
                        Number((zoom + direction).toFixed(2)),
                      ),
                    ));
                  }}
                  onDoubleClick={() => {
                    setLightboxZoom((zoom) => (
                      zoom > LIGHTBOX_ZOOM_MIN ? LIGHTBOX_ZOOM_MIN : 2.2
                    ));
                  }}
                >
                  <img
                    src={lightboxImage.src}
                    alt={lightboxImage.alt}
                    loading="lazy"
                    decoding="async"
                    className="infini-tiptap-lightbox-image"
                    style={{ transform: `scale(${lightboxZoom})` }}
                  />
                </div>
              </div>
            </DialogContent>
          ) : null}
        </Dialog>

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

        <Dialog
          open={videoDialogOpen}
          onOpenChange={(open) => {
            if (!open) setVideoDialogOpen(false);
          }}
        >
          {videoDialogOpen ? (
            <DialogContent
              showCloseButton={false}
              finalFocus={false}
              overlayClassName="infini-tiptap-link-dialog-backdrop"
              className="sm:max-w-sm"
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                event.stopPropagation();
                setVideoDialogOpen(false);
              }}
            >
              <DialogHeader>
                <DialogTitle>{labels.embedVideo}</DialogTitle>
                <DialogClose
                  render={(
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="infini-tiptap-dialog-close"
                      aria-label={labels.close}
                    />
                  )}
                >
                  <XIcon aria-hidden="true" />
                </DialogClose>
              </DialogHeader>
              <div className="infini-tiptap-video-dialog">
                <p className="infini-tiptap-video-dialog__hint">{labels.youtube} / {labels.bilibili}</p>
                <Input
                  className="infini-tiptap-link-dialog__input"
                  placeholder={labels.videoUrl}
                  aria-label={labels.videoUrl}
                  value={videoUrl}
                  onChange={(event) => setVideoUrl(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.key !== "Enter") return;
                    event.preventDefault();
                    insertVideo();
                  }}
                  autoFocus
                />
                <div className="infini-tiptap-video-dialog__actions">
                  <Button type="button" size="sm" onClick={insertVideo}>
                    {labels.embedVideo}
                  </Button>
                </div>
              </div>
            </DialogContent>
          ) : null}
        </Dialog>
      </div>
    );
  }
);
