// Design-system entry for the claude.ai/design sync.
// Re-exports the real admin components and brand theme; adds nothing new.
export { DesignSystemProvider } from "./DesignSystemProvider";

export { PageCard } from "../admin/src/components/common/PageCard";
export { AdminShell } from "../admin/src/components/layout/AdminShell";

export { EntityTable } from "../admin/src/components/entities/EntityTable";
export { EntityForm } from "../admin/src/components/entities/EntityForm";
export { AddOrEditEntityDialog } from "../admin/src/components/entities/AddOrEditEntityDialog";
export { RidesExplorer } from "../admin/src/components/entities/RidesExplorer";
export { SamplesExplorer } from "../admin/src/components/entities/SamplesExplorer";
export { RideAnalysisPanel } from "../admin/src/components/entities/RideAnalysisPanel";
export { ResearchCaptureInspector } from "../admin/src/components/entities/ResearchCaptureInspector";

export {
  LiveAccelerationChart,
  ResearchRecordingChart,
} from "../admin/src/components/hardware/HardwareCharts";

export {
  ChartLegend,
  PowerSpectrumChart,
  RawAccelerationChart,
  SpectrogramChart,
  WindowRmsChart,
} from "../admin/src/components/research/ResearchSignalCharts";

export {
  adminTheme,
  controlRadiusPx,
  px,
  radiusForLevel,
  radiusLevel,
  radiusPx,
  surfaceSx,
  tileShadow,
} from "../admin/src/theme/adminTheme";
