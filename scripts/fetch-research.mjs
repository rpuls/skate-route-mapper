// Pull the research dataset down to research-data/ so the road surface work can
// be done against real recordings without a database or a browser.
//
// Run it with `npm run research:fetch`. It reads the API base URL and the admin
// key from .env, walks the paged export endpoint, and writes one folder per
// capture holding the row, the .skateresearch recording and the surface photo.
//
// Resumable and incremental by design. capture.json is written last, after both
// binaries have landed, so it doubles as the "this capture is complete" marker:
// an interrupted run leaves no marker and the next run fetches that capture
// again. A capture whose stored updatedAt matches the server's is skipped
// entirely, so a repeat run over a hundred captures costs one manifest request.
//
// No dependencies, because a data-fetching script that needs an install step is
// one more thing to go wrong on a laptop that just wants the data.
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repoRoot, "research-data");
const capturesRoot = join(outputRoot, "captures");
const pageSize = 50;

const force = process.argv.includes("--force");

/**
 * A .env reader small enough to not be a dependency.
 *
 * Deliberately dumb: `KEY=value`, `export` and surrounding quotes stripped,
 * blank lines and `#` comments skipped. A real environment variable wins, so
 * `ADMIN_API_KEY=... npm run research:fetch` works without touching the file.
 */
async function readEnvFile(path) {
  let contents;

  try {
    contents = await readFile(path, "utf8");
  } catch {
    return {};
  }

  const values = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).replace(/^export\s+/, "").trim();
    const value = line.slice(separator + 1).trim().replace(/^["'](.*)["']$/, "$1");

    if (key) {
      values[key] = value;
    }
  }

  return values;
}

async function readSettings() {
  const fileEnv = {
    ...(await readEnvFile(join(repoRoot, ".env"))),
    ...(await readEnvFile(join(repoRoot, "backend", ".env"))),
  };
  const read = (name) => process.env[name] ?? fileEnv[name] ?? "";

  const baseUrl = (
    read("RESEARCH_API_BASE_URL") ||
    read("VITE_API_BASE_URL") ||
    "http://localhost:3001"
  ).replace(/\/+$/, "");
  const apiKey = read("RESEARCH_API_KEY") || read("ADMIN_API_KEY");

  if (!apiKey) {
    throw new Error(
      "No admin key. Put ADMIN_API_KEY in .env, or RESEARCH_API_KEY if the export uses a key of its own."
    );
  }

  return { apiKey, baseUrl };
}

async function requestResearch(settings, path) {
  let response;

  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
  } catch (error) {
    // Node's own message for a refused connection is a bare "fetch failed",
    // which says nothing about which host was wrong.
    throw new Error(
      `Could not reach ${settings.baseUrl}. Start the API with \`npm run app\`, or set RESEARCH_API_BASE_URL to the deployed one. (${error instanceof Error ? (error.cause?.code ?? error.message) : error})`
    );
  }

  if (response.status === 401) {
    throw new Error(
      `${settings.baseUrl} rejected the key. ADMIN_API_KEY must match the value that API is running with.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.slice(0, 300);

    throw new Error(
      `GET ${path} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`
    );
  }

  return response;
}

/** Every page of the export manifest, in order. */
async function fetchManifest(settings) {
  const captures = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const response = await requestResearch(
      settings,
      `/v1/admin/research-captures/export?limit=${pageSize}&offset=${offset}`
    );
    const page = await response.json();

    total = page.total ?? 0;
    captures.push(...(page.captures ?? []));

    if (captures.length >= total || !page.captures?.length) {
      break;
    }

    offset += page.captures.length;
  }

  return { captures, total };
}

/**
 * Stream an asset to disk.
 *
 * Written to a `.part` file and renamed by the caller's completion marker
 * rather than trusted mid-flight: a half-written recording that looked finished
 * would fail to decode later with nothing to say why.
 */
async function downloadAsset(settings, captureId, asset, destination) {
  const response = await requestResearch(
    settings,
    `/v1/admin/research-captures/${captureId}/${asset}`
  );
  const partial = `${destination}.part`;

  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, destination);
}

/** What was already fetched for this capture, if the last run finished it. */
async function readStoredCapture(folder) {
  try {
    return JSON.parse(await readFile(join(folder, "capture.json"), "utf8"));
  } catch {
    return null;
  }
}

async function fetchCapture(settings, capture) {
  const folder = join(capturesRoot, capture.id);
  const stored = await readStoredCapture(folder);

  if (!force && stored?.updatedAt === capture.updatedAt) {
    return "skipped";
  }

  await mkdir(folder, { recursive: true });
  await downloadAsset(settings, capture.id, "recording", join(folder, "recording.skateresearch"));

  if (capture.hasPhoto) {
    await downloadAsset(settings, capture.id, "photo", join(folder, "surface.jpg"));
  } else {
    // A capture can lose its photo between runs; a stale one would misdescribe it.
    await rm(join(folder, "surface.jpg"), { force: true });
  }

  // Last, so an interrupted run leaves no marker and is retried next time.
  await writeFile(join(folder, "capture.json"), `${JSON.stringify(capture, null, 2)}\n`);

  return stored ? "updated" : "added";
}

/** A line per category, so it is obvious what the dataset actually holds. */
function summarize(captures) {
  const byCategory = new Map();

  for (const capture of captures) {
    const entry = byCategory.get(capture.category) ?? { count: 0, seconds: 0, photos: 0 };

    entry.count += 1;
    entry.seconds += capture.durationSeconds ?? 0;
    entry.photos += capture.hasPhoto ? 1 : 0;
    byCategory.set(capture.category, entry);
  }

  return [...byCategory.entries()]
    .sort((left, right) => right[1].count - left[1].count)
    .map(
      ([category, entry]) =>
        `  ${category}: ${entry.count} captures, ${entry.seconds}s recorded, ${entry.photos} with a photo`
    );
}

async function main() {
  const settings = await readSettings();

  console.log(`Fetching research captures from ${settings.baseUrl}`);

  const { captures, total } = await fetchManifest(settings);

  await mkdir(capturesRoot, { recursive: true });
  await writeFile(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: settings.baseUrl, total, captures }, null, 2)}\n`
  );

  const counts = { added: 0, skipped: 0, updated: 0 };

  for (const [index, capture] of captures.entries()) {
    const position = `${index + 1}/${captures.length}`;

    try {
      const outcome = await fetchCapture(settings, capture);

      counts[outcome] += 1;
      console.log(`${position} ${outcome.padEnd(7)} ${capture.category} - ${capture.label}`);
    } catch (error) {
      // One unreadable capture should not cost the other ninety-nine.
      console.error(
        `${position} failed  ${capture.id}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  console.log("");
  console.log(
    `${total} captures on the server: ${counts.added} added, ${counts.updated} updated, ${counts.skipped} already current.`
  );
  console.log(...summarize(captures).flatMap((line) => [line, "\n"]));
  console.log(`Written to ${outputRoot}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
