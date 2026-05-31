/// <reference lib="webworker" />
import { findBestBuild } from "@guild/shared/calculator/best-build";

const abortFlag = { aborted: false };

self.onmessage = (e: MessageEvent) => {
  const { type, config } = e.data;

  if (type === "cancel") {
    abortFlag.aborted = true;
    return;
  }

  if (type === "search") {
    abortFlag.aborted = false;
    try {
      const results = findBestBuild({
        ...config,
        maxCandidatesPerSlot: config.maxCandidatesPerSlot ?? 100,
        signal: abortFlag,
        onProgress: (pct: number) => self.postMessage({ type: "progress", percent: pct }),
      });
      self.postMessage({ type: "result", results });
    } catch (err) {
      self.postMessage({ type: "error", message: String(err) });
    }
  }
};
