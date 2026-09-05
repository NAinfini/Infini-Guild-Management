import { useAuthStore } from "../stores/auth";
import { useExternalView } from "./useExternalView";

export function useRetainedQueryData() {
  const viewer = useAuthStore((state) => state.user);
  const externalView = useExternalView();
  return {
    meta: { retainedViewer: viewer, retainedExternalView: externalView },
    // A filter change can retain results; a session or viewing-mode change cannot.
    placeholderData: <T>(data: T | undefined, previous?: { meta?: Record<string, unknown> }): T | undefined => (
      previous?.meta?.retainedViewer === viewer
      && previous?.meta?.retainedExternalView === externalView ? data : undefined
    ),
  };
}
