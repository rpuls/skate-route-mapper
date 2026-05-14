import { Prisma } from "../../../generated/prisma/index.js";
import type { AdminResource, AdminResourceField } from "@skate-route-mapper/shared/adminResources";

type RuntimeField = {
  name: string;
  kind: "scalar" | "object" | "enum" | "unsupported";
  type: string;
  isId: boolean;
  isList: boolean;
  isReadOnly: boolean;
  isRequired: boolean;
  hasDefaultValue: boolean;
  isUpdatedAt: boolean;
};

type RuntimeModel = {
  name: string;
  fields: readonly RuntimeField[];
};

const hiddenFieldsByModel: Record<string, string[]> = {
  AdminSession: ["tokenHash"],
  AdminUser: ["passwordHash"],
  User: ["passwordHash"],
  UserSession: ["tokenHash"],
};

const readOnlyModels = new Set([
  "AdminSession",
  "SyncOperation",
  "User",
  "UserSession",
]);

function sentenceCase(value: string) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
}

function pluralize(value: string) {
  return value.endsWith("s") ? value : `${value}s`;
}

function modelResourceName(modelName: string) {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}s`;
}

function delegateName(modelName: string) {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
}

function getEnumOptions(enumName: string) {
  const runtimeEnum = Prisma.dmmf.datamodel.enums.find((item) => item.name === enumName);
  return runtimeEnum?.values.map((value) => value.name) ?? [];
}

function fieldType(field: RuntimeField): AdminResourceField["type"] {
  if (field.kind === "enum") {
    return "enum";
  }

  if (field.name.toLowerCase().includes("email")) {
    return "email";
  }

  if (field.type === "Boolean") {
    return "boolean";
  }

  if (field.type === "DateTime") {
    return "datetime";
  }

  if (field.type === "Int" || field.type === "Float" || field.type === "Decimal") {
    return "number";
  }

  if (field.type === "BigInt") {
    return "bigint";
  }

  return "string";
}

function isFieldWritable(model: RuntimeModel, field: RuntimeField) {
  if (readOnlyModels.has(model.name)) {
    return false;
  }

  return !field.isId && !field.isReadOnly && !field.isUpdatedAt;
}

function isFieldCreatable(model: RuntimeModel, field: RuntimeField) {
  if (readOnlyModels.has(model.name) || field.isReadOnly || field.isUpdatedAt) {
    return false;
  }

  return !field.hasDefaultValue || (field.isId && !field.hasDefaultValue);
}

function toResourceField(model: RuntimeModel, field: RuntimeField): AdminResourceField | null {
  if (field.kind === "object" || field.isList) {
    return null;
  }

  if (hiddenFieldsByModel[model.name]?.includes(field.name)) {
    return null;
  }

  const type = fieldType(field);
  const writable = isFieldWritable(model, field);

  const list = !(model.name === "SyncOperation" && field.name === "payload");

  const resourceField: AdminResourceField = {
    name: field.name,
    label: sentenceCase(field.name),
    type,
    list,
    create: isFieldCreatable(model, field),
    edit: writable,
    required: field.isRequired && !field.hasDefaultValue,
  };

  if (type === "enum") {
    resourceField.options = getEnumOptions(field.type);
  }

  return resourceField;
}

function datamodelModels() {
  return Prisma.dmmf.datamodel.models as unknown as readonly RuntimeModel[];
}

function withPolicyFields(model: RuntimeModel, fields: AdminResourceField[]) {
  if (model.name !== "AdminUser") {
    return fields;
  }

  const passwordField: AdminResourceField = {
    name: "password",
    label: "Password",
    type: "password",
    create: true,
    edit: true,
    required: true,
  };

  const createdIndex = fields.findIndex((field) => field.name === "createdAt");

  if (createdIndex === -1) {
    return [...fields, passwordField];
  }

  return [
    ...fields.slice(0, createdIndex),
    passwordField,
    ...fields.slice(createdIndex),
  ];
}

export function getAdminResources() {
  const models = datamodelModels();

  return models.map((model) => {
    const idField = model.fields.find((field) => field.isId)?.name ?? "id";
    const fields = withPolicyFields(
      model,
      model.fields
        .map((field) => toResourceField(model, field))
        .filter((field): field is AdminResourceField => Boolean(field))
    );

    const canCreate = fields.some((field) => field.create);
    const canDelete = !readOnlyModels.has(model.name);
    const canEdit = fields.some((field) => field.edit);

    return {
      name: modelResourceName(model.name),
      label: sentenceCase(model.name),
      labelPlural: pluralize(sentenceCase(model.name)),
      idField,
      endpoint: `/v1/admin/entities/${modelResourceName(model.name)}`,
      canCreate,
      canDelete,
      canEdit,
      fields,
    } satisfies AdminResource;
  });
}

export function getAdminResource(resourceName: string) {
  const resource = getAdminResources().find((item) => item.name === resourceName);

  if (!resource) {
    return null;
  }

  const modelName = datamodelModels()
    .find((model) => modelResourceName(model.name) === resourceName)?.name;

  if (!modelName) {
    return null;
  }

  return {
    resource,
    modelName,
    delegateName: delegateName(modelName),
  };
}
