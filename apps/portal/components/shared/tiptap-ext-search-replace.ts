import { Extension, type CommandProps } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

export interface SearchReplaceOptions {
  searchClass: string;
  activeClass: string;
}

export interface SearchReplaceStorage {
  searchTerm: string;
  replaceTerm: string;
  results: { from: number; to: number }[];
  activeIndex: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchReplace: {
      setSearchTerm: (term: string) => ReturnType;
      setReplaceTerm: (term: string) => ReturnType;
      nextSearchResult: () => ReturnType;
      prevSearchResult: () => ReturnType;
      replaceCurrent: () => ReturnType;
      replaceAll: () => ReturnType;
      clearSearch: () => ReturnType;
    };
  }
  interface Storage {
    searchReplace: SearchReplaceStorage;
  }
}

const searchPluginKey = new PluginKey("search-replace");

function findMatches(doc: PmNode, term: string): { from: number; to: number }[] {
  if (!term) return [];
  const results: { from: number; to: number }[] = [];
  const text = doc.textBetween(0, doc.content.size);
  const lower = term.toLowerCase();
  let pos = 0;
  while (pos < text.length) {
    const idx = text.toLowerCase().indexOf(lower, pos);
    if (idx === -1) break;
    results.push({ from: idx + 1, to: idx + 1 + term.length });
    pos = idx + 1;
  }
  return results;
}

export const SearchReplace = Extension.create<SearchReplaceOptions, SearchReplaceStorage>({
  name: "searchReplace",

  addOptions() {
    return { searchClass: "infini-tiptap-search-match", activeClass: "infini-tiptap-search-active" };
  },

  addStorage() {
    return { searchTerm: "", replaceTerm: "", results: [], activeIndex: 0 };
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string) =>
        ({ editor }: CommandProps) => {
          editor.storage.searchReplace.searchTerm = term;
          editor.storage.searchReplace.results = findMatches(editor.state.doc, term);
          editor.storage.searchReplace.activeIndex = 0;
          editor.view.dispatch(editor.state.tr);
          return true;
        },
      setReplaceTerm:
        (term: string) =>
        ({ editor }: CommandProps) => {
          editor.storage.searchReplace.replaceTerm = term;
          return true;
        },
      nextSearchResult:
        () =>
        ({ editor }: CommandProps) => {
          const store = editor.storage.searchReplace as SearchReplaceStorage;
          if (store.results.length === 0) return false;
          store.activeIndex = (store.activeIndex + 1) % store.results.length;
          const match = store.results[store.activeIndex];
          if (match) editor.commands.setTextSelection(match);
          editor.view.dispatch(editor.state.tr);
          return true;
        },
      prevSearchResult:
        () =>
        ({ editor }: CommandProps) => {
          const store = editor.storage.searchReplace as SearchReplaceStorage;
          if (store.results.length === 0) return false;
          store.activeIndex = (store.activeIndex - 1 + store.results.length) % store.results.length;
          const match = store.results[store.activeIndex];
          if (match) editor.commands.setTextSelection(match);
          editor.view.dispatch(editor.state.tr);
          return true;
        },
      replaceCurrent:
        () =>
        ({ editor }: CommandProps) => {
          const store = editor.storage.searchReplace as SearchReplaceStorage;
          const match = store.results[store.activeIndex];
          if (!match) return false;
          editor.chain().focus().insertContentAt(match, store.replaceTerm).run();
          store.results = findMatches(editor.state.doc, store.searchTerm);
          if (store.activeIndex >= store.results.length) store.activeIndex = 0;
          editor.view.dispatch(editor.state.tr);
          return true;
        },
      replaceAll:
        () =>
        ({ editor }: CommandProps) => {
          const store = editor.storage.searchReplace as SearchReplaceStorage;
          if (store.results.length === 0) return false;
          const reversed = [...store.results].reverse();
          for (const match of reversed) {
            editor.chain().insertContentAt(match, store.replaceTerm).run();
          }
          store.results = [];
          store.activeIndex = 0;
          editor.view.dispatch(editor.state.tr);
          return true;
        },
      clearSearch:
        () =>
        ({ editor }: CommandProps) => {
          editor.storage.searchReplace.searchTerm = "";
          editor.storage.searchReplace.replaceTerm = "";
          editor.storage.searchReplace.results = [];
          editor.storage.searchReplace.activeIndex = 0;
          editor.view.dispatch(editor.state.tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;
    return [
      new Plugin({
        key: searchPluginKey,
        props: {
          decorations: (state) => {
            const store = extensionThis.storage;
            if (!store.searchTerm || store.results.length === 0) return DecorationSet.empty;
            const decorations = store.results.map((r: { from: number; to: number }, i: number) =>
              Decoration.inline(r.from, r.to, {
                class: i === store.activeIndex ? `${extensionThis.options.searchClass} ${extensionThis.options.activeClass}` : extensionThis.options.searchClass,
              }),
            );
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-f": () => true,
    };
  },
});
