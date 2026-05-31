import { createContext, useContext } from "react";

const ViewingAsContext = createContext<string>("member");

export const ViewingAsProvider = ViewingAsContext.Provider;

export function useViewingAs(): string {
  return useContext(ViewingAsContext);
}
