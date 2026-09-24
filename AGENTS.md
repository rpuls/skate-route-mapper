# AGENTS.md

This file gives AI coding agents repo-specific operating instructions. Keep it short and point to canonical docs instead of duplicating full specs.

## Canonical Docs

- Project setup and workflows: `README.md`
- Mobile app notes: `mobile/README.md`
- API contract: `docs/api.md`
- Data model: `docs/data-model.md`
- Admin frontend architecture: `docs/admin-frontend.md`
- Ride tracking (GPS filtering, distance, speed): `docs/ride-tracking.md`
- Vibration roughness planning: `docs/vibration-roughness-plan.md`
- Current development plan and known gaps: `docs/development-plan.md`
- Design system (canonical): https://claude.ai/design/p/1b289219-57b8-4ced-8011-9bca7af6ad4b
- Design tokens (source of truth for values): `shared/src/design.ts`
- Mobile page/navigation framework: `docs/design-guide.md`

## General Rules

- Prefer existing repo patterns over adding new frameworks or abstractions.
- Keep shared contracts in `shared/src/index.ts` aligned with API and mobile usage.
- Treat `shared` as a set of explicit contract modules. Prefer subpath imports
  such as `@skate-route-mapper/shared/contracts`,
  `@skate-route-mapper/shared/mobileContracts`,
  `@skate-route-mapper/shared/researchContracts`,
  `@skate-route-mapper/shared/design`,
  `@skate-route-mapper/shared/rideTracking`,
  `@skate-route-mapper/shared/adminResources`,
  `@skate-route-mapper/shared/xiaoBle`, and
  `@skate-route-mapper/shared/xiaoResearch` over importing from the root package.
- Do not re-export feature-specific or platform-specific modules from
  `shared/src/index.ts`; doing so makes unrelated builds type-check that code.
- Do not commit secrets from `.env` files.
- Do not edit generated Prisma client files under `backend/generated/` unless explicitly asked.
- Keep docs updated when scripts, setup flows, API contracts, platform fallbacks, or design rules change.
- In the admin app, use TanStack Query for server state. Do not add ad hoc `fetch()` calls or `useEffect` API loading in pages/components.
- Keep admin raw HTTP calls in `admin/src/api/`, query keys in `admin/src/query/queryKeys.ts`, and feature hooks in `admin/src/features/`.
- Reusable admin components should receive data via props and should not fetch their own server data.

## Design System

The visual system is **published to Claude Design** and is canonical there. Three
layers, and it matters which one you touch:

1. **`shared/src/design.ts` — the source of truth for every value.** The apps
   and the published specimens both read it at render time, so a token change
   propagates to both and values cannot drift. Change brand colours, spacing,
   radius, typography, shadows, control sizes or button variants here first.
2. **`.design-sync/foundations.tsx` — the specimens that document the rules.**
   Colour, contrast, type, spacing, radius, nested radius, elevation, surfaces,
   borders and fills, buttons, states, mobile screens. A *visual or brand rule*
   belongs here, not in a repo markdown file. Publishing an edit needs a full
   design-sync rebuild; see `.design-sync/NOTES.md`.
3. **`docs/design-guide.md` — the mobile app's page and navigation framework.**
   How `Page` works, drawer-only navigation, places versus detours, overlay
   motion. This is app architecture rather than brand, and it has no specimen.

**`.design-sync/`, `.ds-sync/` and `ds-bundle/` are gitignored**, so they are
absent from a fresh clone. Check they exist before assuming the design system is
missing, and never conclude from `git ls-files` that there is no design system.

- Do not invent one-off colors, radii, shadows, or button styles in app screens.
- Import tokens from `@skate-route-mapper/shared/design` where possible.
- When a rule is about how the brand looks, put it in a specimen. When it is
  about how this app's screens are assembled, put it in `docs/design-guide.md`.
  If you are unsure, it is probably a brand rule.
- Use predefined `buttonVariants`; do not create random button styles.
- Information containers use faint fills and no visible borders.
- Borders are reserved for interactive controls, outlined buttons, and selected states.
- Compact selected controls can use filled orange; large selected information tiles should use faint fill plus orange border.

## Mobile Notes

- Every screen is rendered by `mobile/src/components/Page.tsx`. The only
  standard chrome is the page title and the drawer button, sharing the top
  line; the title flexes and wraps, the button never shrinks. Screens supply
  content, never their own header or safe-area handling. Do not use
  `SafeAreaView` from `react-native`: it is a no-op on Android, and `Page`
  already applies the real insets.
- A page listed in the drawer gets no back button; the drawer is how it is
  reached and left. A page drilled into from another screen (live detail, a
  saved ride) passes `back` to `Page` for a back arrow. Do not mix the two.
- A control that navigates away uses the `openInNew` icon, never a chevron —
  chevrons mean "expands in place". Do not colour it `link` unless the
  destination really is the point of the screen.
- A screen-specific control belongs in the screen's content, next to whatever
  it is about, not in the page frame.
- Never let a drop shadow be clipped. A scrolling viewport never carries the
  side gutter; its content container does, and it reserves `shadowBleed` on all
  four sides. A screen with its own `FlatList` passes `padded={false}` to
  `Page` and spreads `scrollContentInsets` into the list's
  `contentContainerStyle`. A shadowed element inside an `overflow: "hidden"`
  container uses a shadow whose bleed fits its inset (`shadows.control`, not
  `shadows.tile`). See "Shadows are never clipped" in `docs/design-guide.md`.
- Shared UI primitives live in `mobile/src/components/`: `Page.tsx` (page
  frame), `AppMenu.tsx` (drawer), `Card.tsx` (`Card`, `CollapsibleCard`),
  `Sheet.tsx` (bottom sheet), `Icon.tsx` (the SVG icon set).
- Icons are SVG on Material's 24x24 grid in `Icon.tsx`. Add glyphs there rather
  than adding an icon font or package.
- The XIAO BLE connection is owned by `mobile/src/native/xiaoConnection.ts` at
  module scope and shared by every screen. Do not open a connection from a
  screen or tear one down on blur: a rider who pairs a board on the ride screen
  must still have it in the research lab.
- That module is also the only thing that decides whether the link is up.
  `XiaoBle.ts` is transport (scan, GATT, the board's protocols) and holds no
  retry policy; screens report `useXiaoConnection()` and never keep their own
  idea of connectedness. Anything a rider pressed goes through
  `requireXiaoConnection()`, which verifies with the radio first — holding a
  `XiaoBleConnection` object is not evidence the board is still there.
  Reconnection, backoff and the remembered board all live in the module; do not
  add a retry loop to a screen. See "The XIAO connection" in `mobile/README.md`.
- Small remembered choices go through `mobile/src/storage/preferences.ts`
  (web fallback `preferences.web.ts`, keys in `preferenceKeys.ts`). Rides and
  captures belong in SQLite.
- A research capture's phone-side GPS log lives in
  `mobile/src/research/captureTrack.ts`, at module scope for the same reason the
  BLE link is: a rider who leaves the lab mid-capture must not lose it. It is
  bounded to the board's recording window, and a track is only ever saved against
  the board capture id it was started for.
- Route recording lives in `mobile/src/recording/`. `backgroundLocation.ts` owns
  the `expo-location` task and permissions; `rideRecorder.ts` owns the active
  ride and its running totals; both read state from SQLite rather than React,
  because fixes arrive with no component mounted.
- `rideRecorder.ts` and `mobile/src/sync/syncLoop.ts` take storage and the
  network as ports, and `recorder.ts` / `syncService.ts` wire the real ones.
  Keep it that way: importing `../database/db` into them would make the
  recording and upload lifecycles untestable again, since it pulls in
  `expo-sqlite`.
- GPS fix filtering and ride distance/speed maths live in
  `shared/src/rideTracking.ts` and are shared with the backend. Change them
  there, not per platform.
- Native SQLite storage lives in `mobile/src/database/db.ts`.
- Web storage fallback lives in `mobile/src/database/db.web.ts`.
- Native maps live in `mobile/src/components/RideRouteMap.tsx` (a finished ride,
  fixed height) and `mobile/src/components/LiveRouteMap.tsx` (the ride in
  progress, filling its parent).
- Web map fallbacks live in `mobile/src/components/RideRouteMap.web.tsx` and
  `mobile/src/components/LiveRouteMap.web.tsx`.
- Web font setup lives in `mobile/src/setupFonts.web.ts` and `mobile/src/web.css`.
- Web background-recording fallback lives in
  `mobile/src/recording/backgroundLocation.web.ts`.
- Do not remove platform-specific `.web.tsx` or `.web.ts` files just because the native file exists.
- `npm run dev:web` is for UI/layout checks and uses native fallbacks.
- Full device behavior for sensors, GPS, maps, and BLE must be checked on a physical device or development build.

## Validation

The user prefers to run build/dev commands outside chat. After relevant changes, ask them to run the needed command instead of running it automatically.

Common checks:

```bash
npm run build
npm run dev:web
npm run contracts:test
```

Use narrower checks when the change only touches one package.
