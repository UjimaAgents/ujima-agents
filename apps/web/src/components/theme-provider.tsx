"use client";

// next-themes >= 0.3 ships its types from the package root; the legacy
// `next-themes/dist/types` subpath was removed and breaks `next build`.
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
