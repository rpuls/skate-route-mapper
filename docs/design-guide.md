# Skate Route Mapper Design Guide

This app should feel bright, physical, and useful: an orange skating surface with clean white tiles sitting on top. The interface can have character, but it should stay readable while someone is outside, moving, and checking route data quickly.

## Core Look

- Use a bright orange page background as the main brand signal.
- Use white tiles for controls, maps, ride summaries, metrics, and forms.
- Use large rounded corners, especially on tiles and primary controls.
- Use nested radius: when a rounded tile contains another rounded shape, the inner radius should be smaller by the same visual inset.
- Keep text dark on white tiles and white on orange backgrounds.
- Prefer chunky, confident typography over delicate UI text.

## Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| `page` | `#ff6a00` | Main app background |
| `pageSoft` | `#ff8a2a` | Subtle orange variation |
| `surface` | `#ffffff` | Main tile background |
| `surfaceMuted` | `#eaf4ff` | Inner tile background |
| `surfaceWarm` | `#fff0e3` | Secondary button and selected states |
| `text` | `#17110c` | Primary text on light surfaces |
| `textMuted` | `#735b4a` | Secondary text and metadata |
| `textOnOrange` | `#ffffff` | Text directly on orange |
| `border` | `#f2d6c2` | Tile and control borders |
| `accent` | `#ff6a00` | Filled buttons and selected controls |
| `accentStrong` | `#c84d00` | Pressed states and dense details |
| `link` | `#1677ff` | Links and interactive map details |
| `success` | `#19a974` | Good state |
| `danger` | `#e5484d` | Stop, delete, failed state |

## Radius

| Token | Value | Use |
| --- | --- | --- |
| `xs` | `8` | Tiny utility elements |
| `sm` | `12` | Small controls |
| `md` | `18` | Inputs, chips, compact controls |
| `lg` | `24` | Buttons and inner panels |
| `xl` | `32` | Main white tiles |
| `xxl` | `40` | Large feature panels |
| `pill` | `999` | Pills, badges, segmented controls |

## Border Width

| Token | Value | Use |
| --- | --- | --- |
| `thin` | `1` | Subtle container borders (tiles, secondary buttons) |
| `thick` | `2` | Outlined controls and focused states |

Outlined controls use `thick` borders (2px). Containers and subtle elements use `thin` borders (1px).

## Nested Radius Rule

Use this default relationship:

```text
Outer tile radius: 32
Tile inset: 8
Inner element radius: 24
```

If the outer radius changes, reduce the inner radius by the inset. For example, a `24` radius card with an `8` inset should contain a `16` radius inner element.

## Spacing

| Token | Value |
| --- | --- |
| `xxs` | `2` |
| `xs` | `4` |
| `sm` | `8` |
| `md` | `12` |
| `lg` | `16` |
| `xl` | `24` |
| `xxl` | `32` |
| `xxxl` | `40` |

Use `24` for screen padding, `16` for tile padding, and `8` for nested insets.

## Typography

- Font family: `"Open Sans", system-ui, sans-serif`.
- Display text: `36`, weight `900`.
- Page titles: `28`, weight `900`.
- Section titles: `18`, weight `800`.
- Body text: `16`, weight `400-600`.
- Captions and metadata: `12-14`, weight `600-800`.
- Avoid negative letter spacing.

## Component Defaults

Use predefined button variants only. Do not invent one-off button styles.

| Variant | Filled | Contained | Text |
| --- | --- | --- | --- |
| Primary | White fill with orange text | Pale warm fill with orange border/text | Orange text only |
| Secondary | Orange fill with white text | Transparent with white border/text on orange | White text only on orange |
| Danger | Red fill with white text | Transparent with red border/text | Red text only |

Borders belong on clickable controls, especially outlined buttons. Information tiles and subtle containers should use faint fill without borders.

Selection rules:

- Compact radio-style controls use filled orange when selected and orange outline when unselected.
- Large selectable information tiles use faint fill plus orange border when selected.
- Ordinary information containers use faint fill with no visible border.

### Screen

- Background: `page`.
- Padding: `24`.
- Content max width on web: `1120`.

### Tile

- Background: `surface`.
- Border: `1px solid border`.
- Radius: `32`.
- Padding: `16`.
- Shadow: soft, warm, low opacity.

### Inner Tile

- Background: `surfaceMuted`.
- Radius: `24`.
- Padding: `12`.

### Primary Button

- Use `buttonVariants.primary`.
- Filled: white background with orange text.
- Contained: warm pale fill with orange border and text.
- Text: orange text only.
- Radius: `24`.
- Minimum height: `52`.
- Weight: `800`.

### Secondary Button

- Use `buttonVariants.secondary`.
- Filled: orange background with white text.
- Contained: transparent background with white border and text on orange.
- Text: white text only on orange.
- Radius: `24`.
- Minimum height: `52`.

## Implementation Source

The source of truth lives in `shared/src/design.ts`. Import from `@skate-route-mapper/shared` when styling the mobile app or admin app.
