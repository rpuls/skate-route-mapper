import DeleteIcon from "@mui/icons-material/Delete";
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { AdminResource } from "@skate-route-mapper/shared";
import { useEffect, useState } from "react";
import { controlRadiusPx, radiusLevel } from "../../theme/adminTheme";
import type { EntityPayload, EntityRecord } from "../../types";
import { EntityForm } from "./EntityForm";

function recordLabel(resource: AdminResource, record: EntityRecord) {
  return String(record.email ?? record.name ?? record[resource.idField]);
}

export function AddOrEditEntityDialog({
  onClose,
  onDelete,
  onSubmit,
  open,
  record,
  resource,
}: {
  onClose: () => void;
  onDelete?: () => Promise<void>;
  onSubmit: (payload: EntityPayload) => Promise<void>;
  open: boolean;
  record?: EntityRecord | null;
  resource: AdminResource;
}) {
  const mode = record ? "edit" : "create";
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const canDelete = Boolean(record && onDelete && resource.canDelete);
  const title = `${mode === "create" ? "Create" : "Edit"} ${resource.label.toLowerCase()}`;

  useEffect(() => {
    setDeleteError(null);
  }, [open, record, resource.name]);

  async function handleDelete() {
    if (!record || !onDelete) {
      return;
    }

    const confirmed = window.confirm(`Delete ${resource.label.toLowerCase()} ${recordLabel(resource, record)}?`);

    if (!confirmed) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      await onDelete();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Delete failed");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Dialog fullWidth maxWidth="sm" onClose={onClose} open={open}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {record ? (
            <Typography color="text.secondary" sx={{ fontWeight: 800, overflowWrap: "anywhere" }} variant="body2">
              {recordLabel(resource, record)}
            </Typography>
          ) : null}

          {mode === "create" && !resource.canCreate ? (
            <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
              This resource is read-only in the generic entity viewer.
            </Typography>
          ) : (
            <EntityForm
              key={record ? `${resource.name}-${String(record[resource.idField])}` : `${resource.name}-create`}
              controlLevel={radiusLevel.inner}
              mode={mode}
              onCancel={onClose}
              onSubmit={onSubmit}
              {...(record ? { record } : {})}
              resource={resource}
            />
          )}

          {deleteError ? <Alert severity="error">{deleteError}</Alert> : null}

          {canDelete ? (
            <Stack direction="row" sx={{ justifyContent: "flex-start" }}>
              <Button
                color="error"
                disabled={isDeleting}
                onClick={handleDelete}
                startIcon={<DeleteIcon />}
                sx={{ borderRadius: controlRadiusPx(radiusLevel.inner) }}
                variant="outlined"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </Button>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
