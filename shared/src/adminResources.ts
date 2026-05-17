export type AdminResourceField = {
  name: string;
  label: string;
  type: "bigint" | "boolean" | "datetime" | "email" | "enum" | "json" | "number" | "password" | "string";
  create?: boolean;
  edit?: boolean;
  list?: boolean;
  options?: string[];
  required?: boolean;
};

export type AdminResource = {
  name: string;
  label: string;
  labelPlural: string;
  idField: string;
  endpoint: string;
  canCreate: boolean;
  canDelete: boolean;
  canEdit: boolean;
  fields: AdminResourceField[];
};
