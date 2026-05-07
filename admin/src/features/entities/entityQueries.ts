import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEntityRecord,
  deleteEntityRecord,
  listAdminResources,
  listEntityRecords,
  updateEntityRecord,
} from "../../api/adminApi";
import { queryKeys } from "../../query/queryKeys";
import type { AdminSession, EntityPayload } from "../../types";

export function useAdminResources(session: AdminSession) {
  return useQuery({
    queryKey: queryKeys.adminResources,
    queryFn: () => listAdminResources(session),
    staleTime: 10 * 60 * 1000,
  });
}

export function useEntityRecords(session: AdminSession, resource: AdminResource | null) {
  return useQuery({
    enabled: Boolean(resource),
    queryKey: resource ? queryKeys.entityRecords(resource.name) : queryKeys.entityRecords("none"),
    queryFn: () => {
      if (!resource) {
        return [];
      }

      return listEntityRecords(session, resource);
    },
  });
}

export function useCreateEntityRecord(session: AdminSession, resource: AdminResource | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EntityPayload) => {
      if (!resource) {
        throw new Error("No admin resource selected");
      }

      return createEntityRecord(session, resource, payload);
    },
    onSuccess: async () => {
      if (resource) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.entityRecords(resource.name),
        });
      }
    },
  });
}

export function useUpdateEntityRecord(session: AdminSession, resource: AdminResource | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EntityPayload }) => {
      if (!resource) {
        throw new Error("No admin resource selected");
      }

      return updateEntityRecord(session, resource, id, payload);
    },
    onSuccess: async () => {
      if (resource) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.entityRecords(resource.name),
        });
      }
    },
  });
}

export function useDeleteEntityRecord(session: AdminSession, resource: AdminResource | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (!resource) {
        throw new Error("No admin resource selected");
      }

      return deleteEntityRecord(session, resource, id);
    },
    onSuccess: async () => {
      if (resource) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.entityRecords(resource.name),
        });
      }
    },
  });
}
