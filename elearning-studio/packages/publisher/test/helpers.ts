import { createHash } from "node:crypto";
import { createId, createQaProject, packagePathForAsset, type Asset, type CourseProject } from "@studio/schema";
import { loadDefaultFonts, loadRuntimeBundle, type AssetReader, type BuildOptions } from "../src/index.js";

export class MemoryReader implements AssetReader {
  readonly files = new Map<string, Uint8Array>();
  async stat(k: string) {
    return this.files.get(k)?.length ?? null;
  }
  async *read(k: string) {
    const d = this.files.get(k);
    if (!d) throw new Error(`no existe ${k}`);
    // Trozos pequeños para ejercitar el streaming.
    for (let i = 0; i < d.length; i += 1000) yield d.subarray(i, i + 1000);
  }
}

export function makeAsset(reader: MemoryReader, projectId: string, filename: string, mimeType: string, type: Asset["type"], data: Uint8Array): Asset {
  const id = createId("ast");
  const storageKey = `projects/${projectId}/assets/${id}/${filename}`;
  reader.files.set(storageKey, data);
  return { id, projectId, type, filename, mimeType, size: data.length, hash: createHash("sha256").update(data).digest("hex"), storageKey, metadata: {} };
}

export function qaFixture(): { project: CourseProject; reader: MemoryReader } {
  const reader = new MemoryReader();
  const pid = createId("prj");
  const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * seed) % 251);
  const project = createQaProject({
    image: makeAsset(reader, pid, "foto.png", "image/png", "image", bytes(5000, 7)),
    svg: makeAsset(reader, pid, "dibujo.svg", "image/svg+xml", "svg", new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')),
    video: makeAsset(reader, pid, "video.webm", "video/webm", "video", bytes(12000, 13)),
    audio: makeAsset(reader, pid, "audio.wav", "audio/wav", "audio", bytes(3000, 17)),
    caption: makeAsset(reader, pid, "subs.vtt", "text/vtt", "caption", new TextEncoder().encode("WEBVTT\n\n00:00.000 --> 00:01.000\nHola\n")),
  });
  return { project, reader };
}

let cached: Pick<BuildOptions, "runtime" | "fonts"> | null = null;
export async function resources() {
  cached ??= { runtime: await loadRuntimeBundle(), fonts: await loadDefaultFonts() };
  return cached;
}

export const pathOf = packagePathForAsset;
