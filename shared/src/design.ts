export const brandColors = {
  orange: "#ff6a00",
  orangeDeep: "#c84d00",
  orangeSoft: "#ff8a2a",
  orangePale: "#fff0e3",
  bluePale: "#eaf4ff",
  white: "#ffffff",
  black: "#17110c",
  charcoal: "#25211d",
  brown: "#735b4a",
  tan: "#f2d6c2",
  cream: "#fff8f2",
  blue: "#1677ff",
  green: "#19a974",
  red: "#e5484d",
} as const;

export const colors = {
  page: brandColors.orange,
  pageSoft: brandColors.orangeSoft,
  surface: brandColors.white,
  surfaceMuted: brandColors.bluePale,
  surfaceWarm: brandColors.orangePale,
  text: brandColors.black,
  textMuted: brandColors.brown,
  textOnOrange: brandColors.white,
  border: brandColors.tan,
  accent: brandColors.orange,
  accentStrong: brandColors.orangeDeep,
  link: brandColors.blue,
  success: brandColors.green,
  danger: brandColors.red,
  shadow: "rgba(23, 17, 12, 0.16)",
} as const;

export const space = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  xs: 8,
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  xxl: 40,
  pill: 999,
} as const;

export const typography = {
  family: "\"Open Sans\", system-ui, sans-serif",
  sizes: {
    caption: 12,
    small: 14,
    body: 16,
    lead: 18,
    title: 28,
    display: 36,
  },
  lineHeights: {
    tight: 1.1,
    normal: 1.45,
    relaxed: 1.6,
  },
  weights: {
    regular: "400",
    medium: "600",
    bold: "800",
    heavy: "900",
  },
} as const;

export const shadows = {
  tile: {
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
    shadowOffset: {
      width: 0,
      height: 14,
    },
    elevation: 6,
  },
} as const;

export const layout = {
  maxContentWidth: 1120,
  screenPadding: space.xl,
  tilePadding: space.lg,
  nestedInset: space.sm,
} as const;

export const componentStyles = {
  screen: {
    backgroundColor: colors.page,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space.lg,
  },
  tileInner: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: space.md,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    minHeight: 52,
    paddingHorizontal: space.xl,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceWarm,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 52,
    paddingHorizontal: space.xl,
  },
} as const;

export const buttonVariants = {
  primary: {
    filled: {
      backgroundColor: colors.surface,
      borderColor: colors.surface,
      color: colors.accent,
    },
    contained: {
      backgroundColor: colors.surfaceWarm,
      borderColor: colors.accent,
      color: colors.accent,
    },
    text: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      color: colors.accent,
    },
  },
  secondary: {
    filled: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      color: colors.textOnOrange,
    },
    contained: {
      backgroundColor: "transparent",
      borderColor: "rgba(255, 255, 255, 0.82)",
      color: colors.textOnOrange,
    },
    text: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      color: colors.textOnOrange,
    },
  },
  danger: {
    filled: {
      backgroundColor: colors.danger,
      borderColor: colors.danger,
      color: colors.textOnOrange,
    },
    contained: {
      backgroundColor: "transparent",
      borderColor: colors.danger,
      color: colors.danger,
    },
    text: {
      backgroundColor: "transparent",
      borderColor: "transparent",
      color: colors.danger,
    },
  },
} as const;

export const nestedRadius = {
  outerRadius: radius.xl,
  inset: space.sm,
  innerRadius: radius.lg,
} as const;

export const skateDesign = {
  brandColors,
  colors,
  space,
  radius,
  typography,
  shadows,
  layout,
  componentStyles,
  buttonVariants,
  nestedRadius,
} as const;
