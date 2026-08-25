import { useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";

export function useDebouncedSearch(delay = 300) {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, delay);

  return { search, setSearch, debouncedSearch } as const;
}
