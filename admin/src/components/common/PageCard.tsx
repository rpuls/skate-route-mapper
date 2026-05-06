import { Paper } from "@mui/material";
import type { ReactNode } from "react";
import { surfaceSx } from "../../theme/adminTheme";

export function PageCard({ children }: { children: ReactNode }) {
  return (
    <Paper
      elevation={0}
      sx={surfaceSx({ border: true, shadow: true })}
    >
      {children}
    </Paper>
  );
}
