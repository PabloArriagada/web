import type { Asset, CourseProject, ScormStandard, ValidationReport } from "@studio/schema";

export type ProjectSummary = { id: string; title: string; revision: number; updatedAt: string; createdAt: string; slideCount: number };
export type AssetUsage = { slideId: string; slideTitle: string; elementId: string | null; elementName: string };
export type AssetDto = Omit<Asset, "storageKey"> & { usage: AssetUsage[] };
export type PipelineStep = { name: string; ok: boolean; ms: number; detail?: string };
export type ProjectResponse = { project: CourseProject; revision: number; updatedAt?: string };
export type PreviewResponse = {
  buildId: string;
  revision: number;
  standard: ScormStandard;
  ok: boolean;
  launchUrl: string | null;
  report: ValidationReport;
  steps: PipelineStep[];
  files: Array<{ path: string; mime: string; size: number }>;
};
export type ValidateResponse = { ok: boolean; report: ValidationReport; steps: PipelineStep[]; files: number; totalBytes: number };
export type Publication = {
  id: string;
  projectId: string;
  standard: ScormStandard;
  profile: { id: string; name: string; standard: ScormStandard; lms: string };
  status: "queued" | "building" | "completed" | "failed";
  report: ValidationReport | null;
  steps: PipelineStep[] | null;
  size: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadUrl: string | null;
};
export type Version = { id: string; versionNumber: number; revision: number; kind: "manual" | "publication" | "restore-backup"; label: string | null; createdAt: string };
