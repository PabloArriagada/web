import type { Asset, CourseProject, PublicationProfile, RuntimeCourse, ScormStandard, ValidationIssue, ValidationReport } from "@studio/schema";

/** Contenido de un archivo del paquete: bytes en memoria o un asset en el almacenamiento. */
export type EntrySource =
  | { kind: "inline"; data: Uint8Array }
  | { kind: "asset"; storageKey: string; size: number; hash: string };

export type PackageEntry = {
  /** Ruta relativa POSIX dentro del paquete (sin "./" ni "/" inicial). */
  path: string;
  mime: string;
  source: EntrySource;
  /** Comprimir con deflate (texto) o almacenar tal cual (media ya comprimida). */
  compress: boolean;
};

/** Acceso de solo lectura al almacenamiento de objetos. */
export type AssetReader = {
  /** Tamaño en bytes o null si no existe. */
  stat(storageKey: string): Promise<number | null>;
  read(storageKey: string): AsyncIterable<Uint8Array>;
};

export type RuntimeBundle = { js: Uint8Array; css: Uint8Array; version: string; jsSha256: string };

export type FontFile = { family: string; weight: number; style: "normal" | "italic"; filename: string; unicodeRange?: string; data: Uint8Array };

export type PipelineStep = { name: string; ok: boolean; ms: number; detail?: string };

export type BuildOptions = {
  standard: ScormStandard;
  profile: PublicationProfile;
  runtime: RuntimeBundle;
  fonts: FontFile[];
  reader: AssetReader;
  generator?: { name: string; version: string };
  now?: Date;
  /** Identificador de versión del proyecto (trazabilidad). */
  versionId?: string;
};

export type BuildResult = {
  ok: boolean;
  entries: PackageEntry[];
  report: ValidationReport;
  steps: PipelineStep[];
  snapshotHash: string;
  course: RuntimeCourse;
  launch: string;
  totalBytes: number;
};

export type ProjectManifest = {
  format: "studio-native-package";
  formatVersion: 1;
  generator: { name: string; version: string };
  runtimeVersion: string;
  schemaVersion: string;
  projectId: string;
  versionId?: string;
  title: string;
  standard: ScormStandard;
  profile: PublicationProfile;
  snapshotHash: string;
  builtAt: string;
  assets: Array<Omit<Asset, "storageKey"> & { packagePath: string }>;
  /** Proyecto editable completo (URIs asset:// intactas) para round-trip. */
  project: CourseProject;
};

export type { ValidationIssue };
