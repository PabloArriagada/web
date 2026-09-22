// Compila el Runtime Engine en un bundle IIFE autónomo (sin dependencias
// externas) que el publicador copia dentro de cada paquete SCORM.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";

const outdir = new URL("./dist/", import.meta.url);
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: [new URL("./src/boot.ts", import.meta.url).pathname],
  bundle: true,
  format: "iife",
  target: ["es2019", "chrome80", "firefox78", "safari13"],
  minify: true,
  sourcemap: false,
  legalComments: "none",
  outfile: new URL("./runtime.js", outdir).pathname,
});
await copyFile(new URL("./src/runtime.css", import.meta.url), new URL("./runtime.css", outdir));
const js = await readFile(new URL("./runtime.js", outdir));
const css = await readFile(new URL("./runtime.css", outdir));
const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
const info = {
  version: pkg.version,
  builtAt: new Date().toISOString(),
  js: { file: "runtime.js", sha256: createHash("sha256").update(js).digest("hex"), bytes: js.length },
  css: { file: "runtime.css", sha256: createHash("sha256").update(css).digest("hex"), bytes: css.length },
};
await writeFile(new URL("./bundle-info.json", outdir), JSON.stringify(info, null, 2));
console.log(`runtime.js ${js.length} B · runtime.css ${css.length} B`);
