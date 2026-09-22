/**
 * Recursos del paquete que viven en disco del servidor: bundle del Runtime
 * y fuentes con licencia libre (Montserrat, SIL OFL 1.1 vía @fontsource).
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FontFile, RuntimeBundle } from "./types.js";

const require = createRequire(import.meta.url);

export async function loadRuntimeBundle(): Promise<RuntimeBundle> {
  const pkgDir = dirname(require.resolve("@studio/runtime/package.json"));
  const dist = join(pkgDir, "dist");
  let js: Buffer;
  let css: Buffer;
  try {
    [js, css] = await Promise.all([readFile(join(dist, "runtime.js")), readFile(join(dist, "runtime.css"))]);
  } catch {
    throw new Error("El bundle del Runtime no está compilado. Ejecuta `npm run build:runtime`.");
  }
  const pkg = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as { version: string };
  return {
    js: new Uint8Array(js),
    css: new Uint8Array(css),
    version: pkg.version,
    jsSha256: createHash("sha256").update(js).digest("hex"),
  };
}

const MONTSERRAT_VARIANTS: Array<{ weight: number; style: "normal" | "italic" }> = [
  { weight: 400, style: "normal" },
  { weight: 400, style: "italic" },
  { weight: 700, style: "normal" },
  { weight: 700, style: "italic" },
];

/** Lee los unicode-range por subconjunto desde el CSS oficial de @fontsource. */
async function readUnicodeRanges(pkgDir: string): Promise<Record<string, string>> {
  const css = await readFile(join(pkgDir, "400.css"), "utf8");
  const ranges: Record<string, string> = {};
  for (const m of css.matchAll(/\/\*\s*montserrat-([a-z-]+)-400-normal\s*\*\/[\s\S]*?unicode-range:\s*([^;]+);/g)) {
    if (m[1] && m[2]) ranges[m[1]] = m[2].trim();
  }
  return ranges;
}

/** Montserrat latin + latin-ext (cubre español y portugués). */
export async function loadDefaultFonts(): Promise<FontFile[]> {
  const pkgDir = dirname(require.resolve("@fontsource/montserrat/package.json"));
  const ranges = await readUnicodeRanges(pkgDir);
  const out: FontFile[] = [];
  for (const subset of ["latin", "latin-ext"]) {
    const unicodeRange = ranges[subset];
    if (!unicodeRange) throw new Error(`No se encontró unicode-range para Montserrat ${subset}`);
    for (const v of MONTSERRAT_VARIANTS) {
      const filename = `montserrat-${subset}-${v.weight}-${v.style}.woff2`;
      out.push({ family: "Montserrat", weight: v.weight, style: v.style, filename, unicodeRange, data: new Uint8Array(await readFile(join(pkgDir, "files", filename))) });
    }
  }
  return out;
}
