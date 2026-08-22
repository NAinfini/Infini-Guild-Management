import { afterEach, vi } from "vitest";

/* 这个文件只补 jsdom 的缺口。声明了 `@vitest-environment node` 的用例不碰 DOM，
 * 把 testing-library 整套拉进来是白付一次模块求值——而 setupFiles 是按项目配置的，
 * 逐文件跑，省下的是每个 node 用例一次。 */
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);

  const emptyClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });

  const emptyClientRectList = () => {
    const rects = [emptyClientRect()];
    return Object.assign(rects, {
      item: (index: number) => rects[index] ?? null,
    }) as unknown as DOMRectList;
  };

  if (typeof Element !== "undefined" && !Element.prototype.getClientRects) {
    Object.defineProperty(Element.prototype, "getClientRects", {
      configurable: true,
      value: emptyClientRectList,
    });
  }

  if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: emptyClientRectList,
    });
  }

  if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: emptyClientRect,
    });
  }

  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      writable: true,
      value: vi.fn(),
    });
  }

  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  }

  if (!("IntersectionObserver" in window)) {
    class IntersectionObserverMock {
      readonly root: Element | null = null;
      readonly rootMargin: string = "0px";
      readonly thresholds: ReadonlyArray<number> = [0];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] { return []; }
    }
    Object.defineProperty(window, "IntersectionObserver", {
      writable: true,
      value: IntersectionObserverMock,
    });
  }

  if (!("ResizeObserver" in window)) {
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: ResizeObserverMock,
    });
  }

  /* jsdom 没有实现 FontFaceSet，document.fonts 取出来是 undefined。Mantine 9 的
   * Textarea autosize 无条件调用 document.fonts.addEventListener("loadingdone")
   * （@mantine/core/esm/components/Textarea/Autosize.mjs），于是每个 autosize
   * 文本域一挂载就抛 TypeError。缺的是测试环境而不是产品代码——真实浏览器里
   * FontFaceSet 是标准 API——所以补在这里，与上面几处 jsdom 缺失 API 的补丁同
   * 一性质。jsdom 实装 FontFaceSet 后这整块可以直接删掉。
   *
   * 只补 Autosize 用到的事件通道：不触发 loadingdone，等价于「字体已就绪、
   * 不会再有二次重排」，正是 jsdom 里的真实情况。 */
  if (!document.fonts) {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: Object.assign(new EventTarget(), {
        ready: Promise.resolve(),
        status: "loaded",
        size: 0,
        check: () => true,
        load: () => Promise.resolve([]),
      }),
    });
  }

  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }

  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = vi.fn();
  }
}
