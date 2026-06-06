import { useState } from "react";
import { useDebouncedValue } from "@mantine/hooks";

export function useDebouncedSearch(delay = 300) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, delay);
  return { search, setSearch, debouncedSearch: debounced } as const;
}
