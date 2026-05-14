import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import type {
  AdminResource,
  AdminResourceField,
} from "@skate-route-mapper/shared/adminResources";
import { space } from "@skate-route-mapper/shared/design";
import { radiusLevel, surfaceSx } from "../../theme/adminTheme";
import type { EntityRecord } from "../../types";

const idFields = new Set(["id", "rideId", "userId", "deviceId", "adminUserId"]);

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

export function EntityTable({
  onSelectRecord,
  records,
  resource,
  selectedRecord,
}: {
  onSelectRecord: (record: EntityRecord) => void;
  records: EntityRecord[];
  resource: AdminResource;
  selectedRecord: EntityRecord | null;
}) {
  const fields = resource.fields.filter((field) => field.list);

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
            {fields.map((field) => (
              <TableCell
                key={field.name}
                sx={{
                  color: "text.secondary",
                  fontWeight: 900,
                  maxWidth: 180,
                  minWidth: idFields.has(field.name) ? 96 : 112,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {field.label}
              </TableCell>
            ))}
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
