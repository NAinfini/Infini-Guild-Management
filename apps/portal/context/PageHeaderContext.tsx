import { createContext, useContext, useEffect, useRef, type Dispatch, type ReactNode, type SetStateAction } from "react";

type PageHeaderContextValue = {
  setActions: Dispatch<SetStateAction<ReactNode>>;
};

const noopSetActions: Dispatch<SetStateAction<ReactNode>> = () => {
  // no-op default for pages rendered outside AppShell provider
};

export const PageHeaderContext = createContext<PageHeaderContextValue>({
  setActions: noopSetActions,
});

export function usePageHeaderActions(actions: ReactNode) {
  const { setActions } = useContext(PageHeaderContext);
  const actionsRef = useRef<ReactNode>(actions);
  actionsRef.current = actions;

  useEffect(() => {
    setActions(actionsRef.current ?? null);
    return () => {
      setActions(null);
    };
  }, [setActions]);
}
