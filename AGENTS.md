# AGENTS.md

This file gives AI coding agents repo-specific operating instructions. Keep it short and point to canonical docs instead of duplicating full specs.

## Canonical Docs

- Project setup and workflows: `README.md`
- Mobile app notes: `mobile/README.md`
- API contract: `docs/api.md`
- Data model: `docs/data-model.md`
- Admin frontend architecture: `docs/admin-frontend.md`
- Design system guide: `docs/design-guide.md`
- Design tokens/source of truth: `shared/src/design.ts`

## General Rules

- Prefer existing repo patterns over adding new frameworks or abstractions.
- Keep shared contracts in `shared/src/index.ts` aligned with API and mobile usage.
- Do not commit secrets from `.env` files.
- Do not edit generated Prisma client files under `api/generated/` unless explicitly asked.
- Keep docs updated when scripts, setup flows, API contracts, platform fallbacks, or design rules change.
- In the admin app, use TanStack Query for server state. Do not add ad hoc `fetch()` calls or `useEffect` API loading in pages/components.
- Keep admin raw HTTP calls in `admin/src/api/`, query keys in `admin/src/query/queryKeys.ts`, and feature hooks in `admin/src/features/`.
- Reusable admin components should receive data via props and should not fetch their own server data.

## Design Rules

- Do not invent one-off colors, radii, shadows, or button styles in app screens.
- Import tokens from `@skate-route-mapper/shared` where possible.
- Update `shared/src/design.ts` first when changing brand colors, spacing, radius, typography, shadows, or button variants.
- Update `docs/design-guide.md` when changing design rules or visual principles.
- Use predefined `buttonVariants`; do not create random button styles.
- Information containers use faint fills and no visible borders.
- Borders are reserved for interactive controls, outlined buttons, and selected states.
- Compact selected controls can use filled orange; large selected information tiles should use faint fill plus orange border.

## Mobile Notes

- Native SQLite storage lives in `mobile/src/database/db.ts`.
- Web storage fallback lives in `mobile/src/database/db.web.ts`.
- Native maps live in `mobile/src/components/RideRouteMap.tsx`.
- Web map fallback lives in `mobile/src/components/RideRouteMap.web.tsx`.
- Web font setup lives in `mobile/src/setupFonts.web.ts` and `mobile/src/web.css`.
- Do not remove platform-specific `.web.tsx` or `.web.ts` files just because the native file exists.
- `npm run mobile:web` is for UI/layout checks and uses native fallbacks.
- Full device behavior for sensors, GPS, maps, and BLE must be checked on a physical device or development build.

## Validation

The user prefers to run build/dev commands outside chat. After relevant changes, ask them to run the needed command instead of running it automatically.

Common checks:

```bash
npm run admin:build
npm run mobile:web
```

Use narrower checks when the change only touches one package.
