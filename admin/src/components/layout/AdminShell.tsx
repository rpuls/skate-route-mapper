import DashboardIcon from "@mui/icons-material/Dashboard";
import StorageIcon from "@mui/icons-material/Storage";
import LogoutIcon from "@mui/icons-material/Logout";
import {
  Box,
  Button,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  Stack,
  Toolbar,
  Typography,
} from "@mui/material";
import { space } from "@skate-route-mapper/shared/design";
import type { ReactNode } from "react";
import { adminLayout, controlRadiusPx, px, radiusLevel } from "../../theme/adminTheme";
import type { AdminView, AdminSession } from "../../types";

const drawerWidth = adminLayout.drawerWidth;

type NavItem = {
  icon: ReactNode;
  label: string;
  view: AdminView;
};

const navItems: NavItem[] = [
  {
    icon: <DashboardIcon />,
    label: "Dashboard",
    view: "dashboard",
  },
  {
    icon: <StorageIcon />,
    label: "Entities",
    view: "entities",
  },
];

export function AdminShell({
  activeView,
  children,
  onLogout,
  onNavigate,
  session,
  title,
}: {
  activeView: AdminView;
  children: ReactNode;
  onLogout: () => void;
  onNavigate: (view: AdminView) => void;
  session: AdminSession;
  title: string;
}) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: "none", md: "block" },
          width: drawerWidth,
          "& .MuiDrawer-paper": {
            width: drawerWidth,
            border: 0,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            p: px(space.xl),
          },
        }}
      >
        <Toolbar disableGutters sx={{ alignItems: "flex-start", flexDirection: "column", mb: px(space.xl) }}>
          <Typography variant="overline">
            Skate Route Mapper
          </Typography>
          <Typography component="strong" variant="h1">
            Admin
          </Typography>
        </Toolbar>

        <List disablePadding sx={{ display: "grid", gap: 1 }}>
          {navItems.map((item) => (
            <ListItemButton
              key={item.view}
              onClick={() => onNavigate(item.view)}
              selected={activeView === item.view}
              sx={{
                borderRadius: controlRadiusPx(radiusLevel.inner),
                color: "primary.contrastText",
                "&.Mui-selected, &.Mui-selected:hover": {
                  bgcolor: "background.paper",
                  color: "primary.main",
                },
                "&:hover": {
                  bgcolor: "rgba(255, 255, 255, 0.14)",
                },
              }}
            >
              <ListItemIcon sx={{ color: "inherit", minWidth: 38 }}>{item.icon}</ListItemIcon>
              <Typography sx={{ fontWeight: 800 }}>{item.label}</Typography>
            </ListItemButton>
          ))}
        </List>
      </Drawer>

      <Box sx={{ ml: { md: `${drawerWidth}px` }, minWidth: 0, p: px(space.xl) }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "stretch", md: "center" },
            color: "primary.contrastText",
            justifyContent: "space-between",
            mb: px(space.lg),
          }}
        >
          <Box>
            <Typography variant="overline">
              Admin Dashboard
            </Typography>
            <Typography variant="h1">{title}</Typography>
          </Box>

          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            sx={{ alignItems: { xs: "stretch", md: "center" } }}
          >
            <Typography sx={{ overflowWrap: "anywhere" }} variant="body2">
              {session.adminUser.email}
            </Typography>
            <Button color="onPrimary" onClick={onLogout} startIcon={<LogoutIcon />} variant="outlined">
              Sign out
            </Button>
          </Stack>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{ display: { xs: "flex", md: "none" }, mb: px(space.sm) }}
        >
          {navItems.map((item) => (
            <Button
              fullWidth
              color="onPrimary"
              key={item.view}
              onClick={() => onNavigate(item.view)}
              startIcon={item.icon}
              variant={activeView === item.view ? "contained" : "outlined"}
            >
              {item.label}
            </Button>
          ))}
        </Stack>

        {children}
      </Box>
    </Box>
  );
}
