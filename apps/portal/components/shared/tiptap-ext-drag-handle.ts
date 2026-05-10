import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

const DRAG_HANDLE_CLASS = "infini-tiptap-drag-handle";

function createDragHandle(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = DRAG_HANDLE_CLASS;
  btn.contentEditable = "false";
  btn.draggable = true;
  btn.innerHTML = "⠿";
  btn.setAttribute("aria-label", "Drag to reorder");
  return btn;
}

export const DragHandle = Extension.create({
  name: "dragHandle",

  addProseMirrorPlugins() {
    let handle: HTMLButtonElement | null = null;
    let activePos: number | null = null;

    return [
      new Plugin({
        key: new PluginKey("drag-handle"),
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable) return false;
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (!pos) {
                handle?.remove();
                handle = null;
                activePos = null;
                return false;
              }

              const resolved = view.state.doc.resolve(pos.pos);
              const topLevelPos = resolved.before(1);
              if (topLevelPos === activePos) return false;

              activePos = topLevelPos;
              const domNode = view.nodeDOM(topLevelPos);
              if (!domNode || !(domNode instanceof HTMLElement)) {
                handle?.remove();
                handle = null;
                return false;
              }

              if (!handle) {
                handle = createDragHandle();

                handle.addEventListener("dragstart", (e) => {
                  if (activePos == null) return;
                  const node = view.state.doc.nodeAt(activePos);
                  if (!node) return;
                  const slice = view.state.doc.slice(activePos, activePos + node.nodeSize);
                  view.dragging = { slice, move: true };
                  e.dataTransfer?.setData("text/plain", "");
                });
              }

              const editorRect = view.dom.getBoundingClientRect();
              const nodeRect = domNode.getBoundingClientRect();

              handle.style.top = `${nodeRect.top - editorRect.top + view.dom.offsetTop}px`;
              handle.style.left = `${-24}px`;

              if (handle.parentElement !== view.dom.parentElement) {
                const wrapper = view.dom.parentElement;
                if (wrapper) {
                  wrapper.style.position = "relative";
                  wrapper.appendChild(handle);
                }
              }
              return false;
            },
            mouseleave: () => {
              setTimeout(() => {
                if (!handle?.matches(":hover")) {
                  handle?.remove();
                  handle = null;
                  activePos = null;
                }
              }, 100);
              return false;
            },
          },
        },
        view() {
          return {
            destroy() {
              handle?.remove();
              handle = null;
            },
          };
        },
      }),
    ];
  },
});
