import type { Editor } from "@tiptap/react";
import type { TipTapEditorLabels } from "./tiptap-meta";

type Heading = { level: number; text: string; pos: number };

function extractHeadings(editor: Editor): Heading[] {
  const headings: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headings.push({ level: node.attrs.level as number, text: node.textContent, pos });
    }
  });
  return headings;
}

type TipTapEditorTocProps = {
  editor: Editor;
  labels: TipTapEditorLabels;
};

export function TipTapEditorToc({ editor, labels }: TipTapEditorTocProps) {
  const headings = extractHeadings(editor);

  if (headings.length === 0) return null;

  return (
    <nav className="infini-tiptap-toc" aria-label={labels.tableOfContents}>
      <div className="infini-tiptap-toc__title">{labels.tableOfContents}</div>
      <ul className="infini-tiptap-toc__list">
        {headings.map((h, i) => (
          <li key={i} className="infini-tiptap-toc__item" style={{ paddingLeft: `${(h.level - 1) * 12}px` }}>
            <button
              type="button"
              className="infini-tiptap-toc__link"
              onClick={() => {
                editor.chain().focus().setTextSelection(h.pos + 1).run();
                const domNode = editor.view.domAtPos(h.pos + 1)?.node;
                if (domNode instanceof HTMLElement) {
                  domNode.scrollIntoView({ behavior: "smooth", block: "center" });
                } else if (domNode?.parentElement) {
                  domNode.parentElement.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
            >
              {h.text || `${labels.h1.replace(/\d/, String(h.level))}`}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
