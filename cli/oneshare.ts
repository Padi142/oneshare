import { createReadStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { createInterface } from "node:readline/promises";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const DEFAULT_CONVEX_URL = "https://clever-ibex-476.eu-west-1.convex.cloud";
const desktopStorageDirectory = join(
  process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  "OneShare",
  "Local Storage",
  "leveldb",
);
const stateDirectory = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
  "oneshare",
);
const statePath = join(stateDirectory, "session.json");

type Session = {
  refreshToken: string;
  convexUrl: string;
};

type AuthTokens = {
  token: string;
  refreshToken: string;
};

type AuthResult = {
  tokens?: AuthTokens | null;
};

type UploadResult = { storageId: string };

type Attachment = {
  storageId: string;
  kind: "file" | "image" | "video";
  fileName: string;
  mimeType: string;
};

type ParsedArguments =
  | { command: "help" }
  | { command: "status" | "logout" }
  | { command: "login"; email: string | undefined; passwordFromStdin: boolean; convexUrl: string | undefined }
  | {
      command: "upload";
      files: string[];
      message: string | undefined;
      json: boolean;
      convexUrl: string | undefined;
    };

const signIn = makeFunctionReference<
  "action",
  { refreshToken?: string; provider?: string; params?: Record<string, string> },
  AuthResult
>("auth:signIn");
const createUploadUrl = makeFunctionReference<"mutation", Record<string, never>, string>(
  "messages:createUploadUrl",
);
const sendMessage = makeFunctionReference<
  "mutation",
  { text?: string; attachments?: Attachment[] },
  string
>("messages:sendMessage");

function usage(): string {
  return `Usage: oneshare <file> [file ...] [options]

Upload files to the signed-in OneShare account as one message.

Options:
  --message <text>       Attach a text message
  --json                 Print a machine-readable result
  --convex-url <url>     Override the OneShare Convex URL
  login                  Sign in and save a CLI session
    --email <email>      Email address (prompts when omitted)
    --password-stdin     Read the password from standard input
  status                 Check whether an upload session is available
  logout                 Remove the CLI session
  --help, -h             Show this help

The first upload imports the session from the local OneShare desktop app.
For agents: use --json and pass absolute file paths.`;
}

function fail(message: string): never {
  throw new Error(message);
}

function cliError(message: string): never {
  process.stderr.write(`oneshare: ${message}\n`);
  process.exit(1);
}

function parseArguments(argv: string[]): ParsedArguments {
  if (argv[0] === "login") {
    let email: string | undefined;
    let passwordFromStdin = false;
    let convexUrl: string | undefined;
    for (let index = 1; index < argv.length; index += 1) {
      const argument = argv[index];
      if (argument === "--help" || argument === "-h") return { command: "help" };
      if (argument === "--password-stdin") {
        passwordFromStdin = true;
        continue;
      }
      if (argument === "--email" || argument === "--convex-url") {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--")) fail(`${argument} requires a value.`);
        index += 1;
        if (argument === "--email") email = value;
        else convexUrl = value;
        continue;
      }
      fail(`Unknown login option: ${argument}`);
    }
    return { command: "login", email, passwordFromStdin, convexUrl };
  }
  const files: string[] = [];
  let message: string | undefined;
  let json = false;
  let convexUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") return { command: "help" as const };
    if (argument === "status" || argument === "logout") {
      if (argv.length !== 1) fail(`${argument} does not accept other arguments.`);
      return { command: argument };
    }
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--message" || argument === "--convex-url") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail(`${argument} requires a value.`);
      index += 1;
      if (argument === "--message") message = value;
      else convexUrl = value;
      continue;
    }
    if (argument.startsWith("-")) fail(`Unknown option: ${argument}`);
    files.push(argument);
  }
  if (files.length === 0) return { command: "help" as const };
  return { command: "upload" as const, files, message, json, convexUrl };
}

function readSession(): Session | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Session).refreshToken === "string" &&
      typeof (parsed as Session).convexUrl === "string"
    ) {
      return parsed as Session;
    }
  } catch {
    // A missing or invalid state file simply falls back to desktop-session import.
  }
  return undefined;
}

/** Extract only the refresh JWT following OneShare's known localStorage key. */
function importDesktopSession(convexUrl: string): Session | undefined {
  if (!existsSync(desktopStorageDirectory)) return undefined;
  const marker = "__convexAuthRefreshToken";
  const jwt = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/u;
  const candidates = readdirSync(desktopStorageDirectory)
    .map((name) => join(desktopStorageDirectory, name))
    .filter((path) => /(?:\.log|\.ldb)$/u.test(path));

  for (const path of candidates.reverse()) {
    try {
      const contents = readFileSync(path).toString("latin1");
      let position = contents.lastIndexOf(marker);
      while (position >= 0) {
        const token = contents.slice(position + marker.length, position + marker.length + 4096).match(jwt)?.[0];
        if (token !== undefined) return { refreshToken: token, convexUrl };
        position = contents.lastIndexOf(marker, position - 1);
      }
    } catch {
      // Chromium can rotate LevelDB files while the desktop app is open.
    }
  }
  return undefined;
}

async function saveSession(session: Session): Promise<void> {
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify(session)}\n`, { mode: 0o600 });
}

async function refreshSession(session: Session): Promise<ConvexHttpClient | undefined> {
  try {
    const client = new ConvexHttpClient(session.convexUrl, { logger: false });
    const auth = await client.action(signIn, { refreshToken: session.refreshToken });
    if (auth.tokens === undefined || auth.tokens === null) return undefined;
    await saveSession({ refreshToken: auth.tokens.refreshToken, convexUrl: session.convexUrl });
    client.setAuth(auth.tokens.token);
    return client;
  } catch {
    return undefined;
  }
}

async function getAuthenticatedClient(convexUrlOverride?: string): Promise<ConvexHttpClient> {
  const convexUrl = convexUrlOverride ?? process.env.ONESHARE_CONVEX_URL ?? DEFAULT_CONVEX_URL;
  const candidates = [readSession(), importDesktopSession(convexUrl)].filter(
    (session): session is Session => session !== undefined,
  );
  for (const session of candidates) {
    const client = await refreshSession(session);
    if (client !== undefined) return client;
  }
  fail("No valid OneShare session. Run `oneshare login` and retry.");
}

async function readPasswordFromTerminal(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8").trimEnd();
  }
  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise<string>((resolve, reject) => {
    let password = "";
    const onData = (chunk: Buffer) => {
      const value = chunk.toString("utf8");
      if (value === "\u0003") {
        cleanup();
        reject(new Error("Login cancelled."));
      } else if (value === "\r" || value === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(password);
      } else if (value === "\u007f" || value === "\b") {
        password = password.slice(0, -1);
      } else {
        password += value;
      }
    };
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };
    process.stdin.on("data", onData);
  });
}

async function login(emailOption: string | undefined, passwordFromStdin: boolean, convexUrlOption: string | undefined): Promise<void> {
  let email = emailOption?.trim();
  if (!email) {
    if (!process.stdin.isTTY) fail("Pass --email when logging in from a non-interactive session.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    email = (await prompt.question("Email: ")).trim();
    prompt.close();
  }
  if (!email) fail("Email is required.");
  if (passwordFromStdin && process.stdin.isTTY) {
    fail("--password-stdin requires a piped password.");
  }
  if (!passwordFromStdin && !process.stdin.isTTY) {
    fail("Use --password-stdin when logging in from a non-interactive session.");
  }
  const password = await readPasswordFromTerminal();
  if (!password) fail("Password is required.");
  const convexUrl = convexUrlOption ?? process.env.ONESHARE_CONVEX_URL ?? DEFAULT_CONVEX_URL;
  const client = new ConvexHttpClient(convexUrl, { logger: false });
  const auth = await client.action(signIn, {
    provider: "password",
    params: { email, password, flow: "signIn" },
  });
  if (auth.tokens === undefined || auth.tokens === null) fail("OneShare did not create a session.");
  await saveSession({ refreshToken: auth.tokens.refreshToken, convexUrl });
  process.stdout.write("Signed in to OneShare.\n");
}

function mimeType(fileName: string): string {
  const extension = extname(fileName).toLowerCase();
  const types: Readonly<Record<string, string>> = {
    ".avif": "image/avif", ".gif": "image/gif", ".heic": "image/heic",
    ".jpeg": "image/jpeg", ".jpg": "image/jpeg", ".m4v": "video/x-m4v",
    ".mkv": "video/x-matroska", ".mov": "video/quicktime", ".mp4": "video/mp4",
    ".pdf": "application/pdf", ".png": "image/png", ".svg": "image/svg+xml",
    ".txt": "text/plain", ".webm": "video/webm", ".webp": "image/webp",
  };
  return types[extension] ?? "application/octet-stream";
}

function kindForMimeType(type: string): Attachment["kind"] {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  return "file";
}

async function uploadOne(client: ConvexHttpClient, path: string): Promise<Attachment> {
  const file = await stat(path);
  if (!file.isFile()) fail(`${path} is not a file.`);
  if (file.size > MAX_UPLOAD_BYTES) fail(`${path} exceeds the 500 MiB file limit.`);
  const fileName = basename(path);
  if (!fileName || fileName === "." || fileName === "..") fail(`Invalid file name: ${path}`);
  const type = mimeType(fileName);
  const url = await client.mutation(createUploadUrl, {});
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": type, "Content-Length": String(file.size) },
    body: Readable.toWeb(createReadStream(path)) as BodyInit,
    duplex: "half",
  } as RequestInit);
  if (!response.ok) fail(`Upload failed for ${path} (${response.status}).`);
  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null || typeof (result as UploadResult).storageId !== "string") {
    fail(`Upload completed without a storage ID for ${path}.`);
  }
  return { storageId: (result as UploadResult).storageId, kind: kindForMimeType(type), fileName, mimeType: type };
}

async function validateUploadSet(paths: string[]): Promise<void> {
  if (paths.length > 10) fail("A OneShare message can contain at most 10 files.");
  let totalSize = 0;
  for (const path of paths) {
    const file = await stat(path);
    if (!file.isFile()) fail(`${path} is not a file.`);
    if (file.size > MAX_UPLOAD_BYTES) fail(`${path} exceeds the 500 MiB file limit.`);
    totalSize += file.size;
  }
  if (totalSize > 1024 * 1024 * 1024) {
    fail("The combined file size exceeds OneShare's 1 GiB message limit.");
  }
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.command === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (parsed.command === "status") {
    try {
      await getAuthenticatedClient();
      process.stdout.write("ready\n");
    } catch {
      process.stdout.write("not signed in\n");
      process.exitCode = 1;
    }
    return;
  }
  if (parsed.command === "logout") {
    await import("node:fs/promises").then(({ unlink }) => unlink(statePath).catch(() => undefined));
    process.stdout.write("Signed out of the OneShare upload CLI.\n");
    return;
  }
  if (parsed.command === "login") {
    await login(parsed.email, parsed.passwordFromStdin, parsed.convexUrl);
    return;
  }
  if (parsed.command !== "upload") return;
  await validateUploadSet(parsed.files);
  const client = await getAuthenticatedClient(parsed.convexUrl);
  const attachments: Attachment[] = [];
  for (const path of parsed.files) attachments.push(await uploadOne(client, path));
  const messageId = await client.mutation(sendMessage, {
    ...(parsed.message?.trim() ? { text: parsed.message.trim() } : {}),
    attachments,
  });
  const result = { messageId, files: attachments.map(({ fileName, storageId }) => ({ fileName, storageId })) };
  process.stdout.write(parsed.json ? `${JSON.stringify(result)}\n` : `Uploaded ${attachments.length} file${attachments.length === 1 ? "" : "s"} (${messageId}).\n`);
}

main().catch((error: unknown) => cliError(error instanceof Error ? error.message : "Upload failed."));
