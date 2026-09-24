# Page and Navigation Framework

> **The design system is published to Claude Design, and it is the single
> source of truth for how this app looks:**
> https://claude.ai/design/p/1b289219-57b8-4ced-8011-9bca7af6ad4b
>
> Colour, contrast, type, spacing, radius, nested radius, elevation, surfaces,
> borders and fills, buttons, states and the mobile screens are specimens in
> `.design-sync/foundations.tsx`, which read `shared/src/design.ts` at render
> time, so they cannot drift from the values. A visual rule belongs there. Do
> not restate one here, in another repo document, or in a code comment: a
> second copy goes stale, and the copy in front of the reader is the one that
> gets believed.
>
> `shared/src/design.ts` holds the values. This file holds the **mobile app's
> page and navigation framework**: how `Page` works, drawer-only navigation,
> places versus detours, overlay motion. That is app architecture rather than
> brand, and it has no specimen.

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

How such a link is coloured is a brand rule, and it lives in the design system
under Colour ("Blue says look here").

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
