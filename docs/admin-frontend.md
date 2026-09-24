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
    common/     Small shared pieces such as DetailItem
    maps/       Slippy-map arithmetic and the map components built on it
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
  entityRecords: (
    resourceName: string,
    query?: { page: number; pageSize: number; sort?: EntitySort | null }
  ) =>
    query
      ? (["admin", "entities", resourceName, { ...query }] as const)
      : (["admin", "entities", resourceName] as const),
};
```

When a mutation changes server data, invalidate the specific affected query key.

Generic entity list queries are paginated and ordered by the API. Include
`page`, `pageSize` and the sort in the query key so changing pages or columns
does not overwrite a different answer in the cache. The resource name stays the
first segment after `entities`, so a mutation can invalidate every page and
ordering of one resource with `queryKeys.entityRecords(resource.name)`.

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

Use MUI components for forms, buttons, layout primitives, tables, tabs, alerts,
and cards. Use `sx` for local layout and spacing. Do not invent raw colors,
shadows, radii, or button styles, and do not write down what the system looks
like here: it is published to Claude Design, which is the single source of that
truth (https://claude.ai/design/p/1b289219-57b8-4ced-8011-9bca7af6ad4b). The
values come from `shared/src/design.ts`.

### One surface level

A page is a stack of `components/common/PageCard.tsx`, and a card never holds
another card. A section that needs separating from its neighbours inside a card
gets a `Divider`. The shell renders the page title, so a page does not repeat
it.

This is why the entity viewer renders the resource picker, the list and the
selected record's detail as sibling cards, and why a detail view with two things
to say returns two cards rather than splitting one.

Radii come from `radiusLevel` in `admin/src/theme/adminTheme.ts`, one step per
level of nesting: `outer` for a page card, `inner` for a table, map or control
inside it, `embedded` for a control inside that, `utility` below. Use
`surfaceSx()` for surfaces and `controlRadiusPx()` for controls, never a
literal.

When changing visual language:

1. Update `shared/src/design.ts`, which holds the values.
2. Update the specimens in `.design-sync/foundations.tsx` and re-publish if the
   rule itself changed; see `.design-sync/NOTES.md`.
3. Update `admin/src/theme/adminTheme.ts` if the MUI mapping changes.

## Entity Viewer

The entity viewer is generated from Prisma datamodel metadata returned by the API. Do not manually add entity tabs in the frontend.

Create and edit flows should share `AddOrEditEntityDialog`, with page-level TanStack Query hooks providing create, update, and delete mutations. The table remains for browsing and selecting records; row selection opens the dialog for editable/deletable resources.

Generic entity lists should use the API pagination metadata instead of assuming
the first response contains every record. Keep large analysis payloads behind
explicit limits or dedicated endpoints rather than loading entire tables into a
component.

Allowed custom policy belongs on the API side, for example:

- hiding `passwordHash`
- exposing virtual password fields for `AdminUser` and mobile `User` records
- marking sensitive models read-only

Models are editable by default when their Prisma scalar fields are writable.
Read-only models and virtual fields are explicit API-side exceptions; frontend
code must not hard-code a model as editable or read-only.

Custom product workflows can get their own pages later, but the generic entity viewer should remain datamodel-driven.

### Sorting

Column headers in `EntityTable` are sortable, and the sort is server side for
the same reason paging is: reordering the twenty-five rows that happened to
arrive is not sorting the table. `EntityManagementPage` owns the sort state and
passes it to the list query; the table only renders the controls and reports
clicks.

- A column cycles through its natural direction, then the reverse, then back to
  the resource default, so there is always a way out of a sort.
- The natural direction comes from the field type: dates and numbers start
  newest and largest first, text starts at A.
- Changing the sort returns to page one and clears the selected row, because a
  new ordering renumbers every page.
- A list view that replaces the table receives `sort` and `onSortChange` and
  forwards them to whatever it renders. A view with `loadsOwnRecords` ignores
  them and orders its own query.
- Nothing about sorting is per model. The API decides which fields can be sorted
  on, from the same datamodel metadata that decides which ones are listed.

### Custom Entity Views

Some resources need more than a generated table. They get a purpose-built
component that is injected into the viewer, never a branch inside it.
`EntityManagementPage.tsx` must contain no resource names and no per-model
behaviour; it asks the registry what to render and renders that.

- `features/entities/entityViewContract.ts` defines the two prop shapes a custom
  view can implement, and imports no components so views can depend on it freely.
- `features/entities/entityViewRegistry.ts` is the only module that maps a
  resource name to a component. Adding, changing, or removing a special view is a
  change to this file plus the view itself.

A registered view is one of:

- `list` replaces the generated table for that resource. Set `loadsOwnRecords`
  when the view queries its own data, which also drops the generic list query,
  its pagination, and the create button; `summary` then replaces the record
  count caption.
- `detail` renders under the generated list card for the selected record.
  Selecting a row reveals the detail view rather than opening the edit dialog,
  so the view owns the record interaction and offers its own edit affordance if
  the resource is writable. The viewer does not wrap it, so the view brings its
  own `PageCard`s.

Views receive `records`, `resource`, `resources`, `session`, and `sort` as
props, plus `onEditRecord` to open the shared dialog, `onOpenResource` to hand a
record to another resource, and `onSortChange` to ask for a different column
ordering. The receiving view reads a handed-over record as `focusRecordId`.

Current views: `RidesExplorer` (ride detail and analysis), `SamplesExplorer`
(server-side filtering instead of paging millions of rows), and
`ResearchCaptureInspector` (signal analysis of a stored capture).

### Research Capture Inspector

`ResearchCaptureInspector` downloads a stored `.skateresearch` container through
the existing admin asset endpoint, decodes it with the shared
`xiaoResearch` reader, and analyses it in the browser. No analysis endpoint
exists or is needed; recordings are at most about a megabyte.

It answers two questions about a capture, and the second matters as much as the
first: a spectrum means one thing over cobbles at walking pace and another over
asphalt at twenty.

- The inspector is two cards: the capture itself, with its label, actions, note,
  surface photo and GPS track, and then the signal analysis of the recording.
- `components/research/ResearchCaptureSite.tsx` shows the surface photo and the
  GPS track together with the speed over the recorded window. It is
  presentational; the inspector fetches and decodes.
- `features/research/captureField.ts` reads the phone's field notes — the track
  and the capture's positions — out of the recording's own JSON header with
  `decodeRecordingHeader`, so no second request and no sample-block decode are
  needed. Every member is parsed defensively: captures saved before the track
  existed carry none of it, and a missing member reads as "not recorded" rather
  than as an error.
- The surface photo is fetched as a blob because the asset endpoint is behind
  the admin bearer token, which an `<img src>` cannot send. The view owns the
  object URL it makes and revokes it when the selected capture changes.
- The label, category and note are edited inline rather than through
  `AddOrEditEntityDialog`, because a note runs to four thousand characters and
  needs a box it fits in. The form still only offers fields the API marked
  editable, and the categories come from `researchCategories` in
  `shared/src/researchContracts.ts`, so the admin app and the phone file
  captures under the same names.

- `features/research/signalAnalysis.ts` is the numerical core: Welch PSD and
  spectrogram, pure functions with no React, no DOM, and no network. It
  deliberately mirrors `hardware/research-signal-analysis.py`, and its output has
  been checked against that script's scipy results to floating-point precision.
  Keep the two in step when either changes.
- `components/research/ResearchSignalCharts.tsx` draws the four panels on canvas,
  because a capture holds tens of thousands of samples per axis.
- `components/research/chartCanvas.ts` holds the shared canvas furniture: device
  pixel setup, tick selection, axes, and the viridis ramp used for the heat map.
  A perceptually uniform colour ramp is data encoding rather than decoration, so
  it is not part of the brand palette in `shared/src/design.ts`.

### Maps

Maps are inline SVG over OpenStreetMap raster tiles. There is no map library.

- `components/maps/tileMap.ts` holds the arithmetic: Web Mercator projection,
  the view that frames a set of coordinates, the tiles covering that view, and
  how a drag and a wheel move it. Pure functions, no React and no DOM, so every
  map in the app projects and frames identically.
- `components/maps/TrackMap.tsx` draws one recorded path with optional markers.
  Use it for a path that is simply where something happened.
- `components/entities/RideAnalysisPanel.tsx` keeps its own map because it
  colours the route by roughness and carries a playback marker, but it uses the
  same arithmetic.
- OpenStreetMap's tile usage policy requires visible attribution. Show
  `tileAttribution` on any map frame rather than writing the credit by hand.

## Hardware Bench

The hardware bench is an admin feature page rather than a separate web app.
Its code is split by responsibility:

- `features/hardware/browserHardware.ts` contains narrow browser API types.
- `features/hardware/useHardwareConnection.ts` owns USB/BLE connection lifecycle and live samples.
- `features/hardware/researchClient.ts` owns BLE request/page transport for the research protocol.
- `features/hardware/useResearchRecorder.ts` owns capture, retrieval, validation, file-open, and file-save state.
- `components/hardware/HardwareCharts.tsx` renders charts from data supplied by the page.
- `pages/HardwareBenchPage.tsx` composes the workflow and MUI presentation.

Browser device access is local to the administrator's computer. It does not go
through the API, so TanStack Query is not involved. Web Bluetooth and Web Serial
require a compatible browser and secure context. The deployed HTTPS admin app
can connect to hardware attached to another administrator's computer, subject
to that browser's permission prompt.
