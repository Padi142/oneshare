import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binDirectory = join(projectRoot, "node_modules", ".bin");
const binary = (name) =>
  join(binDirectory, process.platform === "win32" ? `${name}.cmd` : name);
const viteBinary = binary("vite");
const electronBinary = binary("electron");
const parsedPort = Number.parseInt(process.env.VITE_PORT ?? "5173", 10);
const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 5173;
const devServerUrl = `http://127.0.0.1:${port}`;

const children = new Set();
let shuttingDown = false;

function start(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForFile(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForDevServer(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for Vite at ${url}`);
}

async function stop(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    child.kill();
  }

  await delay(200);
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }

  process.exit(exitCode);
}

process.once("SIGINT", () => void stop(130));
process.once("SIGTERM", () => void stop(143));

const vite = start(viteBinary, [
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort",
]);
const electronBuild = start(process.execPath, [
  join(projectRoot, "electron/build.mjs"),
  "--watch",
]);

try {
  await Promise.all([
    waitForDevServer(devServerUrl),
    waitForFile(join(projectRoot, "dist-electron", "main.cjs")),
    waitForFile(join(projectRoot, "dist-electron", "preload.cjs")),
  ]);
} catch (error) {
  console.error(error);
  await stop(1);
}

if (shuttingDown) {
  process.exit(1);
}

const electron = start(electronBinary, ["."], {
  ...process.env,
  VITE_DEV_SERVER_URL: devServerUrl,
});

vite.once("exit", (code) => {
  if (!shuttingDown) {
    void stop(code ?? 1);
  }
});
electronBuild.once("exit", (code) => {
  if (!shuttingDown && code !== 0) {
    void stop(code ?? 1);
  }
});
electron.once("exit", (code) => {
  if (!shuttingDown) {
    void stop(code ?? 0);
  }
});

await new Promise(() => undefined);
