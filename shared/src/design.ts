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
  stone: "#c9b8ab",
  sand: "#e4d8ce",
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
  /** An indicator that is off rather than bad: an unpaired sensor, an idle dot. */
  neutral: brandColors.stone,
  /** The unfilled half of a switch, slider or progress rail. */
  track: brandColors.sand,
  /** A faint fill for a control sitting directly on the orange page. */
  surfaceOnPage: "rgba(255, 255, 255, 0.18)",
  shadow: "rgba(23, 17, 12, 0.16)",
  /** Dim behind a sheet or drawer so the layer above reads as the active one. */
  scrim: "rgba(23, 17, 12, 0.45)",
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

/**
 * Tap-target heights.
 *
 * A screen is read by importance, so the size of a control is a statement
 * about it. One action per screen may be `xl`; everything else steps down.
 */
export const controlSize = {
  /** Compact chips, close buttons, status pills. */
  xs: 36,
  /** Icon buttons and segmented controls. */
  sm: 44,
  /** Ordinary buttons and text inputs. */
  md: 52,
  /** Paired primary actions sharing a row. */
  lg: 60,
  /** The one dominant action on a screen. */
  xl: 68,
} as const;

export const borderWidth = {
  thin: 1,
  thick: 2,
} as const;

export const typography = {
  family: '"Open Sans", system-ui, sans-serif',
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
  /**
   * A small control floating over other content.
   *
   * Deliberately tighter than `tile`: these sit inside clipping containers —
   * a map frame with rounded corners, say — where the room available for a
   * shadow is whatever inset the control was given. Its bleed fits a `space.lg`
   * inset on every side.
   */
  control: {
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: {
      width: 0,
      height: 5,
    },
    elevation: 3,
  },
  /** A sheet sits above the page, so its lift points upward. */
  sheet: {
    shadowColor: colors.shadow,
    shadowOpacity: 1,
    shadowRadius: 32,
    shadowOffset: {
      width: 0,
      height: -8,
    },
    elevation: 16,
  },
} as const;

/**
 * How far a shadow spreads past the element casting it, on each side.
 *
 * This exists because a shadow is drawn outside its element's box, and a
 * scrolling container clips to its own bounds. Put a full-width tile in a
 * scroll view whose padding is smaller than this and the soft warm shadow is
 * sliced off flat against the tile's edge — a hard line, on whichever side ran
 * out of room. It is the ugliest thing the app can do and it had to be fixed
 * three times in three places before being written down.
 *
 * So it is computed from the shadow rather than typed out: raising a shadow's
 * radius widens the space reserved for it automatically, and the two cannot
 * drift apart.
 */
function bleedFor(shadow: {
  shadowRadius: number;
  shadowOffset: { height: number };
}) {
  return {
    top: Math.max(0, shadow.shadowRadius - shadow.shadowOffset.height),
    bottom: Math.max(0, shadow.shadowRadius + shadow.shadowOffset.height),
    horizontal: shadow.shadowRadius,
  } as const;
}

export const shadowBleed = {
  tile: bleedFor(shadows.tile),
  control: bleedFor(shadows.control),
  sheet: bleedFor(shadows.sheet),
} as const;

export const layout = {
  maxContentWidth: 1120,
  /**
   * The page's side gutter.
   *
   * Never narrower than a tile's shadow reaches, so a tile laid out against
   * this gutter always has room to cast one.
   */
  screenPadding: Math.max(space.xl, shadowBleed.tile.horizontal),
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
    borderWidth: borderWidth.thin,
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
    borderWidth: borderWidth.thin,
    minHeight: 52,
    paddingHorizontal: space.xl,
  },
} as const;

export const stateStyles = {
  disabled: {
    opacity: 0.5,
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
  controlSize,
  shadowBleed,
  borderWidth,
  typography,
  shadows,
  layout,
  componentStyles,
  stateStyles,
  buttonVariants,
  nestedRadius,
} as const;
