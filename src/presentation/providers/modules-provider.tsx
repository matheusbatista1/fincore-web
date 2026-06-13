"use client";

import { createContext, type ReactNode, useContext } from "react";
import { isModuleEnabled, type ModuleKey } from "@/shared/modules";

const ModulesContext = createContext<readonly ModuleKey[]>([]);

/** Makes the user's enabled optional modules available to any client component in the shell. */
export function ModulesProvider({ value, children }: { value: readonly ModuleKey[]; children: ReactNode }) {
  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

/** The user's enabled optional modules. */
export function useModules(): readonly ModuleKey[] {
  return useContext(ModulesContext);
}

/** Whether a single optional module is enabled. */
export function useModuleEnabled(key: ModuleKey): boolean {
  return isModuleEnabled(useContext(ModulesContext), key);
}
