import { CATEGORY_FIELDS, type MaterialItem, type MaterialVersion } from "@career-workbench/domain";
import type { ImportedMaterialDraft, ResumeImportCandidateDraft } from "./index";

export type ResumeImportDestination =
  | { mode: "new-material" }
  | {
      mode: "new-version";
      materialItemId: string;
      versionName: string;
      expectedFactRevision?: number;
      expectedSharedKey?: string;
      confirmedDifferenceKey?: string;
    };

export interface ResumeImportCommitResult {
  newMaterialCount: number;
  newVersionCount: number;
  created: { candidateId: string; item: MaterialItem; version: MaterialVersion }[];
}

export class ResumeImportValidationError extends Error {
  constructor(public readonly candidateId: string, message: string) {
    super(message);
    this.name = "ResumeImportValidationError";
  }
}

export function normalizeImportedFacts(draft: Pick<ImportedMaterialDraft, "category" | "facts">): MaterialItem["facts"] {
  const facts: MaterialItem["facts"] = {};
  for (const field of CATEGORY_FIELDS[draft.category]) {
    const value = draft.facts[field.key];
    if (field.type === "boolean") {
      if (value !== undefined) facts[field.key] = value === true || value === "true";
    } else if (typeof value === "string" && value.trim()) facts[field.key] = value.trim();
  }
  return facts;
}

const cleanLinks = (links: string[]) => links.map((link) => link.trim()).filter(Boolean);
const displayFact = (value: string | boolean | undefined) =>
  typeof value === "boolean" ? (value ? "是" : "否") : value || "未填写";

export interface ResumeImportComparison {
  key: string;
  label: string;
  existing: string;
  imported: string;
  different: boolean;
}

export function compareResumeImport(draft: ImportedMaterialDraft, item: MaterialItem): ResumeImportComparison[] {
  const imported = normalizeImportedFacts(draft);
  const existing = normalizeImportedFacts(item);
  const rows = CATEGORY_FIELDS[draft.category].flatMap((field) => {
    const left = existing[field.key];
    const right = imported[field.key];
    if (left === undefined && right === undefined) return [];
    // An unchecked optional checkbox and a missing value both mean not enabled.
    const different = field.type === "boolean" ? Boolean(left) !== Boolean(right) : left !== right;
    return [{ key: field.key, label: field.label, existing: displayFact(left), imported: displayFact(right), different }];
  });
  const existingLinks = cleanLinks(item.links).join("\n");
  const importedLinks = cleanLinks(draft.links).join("\n");
  if (existingLinks || importedLinks) rows.push({ key: "links", label: "相关链接", existing: existingLinks || "未填写", imported: importedLinks || "未填写", different: existingLinks !== importedLinks });
  return rows;
}

// Also track links: the existing factRevision only covers facts and factNotes.
export function resumeImportSharedKey(item: MaterialItem): string {
  return JSON.stringify([item.category, normalizeImportedFacts(item), cleanLinks(item.links)]);
}

export function resumeImportDifferenceKey(draft: ImportedMaterialDraft, item: MaterialItem): string {
  return JSON.stringify([item.id, compareResumeImport(draft, item).filter((row) => row.different)]);
}

export function resumeImportReferenceNotes(draft: ImportedMaterialDraft, item: MaterialItem): string {
  const differences = compareResumeImport(draft, item).filter((row) => row.different);
  if (!differences.length) return "";
  return [
    "导入信息差异（内部参考，不会出现在最终简历上）",
    `导入候选：${draft.internalName.trim() || "未命名候选"}`,
    "用户已确认属于同一段经历；新版本沿用已有素材的共享事实和链接，未自动覆盖或合并。",
    ...differences.map((row) => `${row.label}\n已有素材：${row.existing}\n导入候选：${row.imported}`)
  ].join("\n\n");
}

export function validateResumeImportTarget(candidate: ResumeImportCandidateDraft, item: MaterialItem | undefined): string | undefined {
  const destination = candidate.destination;
  if (destination?.mode !== "new-version") return undefined;
  if (!destination.materialItemId) return "请选择要添加版本的已有素材";
  if (!item || item.deletedAt) return "目标素材不存在或已移入回收站，请重新选择";
  if (item.category !== candidate.category) return "目标素材与候选类别不同，请修正类别或重新选择素材";
  if (destination.expectedFactRevision !== item.factRevision || destination.expectedSharedKey !== resumeImportSharedKey(item)) {
    return "目标素材的共享信息已变化或尚未核对，请重新核对共享信息";
  }
  if (!destination.versionName.trim()) return "新版本名称不能为空";
  if (compareResumeImport(candidate, item).some((row) => row.different)
    && destination.confirmedDifferenceKey !== resumeImportDifferenceKey(candidate, item)) {
    return "请确认信息差异：属于同一段经历，并使用已有素材的共享信息";
  }
  return undefined;
}

export function buildImportedVersion(draft: ImportedMaterialDraft, item: MaterialItem, name: string, isOriginal: boolean, timestamp: string): MaterialVersion {
  return {
    id: isOriginal ? item.originalVersionId : crypto.randomUUID(),
    schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1,
    materialItemId: item.id, name, isOriginal, language: "zh-CN",
    summary: draft.summary.trim(), bullets: draft.bullets.map((bullet) => bullet.trim()).filter(Boolean),
    targetRole: "", jdText: "", emphasis: "", tags: [],
    notes: isOriginal ? "" : resumeImportReferenceNotes(draft, item),
    creationMethod: draft.creationMethod, sourceFactRevision: item.factRevision,
    ...(draft.creationMethod === "ai" ? { aiGeneratedAt: timestamp } : {})
  };
}
