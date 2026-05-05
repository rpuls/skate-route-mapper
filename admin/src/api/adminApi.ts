import type { AdminResource } from "@skate-route-mapper/shared";
import { apiBaseUrl } from "../config";
import type { AdminSession, EntityPayload, EntityRecord } from "../types";

type LoginResponse = AdminSession & {
  ok: boolean;
  message?: string;
};

type ResourcesResponse = {
  resources?: AdminResource[];
  message?: string;
};

type EntityResponse = {
  items?: EntityRecord[];
  item?: EntityRecord;
  message?: string;
};

async function parseJson<T>(response: Response) {
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.message ?? "Request failed");
  }

  return body as T;
}

function authHeaders(session: AdminSession) {
  return {
    Authorization: `Bearer ${session.token}`,
    "Content-Type": "application/json",
  };
}

export async function loginAdmin(email: string, password: string) {
  const response = await fetch(`${apiBaseUrl}/v1/admin/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  return parseJson<LoginResponse>(response);
}

export async function listAdminResources(session: AdminSession) {
  const response = await fetch(`${apiBaseUrl}/v1/admin/resources`, {
    headers: authHeaders(session),
  });
  const body = await parseJson<ResourcesResponse>(response);

  return body.resources ?? [];
}

export async function listEntityRecords(session: AdminSession, resource: AdminResource) {
  const response = await fetch(`${apiBaseUrl}${resource.endpoint}`, {
    headers: authHeaders(session),
  });
  const body = await parseJson<EntityResponse>(response);

  return body.items ?? [];
}

export async function createEntityRecord(
  session: AdminSession,
  resource: AdminResource,
  payload: EntityPayload
) {
  const response = await fetch(`${apiBaseUrl}${resource.endpoint}`, {
    method: "POST",
    headers: authHeaders(session),
    body: JSON.stringify(payload),
  });
  const body = await parseJson<EntityResponse>(response);

  if (!body.item) {
    throw new Error("Create response did not include a record");
  }

  return body.item;
}

export async function updateEntityRecord(
  session: AdminSession,
  resource: AdminResource,
  recordId: string,
  payload: EntityPayload
) {
  const response = await fetch(`${apiBaseUrl}${resource.endpoint}/${recordId}`, {
    method: "PATCH",
    headers: authHeaders(session),
    body: JSON.stringify(payload),
  });
  const body = await parseJson<EntityResponse>(response);

  if (!body.item) {
    throw new Error("Update response did not include a record");
  }

  return body.item;
}

export async function deleteEntityRecord(
  session: AdminSession,
  resource: AdminResource,
  recordId: string
) {
  const response = await fetch(`${apiBaseUrl}${resource.endpoint}/${recordId}`, {
    method: "DELETE",
    headers: authHeaders(session),
  });

  await parseJson<{ ok?: boolean; message?: string }>(response);
}
