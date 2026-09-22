/**
 * Verificación del contenido real de los archivos subidos (firma/"magic
 * bytes"). No se confía en la extensión ni en el Content-Type del navegador.
 */
const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Buffer, s: string, offset = 0) => b.subarray(offset, offset + s.length).toString("latin1") === s;

export function sniffMatches(mime: string, head: Buffer): boolean {
  switch (mime) {
    case "image/png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return ascii(head, "GIF87a") || ascii(head, "GIF89a");
    case "image/webp":
      return ascii(head, "RIFF") && ascii(head, "WEBP", 8);
    case "image/avif":
      return ascii(head, "ftyp", 4) && /avi[fs]/.test(head.subarray(8, 32).toString("latin1"));
    case "image/svg+xml": {
      const t = head.toString("utf8").replace(/^\uFEFF/, "").trimStart();
      return (t.startsWith("<svg") || t.startsWith("<?xml") || t.startsWith("<!--") || t.startsWith("<!DOCTYPE svg")) && t.includes("<svg");
    }
    case "video/mp4":
    case "audio/mp4":
      return ascii(head, "ftyp", 4);
    case "video/webm":
    case "audio/webm":
      return startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/mpeg":
      return ascii(head, "ID3") || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0);
    case "audio/ogg":
      return ascii(head, "OggS");
    case "audio/wav":
      return ascii(head, "RIFF") && ascii(head, "WAVE", 8);
    case "font/woff2":
      return ascii(head, "wOF2");
    case "font/woff":
      return ascii(head, "wOFF");
    case "font/ttf":
      return startsWith(head, [0x00, 0x01, 0x00, 0x00]) || ascii(head, "true");
    case "font/otf":
      return ascii(head, "OTTO");
    case "application/pdf":
      return ascii(head, "%PDF-");
    case "text/vtt":
      return head.toString("utf8").replace(/^\uFEFF/, "").startsWith("WEBVTT");
    case "text/plain":
      return !head.includes(0);
    default:
      return false;
  }
}

/** Rechazo de SVG activos (scripts, handlers, foreignObject, URLs javascript:). */
export function unsafeSvgReason(svg: string): string | null {
  if (/<script[\s>]/i.test(svg)) return "contiene <script>";
  if (/\son[a-z]+\s*=/i.test(svg)) return "contiene manejadores de eventos (on*)";
  if (/javascript:/i.test(svg)) return "contiene URLs javascript:";
  if (/<foreignObject[\s>]/i.test(svg)) return "contiene <foreignObject>";
  if (/<!ENTITY/i.test(svg)) return "declara entidades XML";
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//i.test(svg)) return "referencia recursos externos";
  return null;
}

/** Dimensiones de imagen desde la cabecera (PNG, GIF, JPEG, WebP VP8X/VP8/VP8L, SVG). */
export function imageSize(mime: string, head: Buffer): { width: number; height: number } | null {
  try {
    if (mime === "image/png" && head.length >= 24) return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    if (mime === "image/gif" && head.length >= 10) return { width: head.readUInt16LE(6), height: head.readUInt16LE(8) };
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < head.length) {
        if (head[i] !== 0xff) return null;
        const marker = head[i + 1]!;
        const len = head.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: head.readUInt16BE(i + 5), width: head.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (mime === "image/webp" && head.length >= 30) {
      const chunk = head.subarray(12, 16).toString("latin1");
      if (chunk === "VP8X") return { width: 1 + head.readUIntLE(24, 3), height: 1 + head.readUIntLE(27, 3) };
      if (chunk === "VP8 ") return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const b = head.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
    }
    if (mime === "image/svg+xml") {
      const t = head.toString("utf8");
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(t);
      if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
      const w = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/i.exec(t);
      const h = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/i.exec(t);
      if (w && h) return { width: Math.round(Number(w[1])), height: Math.round(Number(h[1])) };
    }
  } catch {
    return null;
  }
  return null;
}
