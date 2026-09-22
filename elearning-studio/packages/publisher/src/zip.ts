import { Zip, ZipDeflate, ZipPassThrough, strFromU8 } from "fflate";
import type { AssetReader, PackageEntry } from "./types.js";

export type ZipSink = (chunk: Uint8Array) => Promise<void> | void;

/**
 * Escribe el ZIP en streaming: los assets se leen por trozos desde el
 * almacenamiento y la media (ya comprimida) se guarda sin recomprimir.
 * Con `await pending` tras cada trozo se aplica contrapresión al sink.
 */
export async function writeZip(entries: PackageEntry[], reader: AssetReader, sink: ZipSink, mtime = new Date()): Promise<number> {
  let written = 0;
  let pending: Promise<void> = Promise.resolve();
  let failure: unknown = null;
  let resolveDone!: () => void;
  let rejectDone!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      failure = err;
      rejectDone(err);
      return;
    }
    written += chunk.length;
    pending = pending.then(() => sink(chunk));
    if (final) pending.then(resolveDone, rejectDone);
  });

  // imsmanifest.xml primero: algunos LMS inspeccionan solo el inicio del ZIP.
  const ordered = [...entries].sort((a, b) => (a.path === "imsmanifest.xml" ? -1 : b.path === "imsmanifest.xml" ? 1 : 0));
  for (const entry of ordered) {
    if (failure) break;
    const file = entry.compress ? new ZipDeflate(entry.path, { level: 6 }) : new ZipPassThrough(entry.path);
    file.mtime = mtime;
    zip.add(file);
    if (entry.source.kind === "inline") {
      file.push(entry.source.data, true);
    } else {
      let got = 0;
      for await (const chunk of reader.read(entry.source.storageKey)) {
        got += chunk.length;
        file.push(chunk, false);
        await pending;
      }
      if (got !== entry.source.size) {
        throw new Error(`El asset ${entry.path} tiene ${got} bytes y se esperaban ${entry.source.size}`);
      }
      file.push(new Uint8Array(0), true);
    }
    await pending;
  }
  zip.end();
  await done;
  await pending;
  return written;
}

export type ZipDirectoryEntry = { name: string; compressedSize: number; size: number; method: number; crc32: number };

/**
 * Lee el directorio central de un ZIP sin descomprimirlo (sirve para
 * verificar paquetes grandes leyendo solo el final del archivo).
 */
export async function readZipDirectory(
  readRange: (offset: number, length: number) => Promise<Uint8Array>,
  totalSize: number,
): Promise<ZipDirectoryEntry[]> {
  const tailLen = Math.min(totalSize, 65557);
  const tail = await readRange(totalSize - tailLen, tailLen);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido: no se encontró el directorio central");
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) throw new Error("ZIP64 no soportado por el verificador");
  const cd = await readRange(cdOffset, cdSize);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const out: ZipDirectoryEntry[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (cv.getUint32(p, true) !== 0x02014b50) throw new Error("ZIP inválido: entrada del directorio central corrupta");
    const method = cv.getUint16(p + 10, true);
    const crc32 = cv.getUint32(p + 16, true);
    const compressedSize = cv.getUint32(p + 20, true);
    const size = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const name = strFromU8(cd.subarray(p + 46, p + 46 + nameLen));
    out.push({ name, compressedSize, size, method, crc32 });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
