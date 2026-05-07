import type {
  AdminResource,
  AdminResourceField,
} from "@skate-route-mapper/shared/adminResources";
import type { EntityPayload, EntityRecord } from "../../types";

export type EntityFormState = Record<string, string | boolean>;

function toDateTimeLocalValue(value: unknown) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
}

function formValue(field: AdminResourceField, value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  if (field.type === "datetime") {
    return toDateTimeLocalValue(value);
  }

  return String(value);
}

export function buildInitialFormState(
  resource: AdminResource,
  mode: "create" | "edit",
  record?: EntityRecord
) {
  return resource.fields.reduce<EntityFormState>((state, field) => {
    const isIncluded = mode === "create" ? field.create : field.edit;

    if (!isIncluded) {
      return state;
    }

    if (field.type === "boolean") {
      state[field.name] = typeof record?.[field.name] === "boolean" ? Boolean(record[field.name]) : true;
      return state;
    }

    state[field.name] = formValue(field, record?.[field.name]);
    return state;
  }, {});
}

export function buildPayload(
  resource: AdminResource,
  formState: EntityFormState,
  mode: "create" | "edit"
) {
  return resource.fields.reduce<EntityPayload>((payload, field) => {
    const isIncluded = mode === "create" ? field.create : field.edit;

    if (!isIncluded) {
      return payload;
    }

    const value = formState[field.name];

    if (field.type === "password" && mode === "edit" && value === "") {
      return payload;
    }

    if (field.type === "boolean") {
      payload[field.name] = Boolean(value);
      return payload;
    }

    if (value === "" && !field.required) {
      payload[field.name] = null;
      return payload;
    }

    payload[field.name] = String(value);
    return payload;
  }, {});
}

export function inputType(fieldType: string) {
  if (fieldType === "password") {
    return "password";
  }

  if (fieldType === "email") {
    return "email";
  }

  if (fieldType === "number" || fieldType === "bigint") {
    return "number";
  }

  if (fieldType === "datetime") {
    return "datetime-local";
  }

  return "text";
}
