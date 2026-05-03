import {
  buttonVariants,
  componentStyles,
  colors,
  layout,
  radius,
  shadows,
  space,
  typography,
} from "@skate-route-mapper/shared/design";

function px(value: number) {
  return `${value}px`;
}

function kebabCase(value: string) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function applyDesignTokens() {
  const root = document.documentElement;

  root.style.setProperty("--font-family", typography.family);
  root.style.setProperty("--font-size-caption", px(typography.sizes.caption));
  root.style.setProperty("--font-size-small", px(typography.sizes.small));
  root.style.setProperty("--font-size-body", px(typography.sizes.body));
  root.style.setProperty("--font-size-lead", px(typography.sizes.lead));
  root.style.setProperty("--font-size-title", px(typography.sizes.title));
  root.style.setProperty("--font-size-display", px(typography.sizes.display));
  root.style.setProperty("--line-height-tight", String(typography.lineHeights.tight));
  root.style.setProperty("--line-height-normal", String(typography.lineHeights.normal));
  root.style.setProperty("--line-height-relaxed", String(typography.lineHeights.relaxed));
  root.style.setProperty("--font-weight-regular", typography.weights.regular);
  root.style.setProperty("--font-weight-medium", typography.weights.medium);
  root.style.setProperty("--font-weight-bold", typography.weights.bold);
  root.style.setProperty("--font-weight-heavy", typography.weights.heavy);

  for (const [name, value] of Object.entries(colors)) {
    root.style.setProperty(`--color-${kebabCase(name)}`, value);
  }

  for (const [name, value] of Object.entries(space)) {
    root.style.setProperty(`--space-${name}`, px(value));
  }

  for (const [name, value] of Object.entries(radius)) {
    root.style.setProperty(`--radius-${name}`, px(value));
  }

  root.style.setProperty("--layout-max-content-width", px(layout.maxContentWidth));
  root.style.setProperty("--layout-screen-padding", px(layout.screenPadding));
  root.style.setProperty("--layout-tile-padding", px(layout.tilePadding));
  root.style.setProperty("--layout-nested-inset", px(layout.nestedInset));

  root.style.setProperty(
    "--shadow-tile",
    `${shadows.tile.shadowOffset.width}px ${shadows.tile.shadowOffset.height}px ${shadows.tile.shadowRadius}px ${colors.shadow}`
  );

  root.style.setProperty("--button-primary-background", buttonVariants.secondary.filled.backgroundColor);
  root.style.setProperty("--button-primary-color", buttonVariants.secondary.filled.color);
  root.style.setProperty("--button-secondary-border", buttonVariants.secondary.contained.borderColor);
  root.style.setProperty("--button-secondary-color", buttonVariants.secondary.contained.color);
  root.style.setProperty("--button-min-height", px(componentStyles.primaryButton.minHeight));
}
