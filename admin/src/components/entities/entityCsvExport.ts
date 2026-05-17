import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import type { EntityRecord } from "../../types";

function csvValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_, nestedValue) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue
      );
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function csvCell(value: unknown) {
  return `"${csvValue(value).replaceAll('"', '""')}"`;
}

function csvHeaders(records: EntityRecord[], resource?: AdminResource) {
  const orderedFields = resource?.fields.map((field) => field.name) ?? [];
  const fields = new Set(orderedFields);

  for (const record of records) {
    for (const key of Object.keys(record)) {
      fields.add(key);
    }
  }

  return Array.from(fields);
}

function safeFilenamePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "entities";
}

export function downloadEntityRecordsCsv({
  filenamePrefix,
  records,
  resource,
}: {
  filenamePrefix: string;
  records: EntityRecord[];
  resource?: AdminResource;
}) {
  const headers = csvHeaders(records, resource);
  const rows = [
    headers.map(csvCell).join(","),
    ...records.map((record) => headers.map((header) => csvCell(record[header])).join(",")),
  ];
  const csv = `\uFEFF${rows.join("\r\n")}\r\n`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `${safeFilenamePart(filenamePrefix)}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
