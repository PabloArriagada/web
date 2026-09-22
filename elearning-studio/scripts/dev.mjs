// Desarrollo: API (tsx watch, puerto 3000) + web (Vite, puerto 5173, proxy /api).
import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev", "-w", "@studio/server"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@studio/web"], { stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) { stop(); process.exit(code); } });
