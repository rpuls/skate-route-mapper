// IMPORTANT! Always refer to: docs\design-guide.md before making changes in this file. Single source of truth design values are defined in shared/src/design.ts. This file should only contain theme configuration and helper functions related to the admin theme.
import { createTheme } from "@mui/material/styles";
import type { PaletteColor, PaletteColorOptions } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";
import {
  borderWidth,
  buttonVariants,
  colors,
  componentStyles,
  layout,
  radius,
  shadows,
  space,
  typography,
} from "@skate-route-mapper/shared/design";

export const radiusLevel = {
  outer: 0,
  inner: 1,
  embedded: 2,
  utility: 3,
} as const;

export type RadiusLevel = (typeof radiusLevel)[keyof typeof radiusLevel];

export function px(value: number) {
  return `${value}px`;
}

export function radiusForLevel(level: RadiusLevel = radiusLevel.outer) {
  return Math.max(radius.xs, radius.xl - layout.nestedInset * level);
}

export function radiusPx(level: RadiusLevel = radiusLevel.outer) {
  return px(radiusForLevel(level));
}

export function controlRadiusPx(level: RadiusLevel = radiusLevel.inner) {
  return radiusPx(level);
}

export function tileShadow() {
  return `${shadows.tile.shadowOffset.width}px ${shadows.tile.shadowOffset.height}px ${shadows.tile.shadowRadius}px ${colors.shadow}`;
}

export function surfaceSx({
  bgcolor = "background.paper",
  border = false,
  level = radiusLevel.outer,
  padding = space.lg,
  shadow = false,
}: {
  bgcolor?: string;
  border?: boolean;
  level?: RadiusLevel;
  padding?: number;
  shadow?: boolean;
} = {}): SystemStyleObject {
  return {
    bgcolor,
    border: border ? `${borderWidth.thin}px solid` : 0,
    borderColor: border ? "divider" : "transparent",
    borderRadius: radiusPx(level),
    boxShadow: shadow ? tileShadow() : "none",
    p: px(padding),
  };
}

export const adminLayout = {
  containerGap: layout.tilePadding,
  drawerWidth: 264,
  maxContentWidth: layout.maxContentWidth,
  nestedInset: layout.nestedInset,
  screenPadding: layout.screenPadding,
  tilePadding: layout.tilePadding,
} as const;

declare module "@mui/material/styles" {
  interface Palette {
    onPrimary: PaletteColor;
  }
  interface PaletteOptions {
    onPrimary?: PaletteColorOptions;
  }
}

declare module "@mui/material/Button" {
  interface ButtonPropsColorOverrides {
    onPrimary: true;
  }
}

export const adminTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: colors.accent,
      dark: colors.accentStrong,
      contrastText: colors.textOnOrange,
    },
    onPrimary: {
      main: colors.textOnOrange,
      dark: "rgba(255, 255, 255, 0.78)",
      contrastText: colors.accent,
    },
    secondary: {
      main: colors.link,
    },
    error: {
      main: colors.danger,
    },
    success: {
      main: colors.success,
    },
    background: {
      default: colors.page,
      paper: colors.surface,
    },
    divider: colors.border,
    text: {
      primary: colors.text,
      secondary: colors.textMuted,
    },
  },
  shape: {
    borderRadius: radius.lg,
  },
  spacing: space.sm,
  typography: {
    fontFamily: typography.family,
    h1: {
      fontSize: typography.sizes.title,
      fontWeight: Number(typography.weights.heavy),
      lineHeight: typography.lineHeights.tight,
    },
    h2: {
      fontSize: typography.sizes.title,
      fontWeight: Number(typography.weights.heavy),
      lineHeight: typography.lineHeights.tight,
    },
    h3: {
      fontSize: typography.sizes.lead,
      fontWeight: Number(typography.weights.heavy),
      lineHeight: typography.lineHeights.normal,
    },
    body1: {
      fontWeight: Number(typography.weights.medium),
    },
    body2: {
      fontWeight: Number(typography.weights.medium),
    },
    caption: {
      fontWeight: Number(typography.weights.medium),
    },
    button: {
      fontWeight: Number(typography.weights.bold),
      textTransform: "none",
    },
    overline: {
      fontWeight: Number(typography.weights.bold),
      letterSpacing: "0.04em",
      fontSize: typography.sizes.caption,
    },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: `
        @import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800;900&display=swap");

        :root {
          font-family: ${typography.family};
          color: ${colors.text};
          background: ${colors.page};
        }

        * {
          box-sizing: border-box;
        }

        html {
          min-width: 320px;
          min-height: 100%;
        }

        body {
          margin: 0;
          min-width: 320px;
          min-height: 100vh;
          background: ${colors.page};
        }

        #root {
          min-height: 100vh;
        }
      `,
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: controlRadiusPx(),
          minHeight: componentStyles.primaryButton.minHeight,
          boxShadow: "none",
          fontWeight: Number(typography.weights.bold),
          paddingLeft: space.xl,
          paddingRight: space.xl,
          "&:hover": {
            boxShadow: "none",
          },
          "&.MuiButton-containedPrimary": {
            backgroundColor: buttonVariants.secondary.filled.backgroundColor,
            color: buttonVariants.secondary.filled.color,
            "&:hover": {
              backgroundColor: colors.accentStrong,
            },
          },
        },
        outlined: {
          border: `${borderWidth.thick}px solid currentColor`,
          "&:hover": {
            border: `${borderWidth.thick}px solid currentColor`,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: radiusPx(radiusLevel.outer),
          boxShadow: tileShadow(),
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
        rounded: {
          borderRadius: radiusPx(radiusLevel.outer),
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: radiusPx(radiusLevel.outer),
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: typography.sizes.lead,
          fontWeight: Number(typography.weights.heavy),
          padding: `${space.lg}px ${space.lg}px ${space.sm}px`,
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: `${space.sm}px ${space.lg}px ${space.lg}px`,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: controlRadiusPx(),
          minHeight: componentStyles.primaryButton.minHeight,
          backgroundColor: colors.surface,
          "& .MuiOutlinedInput-notchedOutline": {
            borderWidth: borderWidth.thin,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderWidth: borderWidth.thick,
          },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        input: {
          fontWeight: Number(typography.weights.medium),
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        size: "small",
      },
    },
    MuiSelect: {
      defaultProps: {
        size: "small",
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          borderRadius: controlRadiusPx(radiusLevel.embedded),
          fontWeight: Number(typography.weights.heavy),
          minHeight: componentStyles.primaryButton.minHeight,
          textTransform: "none",
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: radiusPx(radiusLevel.embedded),
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: radiusPx(radiusLevel.inner),
          fontWeight: Number(typography.weights.bold),
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          "&.Mui-checked": {
            color: colors.accent,
          },
          "&.Mui-checked + .MuiSwitch-track": {
            backgroundColor: colors.accent,
          },
        },
      },
    },
  },
});
