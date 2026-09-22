import { ASSET_URI_PREFIX, type AssetType } from "./model.js";

/** Construye la URI interna de un asset. */
export function assetUri(assetId: string): string {
  return `${ASSET_URI_PREFIX}${assetId}`;
}

/** Devuelve el id si la cadena es exactamente una URI de asset. */
export function parseAssetUri(value: string): string | null {
  if (!value.startsWith(ASSET_URI_PREFIX)) return null;
  const id = value.slice(ASSET_URI_PREFIX.length);
  return /^[a-z]{2,4}_[a-z0-9]{8,32}$/.test(id) ? id : null;
}

/** Busca todas las URIs de asset dentro de un texto (JSON, HTML, CSS, SVG). */
export const ASSET_URI_GLOBAL_RE = /asset:\/\/([a-z]{2,4}_[a-z0-9]{8,32})/g;

export function findAssetIdsInText(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(ASSET_URI_GLOBAL_RE)) if (m[1]) ids.add(m[1]);
  return [...ids];
}

/** Recorre cualquier valor JSON y reúne las URIs de asset referenciadas. */
export function collectAssetRefs(value: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const id of findAssetIdsInText(v)) ids.add(id);
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(value);
  return ids;
}

/** Reemplaza (en profundidad, sin mutar) las URIs de asset usando `resolve`. */
export function rewriteAssetRefs<T>(value: T, resolve: (assetId: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      return v.replace(ASSET_URI_GLOBAL_RE, (_m, id: string) => resolve(id));
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, item] of Object.entries(v)) out[k] = walk(item);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

type MimeInfo = { type: AssetType; ext: string; folder: string };

/**
 * Tipos MIME aceptados por el Asset Manager. Cualquier otro se rechaza:
 * evita subir ejecutables o formatos que el runtime no sabe reproducir.
 */
export const MIME_TABLE: Record<string, MimeInfo> = {
  "image/png": { type: "image", ext: "png", folder: "images" },
  "image/jpeg": { type: "image", ext: "jpg", folder: "images" },
  "image/gif": { type: "image", ext: "gif", folder: "images" },
  "image/webp": { type: "image", ext: "webp", folder: "images" },
  "image/avif": { type: "image", ext: "avif", folder: "images" },
  "image/svg+xml": { type: "svg", ext: "svg", folder: "images" },
  "video/mp4": { type: "video", ext: "mp4", folder: "video" },
  "video/webm": { type: "video", ext: "webm", folder: "video" },
  "audio/mpeg": { type: "audio", ext: "mp3", folder: "audio" },
  "audio/mp4": { type: "audio", ext: "m4a", folder: "audio" },
  "audio/ogg": { type: "audio", ext: "ogg", folder: "audio" },
  "audio/wav": { type: "audio", ext: "wav", folder: "audio" },
  "audio/webm": { type: "audio", ext: "weba", folder: "audio" },
  "font/woff2": { type: "font", ext: "woff2", folder: "fonts" },
  "font/woff": { type: "font", ext: "woff", folder: "fonts" },
  "font/ttf": { type: "font", ext: "ttf", folder: "fonts" },
  "font/otf": { type: "font", ext: "otf", folder: "fonts" },
  "application/pdf": { type: "document", ext: "pdf", folder: "documents" },
  "text/vtt": { type: "caption", ext: "vtt", folder: "captions" },
  "text/plain": { type: "transcript", ext: "txt", folder: "documents" },
};

const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TABLE).map(([mime, info]) => [info.ext, mime]),
);
EXT_TO_MIME["jpeg"] = "image/jpeg";
EXT_TO_MIME["mpeg"] = "audio/mpeg";

export function mimeFromFilename(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

export function mimeInfo(mime: string): MimeInfo | null {
  return MIME_TABLE[mime.toLowerCase().split(";")[0]!.trim()] ?? null;
}

/** Nombre de archivo seguro para el paquete: minúsculas, sin espacios. */
export function safeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-\./g, ".")
    .replace(/\.-/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "");
  return cleaned.slice(0, 120) || "archivo";
}

/** Ruta relativa canónica de un asset dentro del paquete publicado. */
export function packagePathForAsset(asset: { id: string; mimeType: string }): string {
  const info = mimeInfo(asset.mimeType);
  if (!info) throw new Error(`Tipo MIME no publicable: ${asset.mimeType}`);
  return `assets/${info.folder}/${asset.id}.${info.ext}`;
}

/**
 * Detecta referencias que NUNCA deben terminar en un paquete publicado:
 * blob:, data:, localhost, 127.0.0.1 y URLs firmadas que expiran.
 */
export const FORBIDDEN_URL_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bblob:/i, reason: "URL blob: (solo existe en la sesión del navegador)" },
  { re: /\bdata:[a-z]+\/[a-z0-9.+-]+;base64,/i, reason: "Data URL Base64 incrustada" },
  { re: /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i, reason: "URL de localhost" },
  { re: /[?&](?:X-Amz-Signature|X-Amz-Credential|Signature|Expires)=/i, reason: "URL firmada temporal" },
  { re: /\/api\/assets\//i, reason: "URL de la API del editor" },
];

export function findForbiddenUrls(text: string): string[] {
  const reasons: string[] = [];
  for (const { re, reason } of FORBIDDEN_URL_PATTERNS) if (re.test(text)) reasons.push(reason);
  return reasons;
}
