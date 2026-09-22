import type { Readable } from "node:stream";

export type ByteRange = { start: number; end: number }; // inclusivo

/**
 * Almacenamiento de objetos. Las claves son internas; nunca se exponen
 * como URLs públicas ni se guardan dentro de paquetes publicados.
 */
export interface ObjectStorage {
  readonly driver: "fs" | "s3";
  put(key: string, body: Readable, meta: { contentType: string; size?: number }): Promise<void>;
  putFile(key: string, filePath: string, meta: { contentType: string }): Promise<void>;
  stat(key: string): Promise<number | null>;
  read(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
  healthCheck(): Promise<void>;
}

export function assertSafeKey(key: string): void {
  if (!/^[A-Za-z0-9._\-/]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
    throw new Error(`Clave de almacenamiento inválida: ${key}`);
  }
}
