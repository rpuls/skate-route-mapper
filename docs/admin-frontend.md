# Admin Frontend Guide

The admin app should stay predictable. This matters because most development will be AI-agent assisted, and agents need one obvious path instead of many plausible patterns.

## Stack Decisions

- React with Vite for the admin app shell.
- MUI for component primitives.
- `shared/src/design.ts` remains the visual source of truth.
- `admin/src/theme/adminTheme.ts` maps shared tokens into MUI and exposes admin layout helpers such as nested radius levels and surface styles.
- TanStack Query is the only server-state/data-fetching framework for the admin app.

## Folder Structure

```text
admin/src/
  api/          Raw HTTP client functions only
  components/   Reusable presentational components
  features/     Feature query hooks and feature-level helpers
  pages/        Route/view-level composition
  query/        Query client and query keys
  session/      Session persistence
  theme/        MUI theme using shared design tokens
```

## Data Fetching Rules

Use this flow for all admin server data:

1. Add or reuse a raw API function in `admin/src/api/`.
2. Add or reuse a query key in `admin/src/query/queryKeys.ts`.
3. Add a feature hook in `admin/src/features/<feature>/`.
4. Use that hook from a page component.
5. Pass data into reusable components as props.

Do not call `fetch()` from page or component files. Do not use ad hoc `useEffect + useState` for API data. Do not create one giant workspace payload unless a specific endpoint is intentionally designed for that purpose.

Pages own data needs. Components should be mostly presentational. Server state belongs in TanStack Query. UI-only state, such as selected tabs or selected table rows, can stay local.

## Query Keys

All query keys live in `admin/src/query/queryKeys.ts`.

Example:

```ts
export const queryKeys = {
  adminResources: ["admin", "resources"] as const,
  entityRecords: (resourceName: string) => ["admin", "entities", resourceName] as const,
};
```

When a mutation changes server data, invalidate the specific affected query key.

Generic entity list queries are paginated. Include `page` and `pageSize` in the
query key so changing pages does not overwrite a different page in the cache.

## API Client Rules

Raw API functions live in `admin/src/api/adminApi.ts`. These functions should:

- accept explicit inputs such as `session`, `resource`, and `payload`
- return parsed data
- throw errors for non-OK responses
- contain no React hooks
- contain no UI behavior

## Component Rules

Reusable components should not fetch data. They receive props and emit events.

Good:

```tsx
<EntityTable records={records} resource={resource} onSelectRecord={setSelectedRecord} />
```

Avoid:

```tsx
function EntityTable() {
  const records = useQuery(...);
}
```

## MUI And Styling

Use MUI components for forms, buttons, layout primitives, tables, tabs, alerts, and cards. Use `sx` for local layout and spacing. Do not invent raw colors, shadows, radii, or button styles.

Use nested radius levels from `admin/src/theme/adminTheme.ts` instead of hard-coded radii:

- `radiusLevel.outer`: floating page tiles, `32px`
- `radiusLevel.inner`: panels and controls one level inside a tile, `24px`
- `radiusLevel.embedded`: controls or tables inside an inner panel, `16px`
- `radiusLevel.utility`: tiny nested utility elements, `8px`

Prefer `surfaceSx()` for Paper/Card-like surfaces and `controlRadiusPx()` for controls that need to step down inside nested panels.

When changing visual language:

1. Update `shared/src/design.ts`.
2. Update `admin/src/theme/adminTheme.ts` if MUI mapping changes.
3. Update `docs/design-guide.md` if the design rule changes.

## Entity Viewer

The entity viewer is generated from Prisma datamodel metadata returned by the API. Do not manually add entity tabs in the frontend.

Create and edit flows should share `AddOrEditEntityDialog`, with page-level TanStack Query hooks providing create, update, and delete mutations. The table remains for browsing and selecting records; row selection opens the dialog for editable/deletable resources.

Generic entity lists should use the API pagination metadata instead of assuming
the first response contains every record. Keep large analysis payloads behind
explicit limits or dedicated endpoints rather than loading entire tables into a
component.

Allowed custom policy belongs on the API side, for example:

- hiding `passwordHash`
- exposing virtual fields such as `AdminUser.password`
- marking sensitive models read-only

Custom product workflows can get their own pages later, but the generic entity viewer should remain datamodel-driven.
