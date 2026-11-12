"use client";

import { createContext, type ReactNode, useContext } from "react";
import { type CategoryHints, NO_CATEGORY_HINTS } from "@/shared/suggestions/category-hints";

const CategoryHintsContext = createContext<CategoryHints>(NO_CATEGORY_HINTS);

/** Makes the category hints (built from the history in the layout) available to the transaction form. */
export function CategoryHintsProvider({ value, children }: { value: CategoryHints; children: ReactNode }) {
  return <CategoryHintsContext.Provider value={value}>{children}</CategoryHintsContext.Provider>;
}

/** How past descriptions were categorised — empty outside the provider (no suggestion). */
export function useCategoryHints(): CategoryHints {
  return useContext(CategoryHintsContext);
}
