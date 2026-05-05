import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import { hashPassword } from "../../auth/passwords.js";
import { prisma } from "../../db/prisma.js";

function serializeEntityValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(serializeEntityValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, serializeEntityValue(entryValue)])
    );
  }

  return value;
}

function getDelegate(delegate: string) {
  const prismaRecord = prisma as unknown as Record<string, unknown>;
  const modelDelegate = prismaRecord[delegate];

  if (!modelDelegate || typeof modelDelegate !== "object") {
    throw new Error("Admin resource not found");
  }

  return modelDelegate as {
    create: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<unknown[]>;
    update: (args: unknown) => Promise<unknown>;
  };
}

function selectVisibleFields(resource: AdminResource) {
  return Object.fromEntries(
    resource.fields
      .filter((field) => field.list && field.name !== "password")
      .map((field) => [field.name, true])
  );
}

function coerceEntityValue(value: unknown, field: AdminResource["fields"][number]) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (field.type === "boolean") {
    return Boolean(value);
  }

  if (field.type === "number") {
    return Number(value);
  }

  if (field.type === "bigint") {
    return BigInt(String(value));
  }

  if (field.type === "datetime") {
    return new Date(String(value));
  }

  return String(value);
}

function buildEntityData(resource: AdminResource, payload: Record<string, unknown>, mode: "create" | "edit") {
  const data = resource.fields.reduce<Record<string, unknown>>((nextData, field) => {
    const canWrite = mode === "create" ? field.create : field.edit;

    if (!canWrite || field.name === "password" || !(field.name in payload)) {
      return nextData;
    }

    nextData[field.name] = coerceEntityValue(payload[field.name], field);
    return nextData;
  }, {});

  if (resource.name === "adminUsers" && typeof payload.password === "string" && payload.password.length > 0) {
    if (payload.password.length < 12) {
      throw new Error("Admin password must be at least 12 characters");
    }

    data.passwordHash = hashPassword(payload.password);
  }

  if (resource.name === "adminUsers" && mode === "create" && typeof data.passwordHash !== "string") {
    throw new Error("Admin password must be at least 12 characters");
  }

  return data;
}

function coerceEntityId(resource: AdminResource, rawId: string) {
  const idField = resource.fields.find((field) => field.name === resource.idField);

  if (idField?.type === "bigint") {
    return BigInt(rawId);
  }

  if (idField?.type === "number") {
    return Number(rawId);
  }

  return rawId;
}

export async function listAdminEntity(resource: AdminResource, delegate: string) {
  const items = await getDelegate(delegate).findMany({
    orderBy: {
      [resource.idField]: "desc",
    },
    select: selectVisibleFields(resource),
    take: 100,
  });

  return items.map((item) => serializeEntityValue(item));
}

export async function createAdminEntity(
  resource: AdminResource,
  delegate: string,
  payload: Record<string, unknown>
) {
  const item = await getDelegate(delegate).create({
    data: buildEntityData(resource, payload, "create"),
    select: selectVisibleFields(resource),
  });

  return serializeEntityValue(item);
}

export async function updateAdminEntity(
  resource: AdminResource,
  delegate: string,
  rawId: string,
  payload: Record<string, unknown>
) {
  const item = await getDelegate(delegate).update({
    where: {
      [resource.idField]: coerceEntityId(resource, rawId),
    },
    data: buildEntityData(resource, payload, "edit"),
    select: selectVisibleFields(resource),
  });

  return serializeEntityValue(item);
}

export async function deleteAdminEntity(
  resource: AdminResource,
  delegate: string,
  rawId: string
) {
  await getDelegate(delegate).delete({
    where: {
      [resource.idField]: coerceEntityId(resource, rawId),
    },
  });
}
