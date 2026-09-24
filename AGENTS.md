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
- Design system guide: `docs/design-guide.md`
- Design tokens/source of truth: `shared/src/design.ts`

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

## Design Rules

- Do not invent one-off colors, radii, shadows, or button styles in app screens.
- Import tokens from `@skate-route-mapper/shared/design` where possible.
- Update `shared/src/design.ts` first when changing brand colors, spacing, radius, typography, shadows, or button variants.
- Update `docs/design-guide.md` when changing design rules or visual principles.
- Use predefined `buttonVariants`; do not create random button styles.
- Information containers use faint fills and no visible borders.
- Borders are reserved for interactive controls, outlined buttons, and selected states.
- Compact selected controls can use filled orange; large selected information tiles should use faint fill plus orange border.

## Mobile Notes

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
- Native maps live in `mobile/src/components/RideRouteMap.tsx`.
- Web map fallback lives in `mobile/src/components/RideRouteMap.web.tsx`.
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
