import { Node, mergeAttributes, type CommandProps } from "@tiptap/core";

export interface BilibiliOptions {
  HTMLAttributes: Record<string, string>;
  width: number;
  height: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bilibili: {
      setBilibiliVideo: (options: { src: string; width?: number; height?: number }) => ReturnType;
    };
  }
}

const BILIBILI_REGEX = /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[\w]+)/;
const BILIBILI_REGEX_GLOBAL = /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(BV[\w]+)/g;

function getBilibiliEmbedUrl(bvid: string): string {
  return `https://player.bilibili.com/player.html?bvid=${bvid}&high_quality=1`;
}

export function isValidBilibiliUrl(url: string): boolean {
  return BILIBILI_REGEX.test(url);
}

export const Bilibili = Node.create<BilibiliOptions>({
  name: "bilibili",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return { HTMLAttributes: {}, width: 640, height: 480 };
  },

  addAttributes() {
    return {
      src: { default: null },
      width: { default: this.options.width },
      height: { default: this.options.height },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-bilibili-video]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      { "data-bilibili-video": "", style: "position:relative;padding-bottom:56.25%;height:0;overflow:hidden;" },
      [
        "iframe",
        mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
          style: "position:absolute;top:0;left:0;width:100%;height:100%;border:0;",
          allowfullscreen: "true",
          sandbox: "allow-scripts allow-same-origin allow-popups",
        }),
      ],
    ];
  },

  addCommands() {
    return {
      setBilibiliVideo:
        (options: { src: string; width?: number; height?: number }) =>
        ({ commands }: CommandProps) => {
          const match = options.src.match(BILIBILI_REGEX);
          if (!match?.[1]) return false;
          return commands.insertContent({
            type: this.name,
            attrs: {
              src: getBilibiliEmbedUrl(match[1]),
              width: options.width ?? this.options.width,
              height: options.height ?? this.options.height,
            },
          });
        },
    };
  },

  addPasteRules() {
    return [
      {
        find: BILIBILI_REGEX_GLOBAL,
        handler: ({ match, chain }) => {
          const bvid = match[1];
          if (!bvid) return;
          chain().insertContent({
            type: this.name,
            attrs: { src: getBilibiliEmbedUrl(bvid) },
          }).run();
        },
      },
    ];
  },
});
