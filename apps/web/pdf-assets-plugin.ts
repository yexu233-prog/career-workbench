import { readFile, readdir } from "node:fs/promises";
import type { Plugin } from "vite";

/** Ship PDF text-decoding resources locally, including upstream font licenses. */
export function pdfTextAssets(): Plugin {
  const directories = {
    cmaps: new URL("../../node_modules/pdfjs-dist/cmaps/", import.meta.url),
    standard_fonts: new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url)
  };
  return {
    name: "local-pdf-text-assets",
    async generateBundle() {
      for (const [group, directory] of Object.entries(directories)) {
        for (const name of await readdir(directory)) {
          this.emitFile({ type: "asset", fileName: `assets/pdfjs/${group}/${name}`, source: await readFile(new URL(name, directory)) });
        }
      }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/assets\/pdfjs\/(cmaps|standard_fonts)\/([A-Za-z0-9_.-]+)(?:\?.*)?$/.exec(request.url ?? "");
        if (!match || match[2] === "." || match[2] === "..") { next(); return; }
        const directory = directories[match[1] as keyof typeof directories];
        void readFile(new URL(match[2]!, directory)).then(data => {
          response.setHeader("Content-Type", "application/octet-stream"); response.end(data);
        }).catch(() => { response.statusCode = 404; response.end(); });
      });
    }
  };
}
