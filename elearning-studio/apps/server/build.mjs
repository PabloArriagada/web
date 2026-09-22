// Bundle de producción del servidor: dist/server.js + migraciones.
// Los paquetes del monorepo (@studio/*, fuente TypeScript) se incluyen en el
// bundle; las dependencias de npm quedan externas (node_modules).
import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const workspaceBundler = {
  name: "externalize-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@studio/")) return undefined;
      return { path: args.path, external: true };
    });
  },
};

await mkdir(new URL("./dist/", import.meta.url), { recursive: true });
await build({
  entryPoints: { server: "src/server.ts", "migrate-cli": "src/migrate-cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  plugins: [workspaceBundler],
});
await cp(new URL("./src/db/migrations/", import.meta.url), new URL("./dist/migrations/", import.meta.url), { recursive: true });
console.log("server bundle listo en apps/server/dist");
