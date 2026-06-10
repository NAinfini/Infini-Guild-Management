/**
 * Lightweight constants and helpers for the TipTap editor that can be imported
 * by non-editor code (e.g. hooks, controllers) without pulling the full
 * TipTap / ProseMirror / lowlight bundle into the importing chunk.
 *
 * No TipTap imports are allowed in this file.
 */

const DEFAULT_DOC_JSON = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph" }],
});

export const TIPTAP_DEFAULT_JSON = DEFAULT_DOC_JSON;

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
  delCol: string;
  delRow: string;
  delTable: string;
  image: string;
  textColor: string;
  customTextColor: string;
  highlight: string;
  customHighlightColor: string;
  clearFormatting: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  divider: string;
  taskList: string;
  undo: string;
  redo: string;
  moreFormatting: string;
  moreInsert: string;
  close: string;
  slashCommands: string;
  linkPrompt: string;
  imageInserted: string;
  imageUploadFailed: string;
  uploading: string;
  youtube: string;
  bilibili: string;
  videoUrl: string;
  embedVideo: string;
  details: string;
  findReplace: string;
  findPlaceholder: string;
  replacePlaceholder: string;
  findNext: string;
  findPrev: string;
  replaceOne: string;
  replaceAllLabel: string;
  tableOfContents: string;
  words: string;
  characters: string;
};

export function buildTipTapEditorLabels(t: (key: string) => string): TipTapEditorLabels {
  return {
    bold: t("toolbar.bold"),
    italic: t("toolbar.italic"),
    underline: t("toolbar.underline"),
    strike: t("toolbar.strike"),
    link: t("toolbar.link"),
    unlink: t("toolbar.unlink"),
    h1: t("toolbar.h1"),
    h2: t("toolbar.h2"),
    h3: t("toolbar.h3"),
    bullet: t("toolbar.bullet"),
    number: t("toolbar.number"),
    quote: t("toolbar.quote"),
    code: t("toolbar.code"),
    table: t("toolbar.table"),
    addCol: t("toolbar.addCol"),
    addRow: t("toolbar.addRow"),
    delCol: t("toolbar.delCol"),
    delRow: t("toolbar.delRow"),
    delTable: t("toolbar.delTable"),
    image: t("toolbar.image"),
    textColor: t("toolbar.textColor"),
    customTextColor: t("toolbar.customTextColor"),
    highlight: t("toolbar.highlight"),
    customHighlightColor: t("toolbar.customHighlightColor"),
    clearFormatting: t("toolbar.clearFormatting"),
    alignLeft: t("toolbar.alignLeft"),
    alignCenter: t("toolbar.alignCenter"),
    alignRight: t("toolbar.alignRight"),
    divider: t("toolbar.divider"),
    taskList: t("toolbar.taskList"),
    undo: t("toolbar.undo"),
    redo: t("toolbar.redo"),
    moreFormatting: t("toolbar.moreFormatting"),
    moreInsert: t("toolbar.moreInsert"),
    close: t("toolbar.close"),
    slashCommands: t("slashCommands"),
    linkPrompt: t("toolbar.linkPrompt"),
    imageInserted: t("message.imageInserted"),
    imageUploadFailed: t("message.imageUploadFailed"),
    uploading: t("upload.uploading"),
    youtube: t("toolbar.youtube"),
    bilibili: t("toolbar.bilibili"),
    videoUrl: t("toolbar.videoUrl"),
    embedVideo: t("toolbar.embedVideo"),
    details: t("toolbar.details"),
    findReplace: t("toolbar.findReplace"),
    findPlaceholder: t("toolbar.findPlaceholder"),
    replacePlaceholder: t("toolbar.replacePlaceholder"),
    findNext: t("toolbar.findNext"),
    findPrev: t("toolbar.findPrev"),
    replaceOne: t("toolbar.replaceOne"),
    replaceAllLabel: t("toolbar.replaceAllLabel"),
    tableOfContents: t("toolbar.tableOfContents"),
    words: t("toolbar.words"),
    characters: t("toolbar.characters"),
  };
}
