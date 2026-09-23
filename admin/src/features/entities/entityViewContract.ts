// The contract between the generic entity viewer and the hand-built views that
// some resources need.
//
// The viewer renders tables and forms from Prisma datamodel metadata and knows
// nothing about any particular model. When a resource needs more than that, a
// component implementing one of these prop shapes is registered in
// entityViewRegistry.ts, which is the only module that maps resource names to
// components. Custom views live beside the other entity components and receive
// everything they need through these props.
//
// This file deliberately imports no components, so views can depend on the
// contract without creating a cycle back through the registry.
import type { AdminResource } from "@skate-route-mapper/shared/adminResources";
import type { ComponentType } from "react";
import type { AdminSession, EntityRecord } from "../../types";

/** Replaces the generic table for one resource. */
export type EntityListViewProps = {
  /**
   * Record handed over when another view navigated here, for example the ride
   * whose samples an admin asked to see. Null when the resource was opened directly.
   */
  focusRecordId: string | null;
  /** Opens the shared add/edit dialog for a record. */
  onEditRecord: (record: EntityRecord) => void;
  /** Switches the viewer to another resource, optionally handing over one record. */
  onOpenResource: (resourceName: string, recordId?: string) => void;
  /** The current page of records, empty when the view loads its own. */
  records: EntityRecord[];
  resource: AdminResource;
  /** Every resource the API exposes, for views that need to cross-reference. */
  resources: AdminResource[];
  session: AdminSession;
};

/** Rendered below the generic table for the selected record. */
export type EntityDetailViewProps = {
  /** Opens the shared add/edit dialog for this record. */
  onEditRecord: () => void;
  record: EntityRecord;
  resource: AdminResource;
  session: AdminSession;
};

export type EntityView = {
  list?: {
    component: ComponentType<EntityListViewProps>;
    /**
     * The view fetches its own records, so the viewer skips the generic list
     * query, its pagination, and the create button.
     */
    loadsOwnRecords?: boolean;
    /** Replaces the record count caption, which such a view has no number for. */
    summary?: string;
  };
  /**
   * Selecting a row reveals this instead of opening the edit dialog, so the view
   * can own the record interaction.
   */
  detail?: ComponentType<EntityDetailViewProps>;
};
