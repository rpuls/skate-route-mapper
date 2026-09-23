// Preview wrapper for claude.ai/design. Mirrors admin/src/main.tsx so cards
// render in the real brand theme. Kept out of admin/src so the sync adds no
// app source. Update this if main.tsx gains a provider.
import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { adminTheme } from "../admin/src/theme/adminTheme";

const previewQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
    },
  },
});

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={previewQueryClient}>
      <ThemeProvider theme={adminTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
