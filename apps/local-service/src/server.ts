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
let app = buildApp({
  ...(controlToken ? { controlToken } : {}),
  ...(!isProduction ? { allowDevelopmentOrigin: true } : {}),
  ...(configuredFontPath ? { pdfFontPath: resolve(configuredFontPath) } : {}),
  onShutdown: () => {
    void app.close().finally(() => process.exit(0));
  }
});

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
