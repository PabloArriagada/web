/**
 * Utilidades E2E para probar un paquete SCORM real: lo compila con el
 * publicador, lo descomprime en disco, lo sirve por HTTP (sensible a
 * mayúsculas, como un LMS en Linux) y lo lanza dentro de un iframe con un
 * LMS simulado en la ventana padre (igual que Moodle).
 */
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { build } from "esbuild";
import { unzipSync } from "fflate";
import { buildPackage, loadDefaultFonts, loadRuntimeBundle, writeZip } from "../packages/publisher/src/index.ts";
import type { ScormStandard } from "../packages/schema/src/index.ts";
import { qaFixture } from "../packages/publisher/test/helpers.ts";
import { generateWav } from "../apps/server/src/services/sample-media.ts";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".vtt": "text/vtt; charset=utf-8",
  ".woff2": "font/woff2",
};

export async function makePackageSite(standard: ScormStandard) {
  const root = await mkdtemp(join(tmpdir(), `studio-pkg-${standard}-`));
  const f = qaFixture();
  // Reemplaza los bytes sintéticos por medios reales para que el navegador los decodifique.
  const png = await readFile(new URL("./fixtures/tiny.png", import.meta.url)).catch(() => null);
  const video = await readFile(new URL("../fixtures/sample-video.webm", import.meta.url));
  const { createHash } = await import("node:crypto");
  const realBytes: Record<string, Uint8Array | null> = { image: png, video, audio: generateWav(1) };
  for (const a of f.project.assets) {
    const data = realBytes[a.type];
    if (data) {
      f.reader.files.set(a.storageKey, data);
      a.size = data.length;
      a.hash = createHash("sha256").update(data).digest("hex");
    }
  }
  const profile = f.project.publicationProfiles.find((p) => p.standard === standard)!;
  const result = await buildPackage(f.project, { standard, profile, reader: f.reader, runtime: await loadRuntimeBundle(), fonts: await loadDefaultFonts() });
  if (!result.ok) throw new Error(JSON.stringify(result.report.issues));
  const chunks: Uint8Array[] = [];
  await writeZip(result.entries, f.reader, (c) => void chunks.push(c));
  const zip = Buffer.concat(chunks);
  const files = unzipSync(new Uint8Array(zip));
  for (const [name, data] of Object.entries(files)) {
    const out = join(root, "pkg", name);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, data);
  }
  const mock = await build({ entryPoints: [new URL("../packages/runtime/src/lms/mock-api.ts", import.meta.url).pathname], bundle: true, format: "iife", globalName: "MockLms", write: false });
  await writeFile(join(root, "mock.js"), mock.outputFiles[0]!.text);
  await writeFile(
    join(root, "lms.html"),
    `<!doctype html><html><head><meta charset="utf-8"><title>LMS de prueba</title><link rel="icon" href="data:,"><script src="mock.js"></script></head>
<body style="margin:0">
<iframe id="sco" title="SCO" style="width:1280px;height:820px;border:0"></iframe>
<script>
  const std = new URLSearchParams(location.search).get("std");
  window.store = MockLms.createMockStore();
  window.launch = () => {
    window.lms = MockLms.createMockLms(std, window.store);
    MockLms.installMockLms(window, window.lms);
    document.getElementById("sco").src = "pkg/index.html";
  };
  window.closeSco = () => new Promise((r) => { const f = document.getElementById("sco"); f.addEventListener("load", () => r(), { once: true }); f.src = "about:blank"; });
  window.value = (k) => window.lms.snapshot()[k] ?? "";
  launch();
</script></body></html>`,
  );
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      const p = normalize(join(root, decodeURIComponent(url.pathname)));
      if (!p.startsWith(root)) throw new Error("fuera de la raíz");
      const s = await stat(p);
      if (!s.isFile()) throw new Error("no es archivo");
      res.writeHead(200, { "content-type": MIME[extname(p)] ?? "application/octet-stream", "content-length": s.size });
      res.end(await readFile(p));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return { root, url: `http://127.0.0.1:${port}`, project: f.project, zipBytes: zip.length, close: () => new Promise<void>((r) => server.close(() => r())) };
}
