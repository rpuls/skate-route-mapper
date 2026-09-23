// Generates .design-sync/brand.css from shared/src/design.ts so the uploaded
// tokens can never drift from the repo's source of truth.
// Re-run before every design-sync build: node .design-sync/gen-brand-css.mjs
import { build } from "../.ds-sync/node_modules/esbuild/lib/main.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const root = join(here, "..");

const tmp = await mkdtemp(join(tmpdir(), "skate-design-"));
const outfile = join(tmp, "design.mjs");
await build({
  bundle: true,
  entryPoints: [join(root, "shared/src/design.ts")],
  format: "esm",
  outfile,
});
const d = await import(pathToFileURL(outfile).href);
await rm(tmp, { force: true, recursive: true });

const lines = [];
const push = (k, v) => lines.push(`  --skate-${k}: ${v};`);

for (const [k, v] of Object.entries(d.brandColors)) push(`brand-${kebab(k)}`, v);
for (const [k, v] of Object.entries(d.colors)) push(`color-${kebab(k)}`, v);
for (const [k, v] of Object.entries(d.space)) push(`space-${k}`, `${v}px`);
for (const [k, v] of Object.entries(d.radius)) push(`radius-${k}`, `${v}px`);
for (const [k, v] of Object.entries(d.borderWidth)) push(`border-${k}`, `${v}px`);
push("font-family", d.typography.family);
for (const [k, v] of Object.entries(d.typography.sizes)) push(`font-size-${k}`, `${v}px`);
for (const [k, v] of Object.entries(d.typography.lineHeights)) push(`line-height-${k}`, v);
for (const [k, v] of Object.entries(d.typography.weights)) push(`font-weight-${k}`, v);
for (const [k, v] of Object.entries(d.layout)) push(`layout-${kebab(k)}`, `${v}px`);
push("opacity-disabled", d.stateStyles.disabled.opacity);

const t = d.shadows.tile;
push("shadow-tile", `${t.shadowOffset.width}px ${t.shadowOffset.height}px ${t.shadowRadius}px ${d.colors.shadow}`);

for (const [variant, treatments] of Object.entries(d.buttonVariants)) {
  for (const [treatment, style] of Object.entries(treatments)) {
    for (const [prop, value] of Object.entries(style)) {
      push(`button-${variant}-${treatment}-${kebab(prop)}`, value);
    }
  }
}

function kebab(s) {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const css = `/* GENERATED from shared/src/design.ts by .design-sync/gen-brand-css.mjs - do not edit. */
@import url("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800;900&display=swap");

:root {
${lines.join("\n")}
}

html,
body {
  margin: 0;
  background: var(--skate-color-page);
  color: var(--skate-color-text);
  font-family: var(--skate-font-family);
  font-size: var(--skate-font-size-body);
  line-height: var(--skate-line-height-normal);
}
`;

await writeFile(join(here, "brand.css"), css, "utf8");
console.log(`brand.css written: ${lines.length} custom properties`);
