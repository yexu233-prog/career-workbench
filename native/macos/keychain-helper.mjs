import { createRequire } from "node:module";
import { createLocalKeychainBackend } from "./keychain-backend.mjs";
import { executeKeychainOperation, MAX_KEYCHAIN_BYTES, KeychainError } from "./keychain-operations.mjs";

let backend; let input;
try {
  const operation = process.argv[2];
  if (process.platform !== "darwin" || !["load", "save", "delete", "probe"].includes(operation) || process.argv.length !== 3) throw new KeychainError("invalid");
  const require = createRequire(import.meta.url);
  const koffi = require("koffi");
  if (koffi.version !== "3.3.2") throw new KeychainError("storage");
  // Probe loads system APIs but never opens, reads or changes a credential.
  if (operation === "probe") {
    const library = koffi.load("/System/Library/Frameworks/Security.framework/Security");
    library.func("int32_t SecKeychainCopyDomainDefault(uint32_t domain, _Out_ void **keychain)");
    process.stdout.write("true");
  } else {
    const chunks = []; let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > MAX_KEYCHAIN_BYTES) throw new KeychainError("invalid");
      chunks.push(chunk);
    }
    input = Buffer.concat(chunks); for (const chunk of chunks) chunk.fill(0);
    backend = createLocalKeychainBackend(koffi);
    const result = executeKeychainOperation(backend, operation, input);
    process.stdout.write(JSON.stringify(result));
  }
} catch (error) {
  // Do not forward native error objects, paths or credential values.
  process.exitCode = error instanceof KeychainError && error.code === "access" ? 3 : error instanceof KeychainError && error.code === "invalid" ? 2 : 1;
} finally {
  input?.fill(0); backend?.close();
}
