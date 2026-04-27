import { useState } from "react";

export type SortDir = "asc" | "desc" | null;

export interface SortState<Col extends string> {
  col: Col | null;
  dir: SortDir;
}

/**
 * Three-state column sort: null → asc → desc → null.
 * Clicking a different column resets to asc for that column.
 */
export function useTableSort<Col extends string>() {
  const [sort, setSort] = useState<SortState<Col>>({ col: null, dir: null });

  function toggle(col: Col) {
    setSort((prev) => {
      if (prev.col !== col)    return { col, dir: "asc" };
      if (prev.dir === "asc")  return { col, dir: "desc" };
      return { col: null, dir: null };
    });
  }

  return { sort, toggle };
}
