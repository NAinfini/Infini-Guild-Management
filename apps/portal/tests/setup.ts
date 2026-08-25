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

  if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
    Object.defineProperty(Element.prototype, "getAnimations", {
      configurable: true,
      value: () => [],
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


  if (!window.URL.createObjectURL) {
    window.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  }

  if (!window.URL.revokeObjectURL) {
    window.URL.revokeObjectURL = vi.fn();
  }
}
