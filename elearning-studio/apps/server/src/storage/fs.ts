import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { assertSafeKey, type ByteRange, type ObjectStorage } from "./types.js";

/** Driver de sistema de archivos: desarrollo local sin Docker y pruebas. */
export class FsStorage implements ObjectStorage {
  readonly driver = "fs" as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    assertSafeKey(key);
    return join(this.root, key);
  }
  async put(key: string, body: Readable): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Escritura atómica: temporal + rename.
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      await pipeline(body, createWriteStream(tmp));
      await rename(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
  async putFile(key: string, filePath: string): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(filePath, target);
  }
  async stat(key: string): Promise<number | null> {
    try {
      const s = await stat(this.path(key));
      return s.isFile() ? s.size : null;
    } catch {
      return null;
    }
  }
  async read(key: string, range?: ByteRange): Promise<Readable> {
    const p = this.path(key);
    await stat(p); // lanza si no existe
    return createReadStream(p, range ? { start: range.start, end: range.end } : {});
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}
