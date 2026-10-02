type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }> };

/** "download" only means a download was triggered; the user must confirm the file exists. */
export async function saveBackupBlob(blob: Blob, filename: string): Promise<"picker" | "download"> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker) {
    const handle = await picker({ suggestedName: filename, types: [{ description: "求职工作台完整备份", accept: { "application/json": [".json"] } }] });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return "picker";
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "download";
}
