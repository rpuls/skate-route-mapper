import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
} from "@mui/material";
import type {
  AdminResource,
  AdminResourceField,
} from "@skate-route-mapper/shared/adminResources";
import { space } from "@skate-route-mapper/shared/design";
import { radiusLevel, surfaceSx } from "../../theme/adminTheme";
import type { EntityRecord, EntitySort } from "../../types";

/** Identifier columns hold opaque keys, so they get a narrower minimum width. */
function isIdentifierField(field: AdminResourceField, resource: AdminResource) {
  return field.name === resource.idField || /Id$/.test(field.name);
}

function formatString(value: string, field: AdminResourceField) {
  if (field.type === "datetime") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString([], {
        dateStyle: "short",
        timeStyle: "medium",
      });
    }
  }

  return value;
}

function fieldValue(record: EntityRecord, field: AdminResourceField) {
  const value = record[field.name];

  if (value === null || value === undefined || value === "") {
    return "Not set";
  }

  if (field.type === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return formatString(value, field);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Which way to sort a column that is not sorted yet.
 *
 * A date or a number is nearly always wanted newest or largest first, while a
 * name or a label is wanted from the top of the alphabet. Guessing this saves
 * the second click that would otherwise follow every first one.
 */
function initialDirection(field: AdminResourceField) {
  return field.type === "datetime" || field.type === "number" || field.type === "bigint"
    ? "desc"
    : "asc";
}

/**
 * The ordering one more click on `field` should ask for.
 *
 * A column cycles through its natural direction, then the reverse, then back to
 * the resource default, so there is always a way out of a sort without
 * reloading the page.
 */
function nextSort(field: AdminResourceField, sort: EntitySort | null): EntitySort | null {
  const preferred = initialDirection(field);

  if (sort?.field !== field.name) {
    return { field: field.name, direction: preferred };
  }

  return sort.direction === preferred
    ? { field: field.name, direction: preferred === "asc" ? "desc" : "asc" }
    : null;
}

export function EntityTable({
  onSelectRecord,
  onSortChange,
  records,
  resource,
  selectedRecord,
  sort,
}: {
  onSelectRecord: (record: EntityRecord) => void;
  /** Omitted by a caller that shows an unordered list, which hides the controls. */
  onSortChange?: (sort: EntitySort | null) => void;
  records: EntityRecord[];
  resource: AdminResource;
  selectedRecord: EntityRecord | null;
  sort?: EntitySort | null;
}) {
  const fields = resource.fields.filter((field) => field.list);
  const activeSort = sort ?? null;

  return (
    <TableContainer
      component={Box}
      sx={{
        ...surfaceSx({ level: radiusLevel.embedded, padding: space.none }),
        maxWidth: "100%",
        overflowX: "auto",
        width: "100%",
      }}
    >
      <Table size="small" sx={{ minWidth: Math.max(760, fields.length * 132) }}>
        <TableHead>
          <TableRow>
            {fields.map((field) => {
              const sortedDirection =
                activeSort && activeSort.field === field.name ? activeSort.direction : null;
              const headerSx = {
                color: "text.secondary",
                fontWeight: 900,
                maxWidth: 180,
                minWidth: isIdentifierField(field, resource) ? 96 : 112,
                textTransform: "uppercase",
                whiteSpace: "nowrap",
              } as const;

              if (!onSortChange) {
                return (
                  <TableCell key={field.name} sx={headerSx}>
                    {field.label}
                  </TableCell>
                );
              }

              return (
                <TableCell
                  key={field.name}
                  sortDirection={sortedDirection ?? false}
                  sx={headerSx}
                >
                  <TableSortLabel
                    active={sortedDirection !== null}
                    direction={sortedDirection ?? initialDirection(field)}
                    onClick={() => onSortChange(nextSort(field, activeSort))}
                  >
                    {field.label}
                  </TableSortLabel>
                </TableCell>
              );
            })}
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((record) => {
            const isSelected = selectedRecord?.[resource.idField] === record[resource.idField];

            return (
              <TableRow
                hover
                key={String(record[resource.idField])}
                onClick={() => onSelectRecord(record)}
                selected={isSelected}
                sx={{ cursor: "pointer" }}
              >
                {fields.map((field) => (
                  <TableCell
                    key={field.name}
                    sx={{
                      whiteSpace: "nowrap",
                    }}
                  >
                    {fieldValue(record, field)}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
