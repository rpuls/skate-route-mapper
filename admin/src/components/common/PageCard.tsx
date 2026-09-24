import { Paper } from "@mui/material";
import type { ReactNode } from "react";
import { px, surfaceSx } from "../../theme/adminTheme";

export function PageCard({
  children,
  padding,
}: {
  children: ReactNode;
  /** Overrides the card's inset, for a card that is only a strip of controls. */
  padding?: number;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        ...surfaceSx({ shadow: true }),
        ...(padding === undefined ? {} : { p: px(padding) }),
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        width: "100%",
      }}
    >
      {children}
    </Paper>
  );
}
