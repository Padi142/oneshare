import { build, context } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "dist-electron");

const buildOptions = {
  entryPoints: [
    resolve(projectRoot, "electron/main.ts"),
    resolve(projectRoot, "electron/preload.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outdir: outputDirectory,
  outExtension: { ".js": ".cjs" },
  sourcemap: true,
  external: ["electron"],
  logLevel: "info",
};

await mkdir(outputDirectory, { recursive: true });

if (!process.argv.includes("--watch")) {
  await build(buildOptions);
  process.exit(0);
}

const watcher = await context(buildOptions);
await watcher.rebuild();
await watcher.watch();

const close = async () => {
  await watcher.dispose();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
