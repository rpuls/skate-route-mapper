export type AdminSession = {
  token: string;
  expiresAt: string;
  adminUser: {
    id: string;
    email: string;
  };
};

export type AdminView = "dashboard" | "entities";

export type EntityRecord = Record<string, unknown>;

export type EntityPayload = Record<string, string | boolean | null>;

export type EntityPagination = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};
