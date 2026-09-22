/**
 * Validador de la publicación: se ejecuta sobre la lista final de archivos
 * del paquete ANTES de generar el ZIP. Un error bloquea la descarga.
 */
import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { findForbiddenUrls, type ScormStandard, type ValidationIssue } from "@studio/schema";
import type { PackageEntry } from "./types.js";

const dec = new TextDecoder();

/** Extensiones permitidas en un paquete y su MIME esperado. */
export const PACKAGE_MIME_BY_EXT: Record<string, string[]> = {
  html: ["text/html"],
  js: ["text/javascript", "application/javascript"],
  css: ["text/css"],
  json: ["application/json"],
  xml: ["application/xml", "text/xml"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  avif: ["image/avif"],
  svg: ["image/svg+xml"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mp3: ["audio/mpeg"],
  m4a: ["audio/mp4"],
  ogg: ["audio/ogg"],
  wav: ["audio/wav"],
  weba: ["audio/webm"],
  woff2: ["font/woff2"],
  woff: ["font/woff"],
  ttf: ["font/ttf"],
  otf: ["font/otf"],
  pdf: ["application/pdf"],
  vtt: ["text/vtt"],
  txt: ["text/plain"],
};

const SAFE_PATH_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const TEXT_EXT = new Set(["html", "js", "css", "json", "xml", "svg", "vtt", "txt"]);

function ext(path: string): string {
  const base = path.split("/").pop() ?? "";
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i + 1).toLowerCase() : "";
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(0, i) : "";
}

/** Resuelve una referencia relativa (sin query/hash) respecto a `baseDir`. */
export function resolveRelative(baseDir: string, ref: string): string | null {
  const clean = ref.split(/[?#]/)[0] ?? "";
  if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith("/") || clean.startsWith("//")) return null;
  const parts = baseDir ? baseDir.split("/") : [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return "../" + clean; // escapa del paquete
      parts.pop();
    } else parts.push(decodeURIComponent(seg));
  }
  return parts.join("/");
}

export function validatePackage(
  entries: PackageEntry[],
  opts: { launch: string; runtimeSha256?: string; standard: ScormStandard },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string) => issues.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => issues.push({ severity: "warning", code, message });

  const byPath = new Map<string, PackageEntry>();
  const lower = new Map<string, string>();
  for (const e of entries) {
    if (byPath.has(e.path)) err("pkg-duplicate", `Archivo duplicado en el paquete: ${e.path}`);
    byPath.set(e.path, e);
    const l = e.path.toLowerCase();
    const prev = lower.get(l);
    if (prev && prev !== e.path) err("pkg-case-collision", `"${prev}" y "${e.path}" solo difieren en mayúsculas/minúsculas (falla en LMS sobre Linux/Windows)`);
    lower.set(l, e.path);
    if (!SAFE_PATH_RE.test(e.path) || e.path.split("/").some((s) => s === ".." || s === ".")) {
      err("pkg-unsafe-path", `Ruta no segura o no portable: ${e.path}`);
    }
    if (e.path !== e.path.toLowerCase()) warn("pkg-uppercase", `La ruta ${e.path} contiene mayúsculas`);
    if (e.path.length > 200) warn("pkg-long-path", `Ruta demasiado larga (${e.path.length}): ${e.path}`);
    const x = ext(e.path);
    const allowed = PACKAGE_MIME_BY_EXT[x];
    if (!allowed) err("pkg-mime", `Extensión no permitida en el paquete: ${e.path}`);
    else if (!allowed.includes(e.mime)) err("pkg-mime", `MIME ${e.mime} no corresponde a la extensión de ${e.path}`);
    if (e.source.kind === "inline" && e.source.data.length === 0) warn("pkg-empty-file", `Archivo vacío: ${e.path}`);
  }
  const has = (p: string) => byPath.has(p);
  const readText = (p: string): string | null => {
    const e = byPath.get(p);
    return e && e.source.kind === "inline" ? dec.decode(e.source.data) : null;
  };

  // ---- Manifest ----
  const manifest = readText("imsmanifest.xml");
  if (manifest === null) {
    err("manifest-missing", "Falta imsmanifest.xml en la raíz del paquete");
  } else {
    const wellFormed = XMLValidator.validate(manifest);
    if (wellFormed !== true) {
      err("manifest-xml", `imsmanifest.xml no es XML válido: ${wellFormed.err.msg} (línea ${wellFormed.err.line})`);
    } else {
      const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: (name) => ["file", "resource", "item", "organization"].includes(name) }).parse(manifest) as Record<string, any>;
      const m = doc["manifest"];
      const schemaversion = String(m?.metadata?.schemaversion ?? "");
      const expected = opts.standard === "scorm12" ? "1.2" : "2004 4th Edition";
      if (schemaversion !== expected) err("manifest-version", `schemaversion "${schemaversion}" no corresponde a ${expected}`);
      const orgs = m?.organizations;
      const orgList: any[] = orgs?.organization ?? [];
      if (!orgs?.["@default"] || !orgList.some((o) => o["@identifier"] === orgs["@default"])) {
        err("manifest-org", "La organización por defecto no existe en el manifest");
      }
      const resources: any[] = m?.resources?.resource ?? [];
      const resIds = new Set(resources.map((r) => r["@identifier"]));
      for (const o of orgList) for (const it of o.item ?? []) {
        if (it["@identifierref"] && !resIds.has(it["@identifierref"])) err("manifest-ref", `El item ${it["@identifier"]} referencia un recurso inexistente`);
      }
      const sco = resources.find((r) => (r["@adlcp:scormtype"] ?? r["@adlcp:scormType"]) === "sco");
      if (!sco) err("manifest-sco", "El manifest no declara ningún recurso SCO");
      else {
        const href = String(sco["@href"] ?? "");
        if (href !== opts.launch) err("manifest-launch", `El launch del manifest (${href}) no es ${opts.launch}`);
        if (!has(href)) err("launch-missing", `El archivo de lanzamiento ${href} no existe`);
      }
      const listed = new Set<string>();
      for (const r of resources) for (const f of r.file ?? []) listed.add(String(f["@href"]));
      for (const f of listed) if (!has(f)) err("manifest-file-missing", `El manifest declara ${f} pero no está en el paquete`);
      for (const p of byPath.keys()) if (p !== "imsmanifest.xml" && !listed.has(p)) warn("manifest-file-unlisted", `${p} no está declarado en el manifest`);
    }
  }

  // ---- Launch HTML: referencias src/href ----
  const html = readText(opts.launch);
  if (html !== null) {
    for (const mt of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
      const target = resolveRelative("", mt[1]!);
      if (target === null) {
        err("html-external", `${opts.launch} referencia un recurso externo: ${mt[1]}`);
      } else if (!has(target)) err("html-ref-missing", `${opts.launch} referencia ${mt[1]}, que no existe`);
    }
    if (!/runtime\/runtime\.js/.test(html)) err("runtime-missing", "El launch no carga runtime/runtime.js");
  }

  // ---- CSS: url(...) ----
  for (const [p] of byPath) {
    if (ext(p) !== "css") continue;
    const css = readText(p);
    if (css === null) continue;
    for (const mt of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
      const ref = mt[2]!;
      if (ref.startsWith("data:")) continue;
      const target = resolveRelative(dirOf(p), ref);
      if (target === null) err("css-external", `${p} referencia un recurso externo: ${ref}`);
      else if (!has(target)) err("css-ref-missing", `${p} referencia ${ref}, que no existe`);
    }
  }

  // ---- Runtime ----
  const rt = byPath.get("runtime/runtime.js");
  if (!rt) err("runtime-missing", "Falta runtime/runtime.js");
  else if (opts.runtimeSha256 && rt.source.kind === "inline") {
    const sha = createHash("sha256").update(rt.source.data).digest("hex");
    if (sha !== opts.runtimeSha256) err("runtime-hash", "runtime/runtime.js no coincide con el bundle compilado");
  }
  if (!has("styles/runtime.css")) err("runtime-missing", "Falta styles/runtime.css");

  // ---- Datos del curso ----
  const courseJson = readText("course-data/course.json");
  if (courseJson === null) err("course-missing", "Falta course-data/course.json");
  else {
    try {
      const data = JSON.parse(courseJson) as unknown;
      const walk = (v: unknown) => {
        if (typeof v === "string") {
          if (v.startsWith("asset://")) err("course-unresolved-asset", `Referencia sin reescribir en course.json: ${v}`);
          else if (/^assets\//.test(v) && !has(v)) err("course-asset-missing", `course.json referencia ${v}, que no existe en el paquete`);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(data);
      if ((data as { tracking?: { standard?: string } }).tracking?.standard !== opts.standard) {
        err("course-standard", "El estándar declarado en course.json no coincide con el paquete");
      }
    } catch {
      err("course-json", "course-data/course.json no es JSON válido");
    }
  }
  if (!has("course-data/course.js")) err("course-missing", "Falta course-data/course.js");

  const pm = readText("course-data/project-manifest.json");
  if (pm === null) err("project-manifest-missing", "Falta course-data/project-manifest.json (necesario para reimportar)");
  else {
    try {
      const j = JSON.parse(pm) as { format?: string; project?: unknown };
      if (j.format !== "studio-native-package" || !j.project) err("project-manifest-invalid", "project-manifest.json no contiene el proyecto editable");
    } catch {
      err("project-manifest-invalid", "project-manifest.json no es JSON válido");
    }
  }

  // ---- URLs prohibidas en archivos de texto publicados ----
  for (const [p, e] of byPath) {
    if (!TEXT_EXT.has(ext(p)) || e.source.kind !== "inline") continue;
    if (p === "runtime/runtime.js") continue; // bundle propio, verificado por hash
    for (const reason of findForbiddenUrls(dec.decode(e.source.data))) err("forbidden-url", `${p}: ${reason}`);
  }

  // ---- Tamaño ----
  const total = entries.reduce((n, e) => n + (e.source.kind === "inline" ? e.source.data.length : e.source.size), 0);
  if (total > 250 * 1024 * 1024) warn("pkg-size", `El paquete pesa ${(total / 1048576).toFixed(0)} MB; muchos LMS limitan la subida (Moodle: revisar "Tamaño máximo de archivo")`);

  return issues;
}
