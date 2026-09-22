import type { FastifyReply } from "fastify";
import type { Readable } from "node:stream";
import type { ObjectStorage } from "../storage/types.js";

/** Interpreta la cabecera Range (un único rango). */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return { start, end };
}

/** Envía un objeto del almacenamiento con soporte de Range (seek de video/audio). */
export async function sendStored(
  reply: FastifyReply,
  storage: ObjectStorage,
  key: string,
  size: number,
  mime: string,
  rangeHeader: string | undefined,
): Promise<FastifyReply> {
  const range = parseRange(rangeHeader, size);
  reply.header("Accept-Ranges", "bytes").type(mime);
  if (range === "invalid") {
    return reply.code(416).header("Content-Range", `bytes */${size}`).send();
  }
  let body: Readable;
  if (range) {
    body = await storage.read(key, range);
    reply.code(206).header("Content-Range", `bytes ${range.start}-${range.end}/${size}`).header("Content-Length", range.end - range.start + 1);
  } else {
    body = await storage.read(key);
    reply.header("Content-Length", size);
  }
  return reply.send(body);
}
