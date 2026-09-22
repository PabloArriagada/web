/**
 * Medios de prueba generados en código (sin archivos binarios en el repo,
 * salvo el video de fixtures/). Se usan en el curso QA y en las pruebas.
 */
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG RGB con degradado corporativo y un círculo (determinista). */
export function generatePng(width = 640, height = 480): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const cx = width * 0.65;
  const cy = height * 0.45;
  const r = Math.min(width, height) * 0.25;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const t = x / width;
      let R = Math.round(0 + t * 54);
      let G = Math.round(58 + t * (185 - 58));
      let B = Math.round(93 + t * (214 - 93));
      if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) {
        R = 255;
        G = 255;
        B = 255;
      }
      const o = row + 1 + x * 3;
      raw[o] = R;
      raw[o + 1] = G;
      raw[o + 2] = B;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function generateSvg(): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300">
  <rect width="400" height="300" fill="#f2f5f7"/>
  <circle cx="120" cy="150" r="80" fill="#003a5d"/>
  <rect x="220" y="70" width="140" height="160" rx="16" fill="#36b9d6"/>
  <path d="M40 270 L360 270" stroke="#bd1550" stroke-width="8" stroke-linecap="round"/>
  <text x="200" y="40" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#002b46">SVG de prueba</text>
</svg>
`);
}

/** WAV PCM 16-bit mono con un tono de `freq` Hz. */
export function generateWav(seconds = 2, freq = 440, sampleRate = 22050): Buffer {
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000);
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 12000 * env), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8, "latin1");
  h.write("fmt ", 12, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export function generateVtt(): Buffer {
  return Buffer.from(`WEBVTT

00:00:00.000 --> 00:00:01.000
Subtítulo de prueba: inicio.

00:00:01.000 --> 00:00:02.000
Subtítulo de prueba: final.
`);
}
