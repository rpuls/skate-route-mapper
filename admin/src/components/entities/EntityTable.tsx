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

function fieldValue(record: EntityRecord, field: AdminResourceField) {
  const value = record[field.name];

  if (value === null || value === undefined || value === "") {
    return "Not set";
  }

  if (field.type === "boolean") {
    return value ? "Yes" : "No";
  }

  if (field.type === "datetime" && typeof value === "string") {
    return new Date(value).toLocaleString();
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
        overflowX: "auto",
      }}
    >
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {fields.map((field) => (
              <TableCell key={field.name} sx={{ color: "text.secondary", fontWeight: 900, textTransform: "uppercase" }}>
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
                  <TableCell key={field.name} sx={{ overflowWrap: "anywhere" }}>
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
