// Genera fixtures/sample-video.webm (2 s, VP8/VP9 + Opus) con Chromium
// (canvas.captureStream + WebAudio + MediaRecorder). Solo hace falta
// ejecutarlo si se quiere regenerar el archivo versionado.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const b64 = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  const video = canvas.captureStream(15);
  const ac = new AudioContext();
  const osc = ac.createOscillator();
  const dest = ac.createMediaStreamDestination();
  osc.frequency.value = 440;
  osc.connect(dest);
  osc.start();
  const stream = new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = (performance.now() - t0) / 2000;
      ctx.fillStyle = "#003a5d";
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = "#36b9d6";
      ctx.fillRect(20 + t * 220, 60, 60, 60);
      ctx.fillStyle = "#ffffff";
      ctx.font = "20px sans-serif";
      ctx.fillText(`Video de prueba ${(t * 2).toFixed(1)} s`, 20, 40);
      if (t < 1) requestAnimationFrame(draw);
      else resolve();
    };
    draw();
  });
  rec.stop();
  await done;
  const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
});
await browser.close();
const out = new URL("./sample-video.webm", import.meta.url);
await writeFile(out, Buffer.from(b64, "base64"));
console.log("sample-video.webm", Buffer.from(b64, "base64").length, "bytes");
