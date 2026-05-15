import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createEntityRecord,
  deleteEntityRecord,
  getAdminRideDetail,
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

export function useEntityRecords(
  session: AdminSession,
  resource: AdminResource | null,
  pagination = {
    page: 1,
    pageSize: 25,
  }
) {
  return useQuery({
    enabled: Boolean(resource),
    queryKey: resource
      ? queryKeys.entityRecords(resource.name, pagination.page, pagination.pageSize)
      : queryKeys.entityRecords("none", pagination.page, pagination.pageSize),
    queryFn: () => {
      if (!resource) {
        return {
          items: [],
          page: pagination.page,
          pageCount: 1,
          pageSize: pagination.pageSize,
          total: 0,
        };
      }

      return listEntityRecords(session, resource, pagination);
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useAdminRideDetail(session: AdminSession, rideId: string | null) {
  return useQuery({
    enabled: Boolean(rideId),
    queryKey: rideId ? queryKeys.rideDetail(rideId) : queryKeys.rideDetail("none"),
    queryFn: () => {
      if (!rideId) {
        throw new Error("No ride selected");
      }

      return getAdminRideDetail(session, rideId);
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
