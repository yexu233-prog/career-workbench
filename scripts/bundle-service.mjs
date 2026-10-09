import { build } from "esbuild";
import { resolve } from "node:path";

const outputFile = process.argv[2];
if (!outputFile) throw new Error("Missing service bundle output path");

await build({
  absWorkingDir: process.cwd(),
  entryPoints: [resolve("apps/local-service/src/server.ts")],
  outfile: resolve(outputFile),
  bundle: true,
  platform: "node",
  // Playwright needs its own runtime assets; Mac packaging must copy the pinned package.
  external: ["playwright-core"],
  format: "esm",
  target: "node24",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }
});
