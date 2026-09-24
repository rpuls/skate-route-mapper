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
    count: () => Promise<number>;
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
  if (value === null || value === undefined) {
    return null;
  }

  // An emptied box means null for a column that accepts one. A required text
  // column cannot hold null, so there it means the empty string instead: an
  // administrator clearing a research note is asking for a blank note, not for
  // a write that the database rejects.
  if (value === "") {
    return field.required && (field.type === "string" || field.type === "email") ? "" : null;
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

  const passwordMinimum = resource.name === "adminUsers"
    ? 12
    : resource.name === "users"
      ? 8
      : null;

  if (passwordMinimum && typeof payload.password === "string" && payload.password.length > 0) {
    if (payload.password.length < passwordMinimum) {
      throw new Error(`Password must be at least ${passwordMinimum} characters`);
    }

    data.passwordHash = hashPassword(payload.password);
  }

  if (passwordMinimum && mode === "create" && typeof data.passwordHash !== "string") {
    throw new Error(`Password must be at least ${passwordMinimum} characters`);
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

export type AdminEntitySort = {
  field: string;
  direction: "asc" | "desc";
};

/**
 * Column ordering for a generic list.
 *
 * The field name arrives from a browser and goes straight into a Prisma
 * `orderBy`, so it is matched against the datamodel rather than trusted: only a
 * field the resource actually lists can be sorted on, and anything else falls
 * back to the id ordering the viewer has always used. Prisma sorts each column
 * in its own type, so dates order chronologically, numbers numerically and text
 * by the database collation without the caller saying which is which.
 *
 * The id is appended as a tie-breaker. Without it a column full of duplicates —
 * a category, a vehicle type — leaves the row order undefined, and paging
 * through such a list can repeat and skip records.
 */
function entityOrderBy(resource: AdminResource, sort: AdminEntitySort | null | undefined) {
  const isSortable = Boolean(
    sort && resource.fields.some((field) => field.list && field.name === sort.field)
  );

  if (!sort || !isSortable) {
    return { [resource.idField]: "desc" };
  }

  if (sort.field === resource.idField) {
    return { [sort.field]: sort.direction };
  }

  return [
    { [sort.field]: sort.direction },
    { [resource.idField]: "desc" },
  ];
}

export async function listAdminEntity(
  resource: AdminResource,
  delegate: string,
  options: {
    page: number;
    pageSize: number;
    sort?: AdminEntitySort | null;
  }
) {
  const modelDelegate = getDelegate(delegate);
  const [items, total] = await Promise.all([
    modelDelegate.findMany({
      orderBy: entityOrderBy(resource, options.sort),
      select: selectVisibleFields(resource),
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
    modelDelegate.count(),
  ]);

  return {
    items: items.map((item) => serializeEntityValue(item)),
    page: options.page,
    pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
    pageSize: options.pageSize,
    total,
  };
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
