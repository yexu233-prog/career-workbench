import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { LOCAL_HOST, LOCAL_PORT } from "@career-workbench/shared";
import { buildApp } from "./app.js";

function findArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readControlToken(): Promise<string | undefined> {
  const tokenFile = findArgument("--control-token-file");
  if (!tokenFile) {
    return undefined;
  }

  return (await readFile(tokenFile, "utf8")).trim();
}

const controlToken = await readControlToken();
const isProduction = process.env.NODE_ENV === "production" || process.argv.includes("--production");
const configuredWebRoot = findArgument("--web-root");
const configuredFontPath = findArgument("--font-file");
const keychainHelperPath = findArgument("--keychain-helper");
const keychainScriptPath = findArgument("--keychain-script");
const chromiumExecutablePath = findArgument("--chromium-executable");
const instanceId = findArgument("--instance-id");
if (instanceId && !/^[A-Za-z0-9-]{1,80}$/.test(instanceId)) throw new Error("本机实例编号无效");
let stopping = false;
function stopService() {
  if (stopping) return;
  stopping = true;
  void app.close().then(() => process.exit(0), () => process.exit(1));
}
let app = buildApp({
  ...(controlToken ? { controlToken } : {}),
  ...(!isProduction ? { allowDevelopmentOrigin: true } : {}),
  ...(configuredFontPath ? { pdfFontPath: resolve(configuredFontPath) } : {}),
  ...(keychainHelperPath ? { keychainHelperPath: resolve(keychainHelperPath) } : {}),
  ...(keychainScriptPath ? { keychainScriptPath: resolve(keychainScriptPath) } : {}),
  ...(chromiumExecutablePath ? { chromiumExecutablePath: resolve(chromiumExecutablePath) } : {}),
  ...(instanceId ? { instanceId } : {}),
  onShutdown: () => {
    stopService();
  }
});
process.once("SIGTERM", stopService);
process.once("SIGINT", stopService);
// Packaged Mac controller owns the IPC channel. Closing/killing it stops its service.
if (process.connected) process.once("disconnect", stopService);

if (isProduction) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  const webRoot = configuredWebRoot ? resolve(configuredWebRoot) : resolve(currentDirectory, "..", "..", "web", "dist");

  await app.register(fastifyStatic, {
    root: webRoot,
    wildcard: false
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });
}

try {
  await app.listen({ host: LOCAL_HOST, port: LOCAL_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
