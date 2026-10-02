import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PdfRenderRequest, PdfServiceStatus } from "@career-workbench/shared";
import type { ResumeDocumentModel } from "@career-workbench/domain";
import { ResumePreview } from "../components/ResumePreview";
import resumeDocumentCss from "../resume-document.css?inline";
import { localServiceError } from "./user-errors";

let clientToken = "";

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => { throw new Error("本机 PDF 服务响应异常，请重启求职工作台后重试。"); }) as T & { message?: string };
  if (!response.ok) throw new Error(data.message || "本机 PDF 服务请求失败");
  return data;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  try { return await fetch(path, init); }
  catch (error) { throw localServiceError(error, "生成 PDF"); }
}

export async function getPdfStatus(): Promise<PdfServiceStatus> {
  const status = await readJson<PdfServiceStatus>(await request("/api/pdf/status"));
  clientToken = status.clientToken;
  return status;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("个人照片读取失败；请移除照片后重试导出"));
    reader.readAsDataURL(blob);
  });
}

export async function requestResumePdf(model: ResumeDocumentModel, signal?: AbortSignal): Promise<Blob> {
  if (!clientToken) await getPdfStatus();
  const photoUrl = model.profile.photo ? await blobToDataUrl(model.profile.photo.data) : "";
  const html = renderResumePdfHtml(model, photoUrl);
  const payload: PdfRenderRequest = {
    requestId: crypto.randomUUID(),
    templateId: model.style.templateId,
    templateVersion: model.style.templateVersion,
    pageCount: model.pages.length,
    html,
    css: resumeDocumentCss
  };
  const response = await request("/api/pdf/render", {
    method: "POST",
    headers: { "content-type": "application/json", "x-pdf-client-token": clientToken },
    ...(signal ? { signal } : {}),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ message: "PDF 生成失败" })) as { message?: string };
    throw new Error(data.message || "PDF 生成失败");
  }
  return response.blob();
}

export function renderResumePdfHtml(model: ResumeDocumentModel, photoUrl = ""): string {
  return renderToStaticMarkup(createElement(ResumePreview, { model, ...(photoUrl ? { photoUrlOverride: photoUrl } : {}) }));
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: Array<{ description: string; accept: Record<string, string[]> }>;
}

interface WritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<WritableFileStream>;
}

type WindowWithSavePicker = Window & { showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<SaveFileHandle> };

export async function saveFileBlob(blob: Blob, filename: string, mimeType: string, description: string, extension: string): Promise<"saved" | "cancelled" | "downloaded"> {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename, types: [{ description, accept: { [mimeType]: [extension] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return "downloaded";
}

export function savePdfBlob(blob: Blob, filename: string): Promise<"saved" | "cancelled" | "downloaded"> {
  return saveFileBlob(blob, filename, "application/pdf", "PDF 文档", ".pdf");
}

export function saveDocxBlob(blob: Blob, filename: string): Promise<"saved" | "cancelled" | "downloaded"> {
  return saveFileBlob(blob, filename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word 文档", ".docx");
}
