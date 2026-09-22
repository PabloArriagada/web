import type { CourseProject, ScormStandard } from "@studio/schema";
import { request, uploadFiles } from "./client.js";
import type { AssetDto, PreviewResponse, ProjectResponse, ProjectSummary, Publication, ValidateResponse, Version } from "./types.js";

export const api = {
  listProjects: () => request<{ projects: ProjectSummary[] }>("GET", "/api/projects"),
  createProject: (title: string, template: "blank" | "qa" = "blank") => request<ProjectResponse>("POST", "/api/projects", { title, template }),
  getProject: (id: string) => request<ProjectResponse>("GET", `/api/projects/${id}`),
  saveProject: (project: CourseProject, baseRevision: number) =>
    request<{ revision: number; updatedAt: string }>("PUT", `/api/projects/${project.id}`, { project, baseRevision }),
  deleteProject: (id: string) => request<void>("DELETE", `/api/projects/${id}`),
  validate: (id: string, standard: ScormStandard) => request<ValidateResponse>("POST", `/api/projects/${id}/validate`, { standard }),
  preview: (id: string, standard: ScormStandard) => request<PreviewResponse>("POST", `/api/projects/${id}/preview`, { standard }),
  listAssets: (id: string) => request<{ assets: AssetDto[] }>("GET", `/api/projects/${id}/assets`),
  uploadAssets: (id: string, files: File[], onProgress: (f: number) => void, signal?: AbortSignal) =>
    uploadFiles<{ results: Array<{ asset: AssetDto; duplicate: boolean; filename: string }> }>(`/api/projects/${id}/assets`, files, onProgress, signal),
  deleteAsset: (id: string, assetId: string) => request<void>("DELETE", `/api/projects/${id}/assets/${assetId}`),
  publish: (id: string, profileId: string) => request<{ publication: Publication }>("POST", `/api/projects/${id}/publications`, { profileId }),
  listPublications: (id: string) => request<{ publications: Publication[] }>("GET", `/api/projects/${id}/publications`),
  getPublication: (pubId: string) => request<{ publication: Publication }>("GET", `/api/publications/${pubId}`),
  listVersions: (id: string) => request<{ versions: Version[] }>("GET", `/api/projects/${id}/versions`),
  createVersion: (id: string, label: string) => request<{ version: Version }>("POST", `/api/projects/${id}/versions`, { label }),
  restoreVersion: (id: string, versionId: string) => request<ProjectResponse>("POST", `/api/projects/${id}/versions/${versionId}/restore`),
};

export const assetContentUrl = (projectId: string, assetId: string) => `/api/projects/${projectId}/assets/${assetId}/content`;
