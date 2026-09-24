# Skate Route Mapper Design Guide

> **The canonical design system is published to Claude Design:**
> https://claude.ai/design/p/1b289219-57b8-4ced-8011-9bca7af6ad4b
>
> Brand and visual rules — colour, contrast, type, spacing, radius, elevation,
> surfaces, borders, buttons, states — live there as specimens in
> `.design-sync/foundations.tsx`, which read `shared/src/design.ts` at render
> time. Put a visual rule there, not here.
>
> This file is the **mobile app's page and navigation framework**: how `Page`
> works, drawer-only navigation, places versus detours, overlay motion. That is
> app architecture rather than brand, and it has no specimen. The token tables
> below are a convenience copy; `shared/src/design.ts` is the source of truth
> and wins any disagreement.

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
| `neutral` | `#c9b8ab` | An indicator that is off rather than bad |
| `track` | `#e4d8ce` | The unfilled half of a switch, slider or progress rail |
| `scrim` | `rgba(23,17,12,.45)` | Dim behind a sheet or drawer |
| `surfaceOnPage` | `rgba(255,255,255,.18)` | Faint fill for a control sitting on the orange page |

`neutral` and `danger` are not interchangeable. An unpaired sensor is `neutral`;
a failed upload is `danger`. Colouring an optional, absent thing red tells a
rider something is wrong when nothing is.

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

## Shadows

| Token | Use | Bleed (top / bottom / side) |
| --- | --- | --- |
| `tile` | White tiles on the page | 10 / 38 / 24 |
| `control` | Small controls floating inside a clipping container | 5 / 15 / 10 |
| `sheet` | A bottom sheet, lifting upward | 40 / 24 / 32 |

Bleed is how far the shadow spreads past the element. It is computed, not
written down — see "Shadows are never clipped" under Page Framework, which is
the rule that keeps them from being cut.

## Control Size

Tap-target heights. The size of a control is a statement about its importance,
so a screen should step down through these rather than repeat one height.

| Token | Value | Use |
| --- | --- | --- |
| `xs` | `36` | Compact chips, close buttons, status pills |
| `sm` | `44` | Icon buttons, nav-row controls, segmented controls |
| `md` | `52` | Ordinary buttons and text inputs |
| `lg` | `60` | Paired primary actions sharing a row |
| `xl` | `68` | The one dominant action on a screen |

At most one `xl` control per screen. If two compete, neither reads as primary.

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

Disabled controls:

- Keep disabled controls on their normal variant colors, border, and text treatment.
- Apply `stateStyles.disabled` from `shared/src/design.ts` instead of swapping to a muted fill color.
- Default disabled opacity is `0.5`.

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

## Page Framework

Every mobile screen is rendered by `mobile/src/components/Page.tsx`. Screens
supply content; the frame supplies chrome. This is a rule about behaviour, not
only looks: a header assembled per screen is a header that works on some
screens and not on others.

The frame is deliberately small. Exactly two things are standard on every page,
and they share the top line:

```text
Ready to roll                                   [☰]
```

- **The title takes the space that is left and wraps. The drawer button never
  shrinks and never moves.** That is the whole rule, and it is what stops a
  long title pushing the button off the edge of the phone.
- **An optional subtitle** sits under the title, still inside the frame.
- **Nothing else is standard.** A screen-specific control is the screen's
  content and starts immediately under the header, placed next to whatever it
  belongs to. The GPS pill on the ride screen is about the map, so it sits
  directly on top of the map — not in the header.
- **Safe-area insets are applied once**, from the real insets. Do not use
  `SafeAreaView` from `react-native` — it is a no-op on Android. Where a pad
  and a safe-area inset serve the same purpose, take the larger of the two
  rather than stacking them; stacking loses a thumb's worth of screen at the
  bottom of every page.
- **Two body layouts.** `scroll` for stacked tiles; `fill` for a screen that
  owns its own height, such as a map. A `footer` is pinned below either and
  clears the home indicator itself.

### Shadows are never clipped

This is the rule this app has broken most often, and it is always ugly in the
same way: a soft warm shadow sliced off flat, leaving a hard line down the side
of a tile or across the top of the first one.

**The cause is always the same.** A shadow is drawn *outside* the box that
casts it, and a scrolling container clips to its own bounds. Any container with
`overflow: "hidden"` does too. Give either less room than the shadow needs and
it is cut.

**How far a shadow reaches** is `shadowBleed` in `shared/src/design.ts`, and it
is computed from the shadow rather than written down, so the two cannot drift:

```text
top        = max(0, shadowRadius - shadowOffset.height)
bottom     = shadowRadius + shadowOffset.height
horizontal = shadowRadius
```

For `shadows.tile` that is 10 above, 38 below, 24 each side.

**Three rules follow. Together they make it structural rather than something
to remember.**

1. **The side gutter never goes on a scroll view — only on its content.** An
   inset viewport clips at the tile's own edge, where a cut is most obvious.
   `layout.screenPadding` is the gutter, and it is defined as never narrower
   than `shadowBleed.tile.horizontal`, so a tile laid out against it always has
   room.
2. **Every scroll view holding tiles reserves the bleed on all four sides.**
   `Page`'s `layout="scroll"` does this. A screen bringing its own scroll view
   passes `padded={false}` and spreads `scrollContentInsets` from
   `components/Page.tsx` into that list's `contentContainerStyle`. It may add
   to the bottom for the home indicator; it must not take away.
3. **A shadowed element inside a clipping container uses a shadow that fits
   its inset.** The recentre button floats inside the map frame, which must
   clip for its rounded corners, so it uses `shadows.control` — sized so its
   bleed fits a `space.lg` inset — rather than `shadows.tile`.

**When adding a shadow, ask what clips it.** If the answer is a scroll view,
rule 2 covers you. If it is an `overflow: "hidden"` container, check the
element's inset against `shadowBleed` for the shadow you chose, and pick a
smaller shadow rather than a larger inset.

### Places and detours

Two kinds of page, two ways out.

**A place is listed in the drawer** — the ride screen, saved rides, the
research lab, the account. It has **no back button**. It is somewhere you go,
not somewhere you came from, so the drawer is the only way in and the only way
out, and that answer is the same on every one of them.

**A detour is drilled into** — live detail, one saved ride. It is not in the
drawer, so it was opened from a specific screen and has a real "back". Pass
`back` to `Page` and it shows an arrow left of the title. The swipe gesture
works there too, but a gesture is invisible and not everyone knows it exists,
so the way out has to be something you can see.

Never give a drawer destination a back arrow: an arrow that sometimes means
"up" and sometimes means "wherever you happened to come from" is worse than no
arrow. Never leave a detour without one.

### Links that leave the page

A control that navigates away uses the `openInNew` icon — a bold diagonal
arrow, stroked at the same weight as the type it sits beside. Reserve chevrons
(`expandMore` / `expandLess`) for things that expand in place. A chevron on a
control that pushes a route promises something it does not do.

Such a link is also not `link`-coloured by default. Blue says "look here", and
most navigation away from a screen is secondary to the thing the screen is for
— a way out of a live ride should not compete with the timer. Use `textMuted`
on a white tile, or `textOnOrange` on a `surfaceOnPage` fill. Save `link` for
where the destination genuinely is the point.

## Sheets

A choice that belongs to the screen behind it opens in a bottom sheet
(`mobile/src/components/Sheet.tsx`), not a pushed route. Pushing a route for a
setting puts a live screen behind a stack entry and gives back two meanings.

- Rounded top corners at `radius.xl`, a grabber, and `colors.scrim` behind.
- Never taller than 86% of the screen, so its actions stay reachable.
- Dismissible three ways: scrim, grabber, hardware back.

### Overlay motion

**The scrim fades; only the panel travels.** A scrim that slides in with its
sheet arrives as a moving edge, which reads as a second panel rather than as
the room going dark. It must be full-screen from the first frame and change
only in opacity.

React Native's `Modal` animates everything it contains, so `animationType`
stays `"none"` and the two layers are animated separately. Always set
`statusBarTranslucent`, or the scrim stops at the status bar on Android and
dims everything except the strip along the top.

## Collapsible Sections

A phone screen holds about one and a half tiles of detail. When a screen has
more sections than that, the ones that are merely *set* collapse so the one that
is *happening* stays visible.

- Use `CollapsibleCard` from `mobile/src/components/Card.tsx`.
- A collapsed header must carry its own state in `summary`. Folding a section
  hides its controls, never its answers.
- Collapse automatically when a section stops being the live one — for example,
  the experiment description folds when a capture starts.

## Icons

Icons are SVG, drawn on Material's 24x24 grid, in
`mobile/src/components/Icon.tsx`. The designs are made with Material Symbols,
which is a font; shipping an icon font would mean a binary to load before first
paint. Add new glyphs to that file on the same grid rather than introducing an
icon package.

## Implementation Source

The source of truth lives in `shared/src/design.ts`. Import from `@skate-route-mapper/shared` when styling the mobile app or admin app.
