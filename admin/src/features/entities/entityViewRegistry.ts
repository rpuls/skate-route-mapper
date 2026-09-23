// The one place that maps a datamodel resource to a hand-built view.
//
// Everything else stays generic: the entity viewer asks this registry whether a
// resource has a custom view and renders whatever comes back, so adding, moving,
// or dropping a special view is a change to this file alone. Nothing here leaks
// back into the viewer.
import { ResearchCaptureInspector } from "../../components/entities/ResearchCaptureInspector";
import { RidesExplorer } from "../../components/entities/RidesExplorer";
import { SamplesExplorer } from "../../components/entities/SamplesExplorer";
import type { EntityView } from "./entityViewContract";

const entityViews: Record<string, EntityView> = {
  rides: {
    list: { component: RidesExplorer },
  },
  samples: {
    // Sample tables run to millions of rows, so this view filters server-side by
    // user and ride instead of paging the generic list.
    list: {
      component: SamplesExplorer,
      loadsOwnRecords: true,
      summary: "Filter by user and ride",
    },
  },
  researchCaptures: {
    detail: ResearchCaptureInspector,
  },
};

export function entityViewFor(resourceName: string | null | undefined): EntityView | null {
  if (!resourceName) {
    return null;
  }

  return entityViews[resourceName] ?? null;
}
