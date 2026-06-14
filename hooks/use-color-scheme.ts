import type { ColorSchemeName } from "react-native";

import { useAppColorScheme } from "@/components/providers/app-theme-provider";

export function useColorScheme(): ColorSchemeName {
  return useAppColorScheme();
}
