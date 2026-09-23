import AddIcon from "@mui/icons-material/Add";
import RefreshIcon from "@mui/icons-material/Refresh";
import {
  Alert,
  Box,
  Button,
  Pagination,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { colors, space } from "@skate-route-mapper/shared/design";
import { useEffect, useMemo, useState } from "react";
import {
  useAdminResources,
  useCreateEntityRecord,
  useDeleteEntityRecord,
  useEntityRecords,
  useUpdateEntityRecord,
} from "../features/entities/entityQueries";
import { entityViewFor } from "../features/entities/entityViewRegistry";
import { AddOrEditEntityDialog } from "../components/entities/AddOrEditEntityDialog";
import { EntityTable } from "../components/entities/EntityTable";
import { adminLayout, controlRadiusPx, px, radiusLevel, surfaceSx } from "../theme/adminTheme";
import type { AdminSession, EntityPayload, EntityRecord } from "../types";

const entityPageSize = 25;

/** A record carried from one resource to another, such as a ride to its samples. */
type EntityHandoff = {
  resourceName: string;
  recordId: string;
};

export function EntityManagementPage({ session }: { session: AdminSession }) {
  const [resourceName, setResourceName] = useState<string | null>(null);
  const [entityPage, setEntityPage] = useState(1);
  const [selectedRecord, setSelectedRecord] = useState<EntityRecord | null>(null);
  const [handoff, setHandoff] = useState<EntityHandoff | null>(null);
  const [upsertOpen, setUpsertOpen] = useState(false);

  const resourcesQuery = useAdminResources(session);
  const resources = resourcesQuery.data ?? [];
  const resource = resources.find((item) => item.name === resourceName) ?? resources[0] ?? null;

  // Resources that need more than a generated table register a view; everything
  // on this page stays driven by datamodel metadata and that registry answer.
  const entityView = entityViewFor(resource?.name);
  const ListView = entityView?.list?.component ?? null;
  const DetailView = entityView?.detail ?? null;
  const listLoadsOwnRecords = Boolean(entityView?.list?.loadsOwnRecords);
  const canOpenUpsertDialog = Boolean(resource?.canEdit || resource?.canDelete);

  const recordsQuery = useEntityRecords(session, listLoadsOwnRecords ? null : resource, {
    page: entityPage,
    pageSize: entityPageSize,
  });
  const createMutation = useCreateEntityRecord(session, resource);
  const deleteMutation = useDeleteEntityRecord(session, resource);
  const updateMutation = useUpdateEntityRecord(session, resource);
  const records = recordsQuery.data?.items ?? [];
  const pagination = recordsQuery.data;
  const idField = resource?.idField ?? "id";
  const selectedRecordId = selectedRecord?.[idField];
  const error = resourcesQuery.error ?? recordsQuery.error ?? createMutation.error ?? deleteMutation.error ?? updateMutation.error;
  const isLoading =
    resourcesQuery.isPending ||
    (!listLoadsOwnRecords && (recordsQuery.isPending || recordsQuery.isFetching));

  const selectedFreshRecord = useMemo(() => {
    if (!selectedRecordId) {
      return null;
    }

    return records.find((record) => record[idField] === selectedRecordId) ?? null;
  }, [idField, records, selectedRecordId]);

  async function refreshRecords() {
    await recordsQuery.refetch();
  }

  async function createRecord(payload: EntityPayload) {
    const createdRecord = await createMutation.mutateAsync(payload);
    setSelectedRecord(createdRecord);
  }

  async function updateRecord(payload: EntityPayload) {
    if (!resource || !selectedFreshRecord) {
      return;
    }

    const updatedRecord = await updateMutation.mutateAsync({
      id: String(selectedFreshRecord[resource.idField]),
      payload
    });
    setSelectedRecord(updatedRecord);
  }

  async function deleteRecord() {
    if (!resource || !selectedFreshRecord) {
      return;
    }

    await deleteMutation.mutateAsync(String(selectedFreshRecord[resource.idField]));
    setSelectedRecord(null);
  }

  function openResource(nextResourceName: string, recordId?: string) {
    setResourceName(nextResourceName);
    setHandoff(recordId ? { resourceName: nextResourceName, recordId } : null);
    setEntityPage(1);
    setSelectedRecord(null);
    setUpsertOpen(false);
  }

  function closeUpsertDialog() {
    setUpsertOpen(false);
    setSelectedRecord(null);
  }

  useEffect(() => {
    if (!resourceName && resources[0]) {
      setResourceName(resources[0].name);
    }
  }, [resourceName, resources]);

  useEffect(() => {
    if (pagination && entityPage > pagination.pageCount) {
      setEntityPage(pagination.pageCount);
    }
  }, [entityPage, pagination]);

  return (
    <Paper
      elevation={0}
      sx={{
        ...surfaceSx({ shadow: true }),
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <Stack sx={{ gap: px(adminLayout.containerGap), minWidth: 0 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{
            alignItems: { xs: "stretch", md: "center" },
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="h2">Entity management</Typography>
            <Typography color="text.secondary">
              Generic tables and forms generated from the Prisma datamodel.
            </Typography>
          </Box>
          <Button onClick={refreshRecords} startIcon={<RefreshIcon />} variant="outlined">
            Refresh
          </Button>
        </Stack>

        <Box sx={surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.sm })}>
          <Tabs
            onChange={(_, nextValue: string) => openResource(nextValue)}
            scrollButtons="auto"
            sx={{
              minHeight: 56,
              "& .MuiTabs-indicator": {
                display: "none",
              },
              "& .MuiTabs-flexContainer": {
                gap: px(space.sm),
              },
              "& .MuiTab-root": {
                color: "text.secondary",
                minHeight: 56,
                px: px(space.lg),
              },
              "& .Mui-selected": {
                bgcolor: "background.paper",
                color: "primary.main",
              },
            }}
            value={resource?.name ?? false}
            variant="scrollable"
          >
            {resources.map((item) => (
              <Tab key={item.name} label={item.labelPlural} value={item.name} />
            ))}
          </Tabs>
        </Box>

        {error ? (
          <Alert severity="error">{error instanceof Error ? error.message : "Request failed"}</Alert>
        ) : null}

        {resource ? (
          <Box sx={{ display: "grid", gap: px(adminLayout.containerGap), minWidth: 0 }}>
            <Paper
              elevation={0}
              sx={{
                ...surfaceSx({ bgcolor: colors.surfaceMuted, level: radiusLevel.inner, padding: space.md }),
                minHeight: 520,
                minWidth: 0,
                overflow: "hidden",
                width: "100%",
              }}
            >
              <Stack spacing={2} sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between" }}>
                  <Typography variant="h3">{resource.labelPlural}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                      {entityView?.list?.summary
                        ?? (isLoading ? "Loading" : `${pagination?.total ?? records.length} total`)}
                    </Typography>
                    {resource.canCreate && !listLoadsOwnRecords ? (
                      <Button
                        onClick={() => {
                          setSelectedRecord(null);
                          setUpsertOpen(true);
                        }}
                        startIcon={<AddIcon />}
                        sx={{ borderRadius: controlRadiusPx(radiusLevel.embedded) }}
                        variant="contained"
                      >
                        Add
                      </Button>
                    ) : null}
                  </Stack>
                </Stack>
                {ListView ? (
                  <ListView
                    focusRecordId={handoff?.resourceName === resource.name ? handoff.recordId : null}
                    onEditRecord={(record) => {
                      setSelectedRecord(record);
                      setUpsertOpen(canOpenUpsertDialog);
                    }}
                    onOpenResource={openResource}
                    records={records}
                    resource={resource}
                    resources={resources}
                    session={session}
                  />
                ) : (
                  <>
                    <EntityTable
                      onSelectRecord={(record) => {
                        setSelectedRecord(record);

                        // A registered detail view owns the record interaction,
                        // so selecting a row reveals it instead of the dialog.
                        if (!DetailView) {
                          setUpsertOpen(canOpenUpsertDialog);
                        }
                      }}
                      records={records}
                      resource={resource}
                      selectedRecord={selectedFreshRecord}
                    />
                    {DetailView && selectedFreshRecord ? (
                      <DetailView
                        onEditRecord={() => setUpsertOpen(canOpenUpsertDialog)}
                        record={selectedFreshRecord}
                        resource={resource}
                        session={session}
                      />
                    ) : null}
                  </>
                )}
                {!listLoadsOwnRecords && pagination && pagination.pageCount > 1 ? (
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={1}
                    sx={{
                      alignItems: { xs: "stretch", sm: "center" },
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography color="text.secondary" sx={{ fontWeight: 800 }} variant="body2">
                      Page {pagination.page} of {pagination.pageCount}
                    </Typography>
                    <Pagination
                      color="primary"
                      count={pagination.pageCount}
                      onChange={(_, nextPage) => {
                        setEntityPage(nextPage);
                        setSelectedRecord(null);
                      }}
                      page={entityPage}
                    />
                  </Stack>
                ) : null}
              </Stack>
            </Paper>

            <AddOrEditEntityDialog
              onClose={closeUpsertDialog}
              {...(selectedFreshRecord && resource.canDelete ? {
                onDelete: async () => {
                  await deleteRecord();
                  setUpsertOpen(false);
                },
              } : {})}
              onSubmit={async (payload) => {
                if (selectedFreshRecord) {
                  await updateRecord(payload);
                } else {
                  await createRecord(payload);
                }

                setUpsertOpen(false);
              }}
              open={upsertOpen}
              record={selectedFreshRecord}
              resource={resource}
            />
          </Box>
        ) : !error ? (
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            Loading datamodel resources...
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
}
