export const KEYCHAIN_SERVICE = "career-workbench.local-ai-config";
export const KEYCHAIN_ACCOUNT = "current-user";
export const MAX_KEYCHAIN_BYTES = 65536;

export class KeychainError extends Error {
  constructor(code = "storage") { super("Mac钥匙串操作未完成"); this.code = code; }
}

export function checkKeychainStatus(status) {
  if (status === 0) return;
  if ([-128, -25293, -25308, -25291].includes(status)) throw new KeychainError("access");
  throw new KeychainError("storage");
}

function parseConfig(bytes) {
  if (!bytes.length || bytes.length > MAX_KEYCHAIN_BYTES) throw new KeychainError("invalid");
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new KeychainError("invalid"); }
}

/** Backend receives bytes only; failed reads never become a missing entry. */
export function executeKeychainOperation(backend, operation, input = Buffer.alloc(0)) {
  if (!["load", "save", "delete"].includes(operation)) throw new KeychainError("invalid");
  if (input.length > MAX_KEYCHAIN_BYTES || operation !== "save" && input.length) throw new KeychainError("invalid");
  if (operation === "load") {
    const value = backend.read();
    if (value === null) return null;
    try { return parseConfig(value); } finally { value.fill(0); }
  }
  if (operation === "save") {
    parseConfig(input);
    const previous = backend.read();
    if (previous !== null) {
      try { parseConfig(previous); } finally { previous.fill(0); }
    }
    backend.write(input);
    const saved = backend.read();
    try { if (saved === null || !saved.equals(input)) throw new KeychainError("unconfirmed"); }
    finally { saved?.fill(0); }
    return true;
  }
  backend.remove();
  const remaining = backend.read();
  if (remaining !== null) { remaining.fill(0); throw new KeychainError("unconfirmed"); }
  return true;
}
