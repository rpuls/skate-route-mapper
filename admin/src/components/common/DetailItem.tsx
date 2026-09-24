import { Box, Typography } from "@mui/material";

/** A labelled read-only figure, the unit the admin detail grids are built from. */
export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="caption">
        {label}
      </Typography>
      <Typography sx={{ fontWeight: 800, overflowWrap: "anywhere" }}>{value}</Typography>
    </Box>
  );
}
