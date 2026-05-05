import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import { colors, space } from "@skate-route-mapper/shared/design";
import { apiBaseUrl } from "../config";
import { adminLayout, controlRadiusPx, px, radiusLevel, surfaceSx } from "../theme/adminTheme";
import type { AdminSession, AdminView } from "../types";

function MetricTile({
  caption,
  detail,
  title,
}: {
  caption: string;
  detail: string;
  title: string;
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        ...surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.md }),
        minHeight: 148,
      }}
    >
      <Stack spacing={1}>
        <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="overline">
          {caption}
        </Typography>
        <Typography sx={{ overflowWrap: "anywhere" }} variant="h3">
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
          {detail}
        </Typography>
      </Stack>
    </Paper>
  );
}

export function DashboardPage({
  onNavigate,
  session,
}: {
  onNavigate: (view: AdminView) => void;
  session: AdminSession;
}) {
  return (
    <Paper elevation={0} sx={surfaceSx({ shadow: true })}>
      <Stack sx={{ gap: px(adminLayout.containerGap) }}>
        <Paper elevation={0} sx={surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.md })}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{
              alignItems: { xs: "stretch", md: "flex-start" },
              justifyContent: "space-between",
            }}
          >
            <Box>
              <Typography variant="h2">Dashboard</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                {session.adminUser.email} is signed in. This home space is ready for operational widgets,
                metrics, and navigation.
              </Typography>
            </Box>
            <Button
              onClick={() => onNavigate("entities")}
              startIcon={<StorageIcon />}
              sx={{ borderRadius: controlRadiusPx(radiusLevel.embedded) }}
              variant="contained"
            >
              Open entities
            </Button>
          </Stack>
        </Paper>

        <Box
          sx={{
            display: "grid",
            gap: px(adminLayout.containerGap),
            gridTemplateColumns: { xs: "1fr", lg: "repeat(3, minmax(0, 1fr))" },
          }}
        >
          <Paper
            component="button"
            elevation={0}
            onClick={() => onNavigate("entities")}
            sx={{
              ...surfaceSx({
                bgcolor: colors.surfaceMuted,
                border: true,
                level: radiusLevel.inner,
                padding: space.md,
              }),
              borderColor: "primary.main",
              cursor: "pointer",
              minHeight: 148,
              textAlign: "left",
            }}
          >
            <Stack spacing={1}>
              <Typography color="text.secondary" sx={{ fontWeight: 900 }} variant="overline">
                Data
              </Typography>
              <Typography variant="h3">Entity management</Typography>
              <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                Generated from Prisma datamodel
              </Typography>
            </Stack>
          </Paper>

          <MetricTile
            caption="Session"
            detail="Expires"
            title={new Date(session.expiresAt).toLocaleString()}
          />
          <MetricTile caption="API" detail="Connected endpoint" title={apiBaseUrl} />

          {/* Later dashboard widgets can live here: ride ingest health, newest ride,
              GPS coverage, sample volume, mobile app versions, and admin activity. */}
        </Box>
      </Stack>
    </Paper>
  );
}
