import { KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, MAX_KEYCHAIN_BYTES, KeychainError, checkKeychainStatus } from "./keychain-operations.mjs";

// SecKeychain APIs operate only on file-based local Keychains (Apple TN3137).
// No Data Protection/iCloud backend, synchronization option or file fallback.
export function createLocalKeychainBackend(koffi, service = KEYCHAIN_SERVICE, account = KEYCHAIN_ACCOUNT) {
  const security = koffi.load("/System/Library/Frameworks/Security.framework/Security");
  const core = koffi.load("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation");
  const copyDefault = security.func("int32_t SecKeychainCopyDomainDefault(uint32_t domain, _Out_ void **keychain)");
  const getStatus = security.func("int32_t SecKeychainGetStatus(void *keychain, _Out_ uint32_t *status)");
  const find = security.func("int32_t SecKeychainFindGenericPassword(void *keychain, uint32_t serviceLength, const void *service, uint32_t accountLength, const void *account, _Out_ uint32_t *passwordLength, _Out_ void **password, _Out_ void **item)");
  const add = security.func("int32_t SecKeychainAddGenericPassword(void *keychain, uint32_t serviceLength, const void *service, uint32_t accountLength, const void *account, uint32_t length, const void *password, _Out_ void **item)");
  const update = security.func("int32_t SecKeychainItemModifyAttributesAndData(void *item, const void *attributes, uint32_t length, const void *data)");
  const remove = security.func("int32_t SecKeychainItemDelete(void *item)");
  const freeContent = security.func("int32_t SecKeychainItemFreeContent(void *attributes, void *data)");
  const release = core.func("void CFRelease(void *value)");
  const serviceBytes = Buffer.from(service); const accountBytes = Buffer.from(account);
  const keychain = [null];
  checkKeychainStatus(copyDefault(0, keychain)); // kSecPreferencesDomainUser = 0
  if (!keychain[0]) throw new KeychainError("storage");
  let closed = false;
  const ensureUnlocked = () => {
    if (closed) throw new KeychainError("storage");
    const status = [0]; checkKeychainStatus(getStatus(keychain[0], status));
    if (!(status[0] & 1)) throw new KeychainError("access");
  };
  const locate = () => {
    ensureUnlocked();
    const length = [0]; const password = [null]; const item = [null];
    const status = find(keychain[0], serviceBytes.length, serviceBytes, accountBytes.length, accountBytes, length, password, item);
    const cleanup = () => { if (password[0]) freeContent(null, password[0]); if (item[0]) release(item[0]); };
    if (status === -25300) { cleanup(); return null; }
    try {
      checkKeychainStatus(status);
      if (!item[0] || !Number.isInteger(length[0]) || length[0] < 0 || length[0] > MAX_KEYCHAIN_BYTES || length[0] && !password[0]) throw new KeychainError("invalid");
      const data = length[0] ? Buffer.from(new Uint8Array(koffi.view(password[0], length[0]))) : Buffer.alloc(0);
      return { item: item[0], data, cleanup: () => { data.fill(0); cleanup(); } };
    } catch (error) { cleanup(); throw error; }
  };
  return {
    read() {
      const found = locate(); if (!found) return null;
      try { return Buffer.from(found.data); } finally { found.cleanup(); }
    },
    write(data) {
      const found = locate();
      if (found) {
        try { checkKeychainStatus(update(found.item, null, data.length, data)); }
        finally { found.cleanup(); }
      } else {
        const item = [null];
        try { checkKeychainStatus(add(keychain[0], serviceBytes.length, serviceBytes, accountBytes.length, accountBytes, data.length, data, item)); }
        finally { if (item[0]) release(item[0]); }
      }
    },
    remove() {
      const found = locate(); if (!found) return;
      try { checkKeychainStatus(remove(found.item)); } finally { found.cleanup(); }
    },
    close() { if (!closed) { closed = true; release(keychain[0]); } }
  };
}
