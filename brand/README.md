# Brand assets

The one place the app's logo lives. Everything else in the repo is generated
from it, so there is never a second original to keep in step.

## Status: draft

`app-icon.png` is a **draft**. It is a raster illustration, not a drawn mark,
and two things are still missing:

- an **SVG** version, for anything that has to scale or be recoloured;
- a **low-detail** version for small sizes — the illustration is a whole scene,
  and below about 32px it reduces to a coloured blob (see the favicons).

Treat it as placeholder artwork that happens to be in use. It is published to
the design system as a draft too, so a replacement does not have to hunt for
the places it leaked into.

## Files

| File | What it is |
| --- | --- |
| `app-icon.png` | The source artwork, 1254x1254, exactly as delivered. Never edit the generated files instead of this one. |
| `app-icon-rounded-1024.png` | The drawing with the white field around it cut to transparency. The master for anything on a coloured background — web, docs, a landing page. |
| `app-icon-rounded-512.png` | The same cut-out at half size, for anywhere a megabyte of icon is too much — a page header, the design-system specimen. |
| `app-icon-square-1024.png` | Opaque, full-bleed square, cropped just inside the drawing's own rounded shape. The master for stores and for platforms that round icons themselves. |

Generated copies live where the platform that consumes them requires a real
file, and are rewritten by the script below rather than edited:

| File | Consumer |
| --- | --- |
| `mobile/assets/icon.png` | Expo `icon` — iOS and the stores |
| `mobile/assets/adaptive-icon.png` | Expo `android.adaptiveIcon.foregroundImage` |
| `mobile/assets/splash-icon.png` | Expo `splash.image` |
| `mobile/assets/favicon.png` | Expo `web.favicon` |
| `admin/public/favicon.png` | Admin browser tab |
| `admin/public/apple-touch-icon.png` | Admin, added to a home screen |

## Regenerating

```bash
pip install pillow
python scripts/build-brand-assets.py
```

The script measures where the white field around the drawing ends instead of
assuming a corner radius, so a replacement `app-icon.png` with a different
shape still masks and crops correctly. It fails loudly if the source is missing
or not square.

Two platform constraints are baked into it, and are the reason the generated
files differ from each other:

- **iOS wants an opaque square** and applies its own corner mask. The source's
  corners are white field, so the square master is cropped inward until no
  field remains — which is why it is slightly tighter than the source.
- **Android masks an adaptive icon to the middle two thirds** of the layer, and
  the mask may be a circle. The foreground therefore holds the drawing inset on
  a transparent layer, over `adaptiveIcon.backgroundColor` in `mobile/app.json`.
  That colour is the brand orange from `shared/src/design.ts`; changing one
  without the other leaves a ring around the drawing.

## Where the rules live

This file covers the files. How the brand looks is documented in the design
system, which is canonical:
https://claude.ai/design/p/1b289219-57b8-4ced-8011-9bca7af6ad4b — the icon has
its own specimen there, marked as a draft. Token values come from
`shared/src/design.ts`.
