import Foundation
import Security

// Credentials never enter argv or error output. Exit codes provide safe failure categories.
func fail(_ status: OSStatus = errSecParam) -> Never {
    exit(status == errSecAuthFailed || status == errSecInteractionNotAllowed || status == errSecUserCanceled ? 3 : 2)
}
guard CommandLine.arguments.count == 2 else { fail() }
let operation = CommandLine.arguments[1]
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "career-workbench.local-ai-config",
    kSecAttrAccount as String: "current-user",
    kSecAttrSynchronizable as String: false
]
func output(_ value: Any) {
    guard let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { fail() }
    FileHandle.standardOutput.write(bytes)
}
switch operation {
case "load":
    var request = query
    request[kSecReturnData as String] = true
    request[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { output(NSNull()); exit(0) }
    guard status == errSecSuccess else { fail(status) }
    guard let bytes = result as? Data, bytes.count <= 65536,
          let value = try? JSONSerialization.jsonObject(with: bytes), value is [String: Any] else { fail() }
    output(value)
case "save":
    let bytes = FileHandle.standardInput.readData(ofLength: 65537)
    guard !bytes.isEmpty, bytes.count <= 65536,
          let value = try? JSONSerialization.jsonObject(with: bytes), let config = value as? [String: Any],
          let key = config["apiKey"] as? String, !key.isEmpty else { fail() }
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
    if status == errSecItemNotFound {
        var item = query
        item[kSecValueData as String] = bytes
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        guard added == errSecSuccess else { fail(added) }
    } else if status != errSecSuccess { fail(status) }
    output(true)
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail(status) }
    output(true)
default: fail()
}
