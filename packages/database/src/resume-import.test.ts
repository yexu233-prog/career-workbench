import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MaterialItem } from "@career-workbench/domain";
import {
  bootstrapDatabase, CareerWorkbenchDatabase, CareerWorkbenchRepository,
  compareResumeImport, resumeImportDifferenceKey, resumeImportSharedKey, ResumeImportValidationError,
  type ResumeImportCandidateDraft, type ResumeImportDestination
} from "./index";

let db: CareerWorkbenchDatabase;
let repository: CareerWorkbenchRepository;

beforeEach(async () => {
  db = new CareerWorkbenchDatabase(`import-test-${crypto.randomUUID()}`);
  repository = new CareerWorkbenchRepository(db);
  await bootstrapDatabase(db);
});
afterEach(async () => { await db.delete(); });

function draft(overrides: Partial<ResumeImportCandidateDraft> = {}): ResumeImportCandidateDraft {
  return { id: crypto.randomUUID(), selected: true, internalName: "虚构导入经历", category: "work", facts: {}, summary: "新表达", bullets: ["**分析**业务指标"], links: [], creationMethod: "manual", ...overrides };
}

function targetDestination(item: MaterialItem, name = "分析岗位版"): Extract<ResumeImportDestination, { mode: "new-version" }> {
  return { mode: "new-version", materialItemId: item.id, versionName: name, expectedFactRevision: item.factRevision, expectedSharedKey: resumeImportSharedKey(item) };
}

async function targetMaterial() {
  return repository.createMaterial({ internalName: "虚构已有经历", category: "work" });
}

async function saveSession(candidates: ResumeImportCandidateDraft[]) {
  return repository.saveResumeImportSession({ sourceName: "虚构简历.txt", sourceType: "txt", parsedAt: new Date().toISOString(), text: "虚构经历，仅用于测试", warnings: [], candidates });
}

describe("resume import destinations", () => {
  it("creates mixed destinations atomically, preserves AI source, and clears the session", async () => {
    const target = await targetMaterial();
    const existing = draft({ destination: targetDestination(target.item), creationMethod: "ai" });
    const fresh = draft({ category: "project", facts: { projectName: "虚构项目", unknown: "不保存" } });
    await saveSession([existing, fresh]);
    const result = await repository.commitResumeImport([existing, fresh]);
    expect(result).toMatchObject({ newMaterialCount: 1, newVersionCount: 1 });
    expect(result.created[0]).toMatchObject({ candidateId: existing.id, item: { id: target.item.id }, version: {
      name: "分析岗位版", isOriginal: false, summary: "新表达", bullets: ["**分析**业务指标"], creationMethod: "ai", sourceFactRevision: target.item.factRevision
    } });
    expect(result.created[0]?.version.aiGeneratedAt).toBeTruthy();
    expect(result.created[1]?.item.facts).toEqual({ projectName: "虚构项目" });
    expect(result.created[1]?.version.isOriginal).toBe(true);
    expect(await db.materialItems.count()).toBe(2);
    expect(await db.materialVersions.count()).toBe(3);
    expect(await repository.getResumeImportSession()).toBeUndefined();
  });

  it("preserves shared facts, links, original/other versions, notes and project snapshots", async () => {
    const target = await targetMaterial();
    const item = await repository.updateMaterial({ ...target.item, facts: { company: "虚构已有公司", startDate: "2024-01" }, links: ["https://existing.example.test"], factNotes: "已有事实笔记" }, target.item.revision);
    const original = await repository.updateVersion({ ...target.versions[0]!, summary: "已有概述" }, 1);
    await repository.createVersion(item.id, { name: "已有版本" });
    await repository.upsertInterviewNote(original.id, "已有面试备注");
    const entry = await repository.createResumeEntrySnapshot(original.id);
    const project = await repository.createResumeProject({ name: "虚构简历项目", targetRole: "分析", language: "zh-CN", targetLength: "one" });
    project.modules = [{ id: crypto.randomUUID(), title: "工作经历", kind: "material", category: "work", hidden: false, entries: [entry], text: "", pageBreakBefore: false }];
    const savedProject = await repository.updateResumeProject(project, project.revision);
    const before = await repository.getMaterialBundle(item.id);
    const candidate = draft({ facts: { company: "虚构导入公司", startDate: "2023-01" }, links: ["https://imported.example.test"], destination: targetDestination(item) });
    candidate.destination = { ...targetDestination(item), confirmedDifferenceKey: resumeImportDifferenceKey(candidate, item) };
    const result = await repository.commitResumeImport([candidate]);
    expect(await db.materialItems.get(item.id)).toEqual(item);
    const after = await repository.getMaterialBundle(item.id);
    expect(after?.versions.filter((version) => version.id !== result.created[0]?.version.id)).toEqual(before?.versions);
    expect(after?.notes).toEqual(before?.notes);
    expect(await db.resumeProjects.get(project.id)).toEqual(savedProject);
    const created = result.created[0]!.version;
    expect(created.notes).toContain("内部参考，不会出现在最终简历上");
    expect(created.notes).toContain("虚构导入公司");
    expect(created.notes).toContain("https://imported.example.test");
    expect(created.notes).toContain("2023-01");
    const newSnapshot = await repository.createResumeEntrySnapshot(created.id);
    expect(JSON.stringify(newSnapshot)).toContain("虚构已有公司");
    expect(JSON.stringify(newSnapshot)).not.toContain("虚构导入公司");
    expect(JSON.stringify(newSnapshot)).not.toContain("https://imported.example.test");
  });

  it("rejects unconfirmed differences and keeps the session and the entire batch", async () => {
    const { item } = await targetMaterial();
    const invalid = draft({ facts: { company: "导入公司" }, destination: targetDestination(item) });
    const fresh = draft();
    await saveSession([fresh, invalid]);
    await expect(repository.commitResumeImport([fresh, invalid])).rejects.toMatchObject({ candidateId: invalid.id, message: expect.stringContaining("请确认信息差异") });
    expect(await db.materialItems.count()).toBe(1);
    expect(await db.materialVersions.count()).toBe(1);
    expect((await repository.getResumeImportSession())?.candidates).toHaveLength(2);
  });

  it("invalidates difference confirmation when imported facts or links change", async () => {
    const { item } = await targetMaterial();
    const candidate = draft({ facts: { company: "原候选公司" }, destination: targetDestination(item) });
    candidate.destination = { ...targetDestination(item), confirmedDifferenceKey: resumeImportDifferenceKey(candidate, item) };
    await expect(repository.commitResumeImport([{ ...candidate, facts: { company: "修改后公司" } }])).rejects.toThrow("请确认信息差异");
    await expect(repository.commitResumeImport([{ ...candidate, links: ["https://new.example.test"] }])).rejects.toThrow("请确认信息差异");
  });

  it.each(["facts", "links", "factNotes"] as const)("requires re-review if target %s changed after selection", async (field) => {
    const { item } = await targetMaterial();
    const candidate = draft({ destination: targetDestination(item) });
    const updates = { facts: { company: "更新公司" }, links: ["https://new.example.test"], factNotes: "新的共享笔记" };
    const updated = await repository.updateMaterial({ ...item, [field]: updates[field] }, item.revision);
    if (field === "links") expect(updated.factRevision).toBe(item.factRevision);
    await expect(repository.commitResumeImport([candidate])).rejects.toThrow("重新核对共享信息");
    expect(await db.materialVersions.count()).toBe(1);
  });

  it("permits a successful save after explicit re-review and difference confirmation", async () => {
    const { item } = await targetMaterial();
    const updated = await repository.updateMaterial({ ...item, facts: { company: "更新公司" } }, 1);
    const candidate = draft({ destination: targetDestination(updated) });
    candidate.destination = { ...targetDestination(updated), confirmedDifferenceKey: resumeImportDifferenceKey(candidate, updated) };
    const result = await repository.commitResumeImport([candidate]);
    expect(result.created[0]?.version.sourceFactRevision).toBe(updated.factRevision);
  });

  it.each(["deleted", "missing", "category"] as const)("rejects a %s target and rolls back a previous new material", async (kind) => {
    const { item } = await targetMaterial();
    const candidate = draft({ destination: targetDestination(item) });
    if (kind === "deleted") await repository.moveMaterialToTrash(item.id);
    if (kind === "missing") await db.materialItems.delete(item.id);
    if (kind === "category") await repository.updateMaterial({ ...item, category: "project" }, 1);
    const itemCount = await db.materialItems.count();
    const versionCount = await db.materialVersions.count();
    await expect(repository.commitResumeImport([draft(), candidate])).rejects.toBeInstanceOf(ResumeImportValidationError);
    expect(await db.materialItems.count()).toBe(itemCount);
    expect(await db.materialVersions.count()).toBe(versionCount);
  });

  it("requires a selected target, an explicit review snapshot and a nonblank version name", async () => {
    const { item } = await targetMaterial();
    await expect(repository.commitResumeImport([draft({ destination: { mode: "new-version", materialItemId: "", versionName: "新版" } })])).rejects.toThrow("请选择");
    await expect(repository.commitResumeImport([draft({ destination: { mode: "new-version", materialItemId: item.id, versionName: "新版" } })])).rejects.toThrow("重新核对");
    await expect(repository.commitResumeImport([draft({ destination: targetDestination(item, "  ") })])).rejects.toThrow("名称不能为空");
  });

  it("rejects names matching an original or active version after trimming", async () => {
    const { item } = await targetMaterial();
    await repository.createVersion(item.id, { name: "已有版本" });
    for (const name of ["原始版本", " 已有版本 "]) {
      await expect(repository.commitResumeImport([draft({ destination: targetDestination(item, name) })])).rejects.toThrow("版本名称不能重复");
    }
    expect(await db.materialVersions.count()).toBe(2);
  });

  it("rejects duplicate names in one mixed batch without partial records", async () => {
    const { item } = await targetMaterial();
    await expect(repository.commitResumeImport([draft(), draft({ destination: targetDestination(item) }), draft({ destination: targetDestination(item) })])).rejects.toThrow("版本名称不能重复");
    expect(await db.materialItems.count()).toBe(1);
    expect(await db.materialVersions.count()).toBe(1);
  });

  it("allows distinct versions under one target and a name used only in trash", async () => {
    const { item } = await targetMaterial();
    const old = await repository.createVersion(item.id, { name: "旧版" });
    await repository.moveVersionToTrash(old.id);
    const result = await repository.commitResumeImport([draft({ destination: targetDestination(item, "旧版") }), draft({ destination: targetDestination(item, "新版") })]);
    expect(result.newVersionCount).toBe(2);
    expect((await repository.getMaterialBundle(item.id))?.versions).toHaveLength(3);
    expect(await db.materialItems.count()).toBe(1);
  });

  it("ignores unselected invalid candidates and rejects duplicate selected candidate IDs", async () => {
    const valid = draft();
    await repository.commitResumeImport([valid, draft({ selected: false, internalName: "" })]);
    await expect(repository.commitResumeImport([valid, valid])).rejects.toThrow("同一候选不能重复");
    expect(await db.materialItems.count()).toBe(1);
  });

  it("rechecks uniqueness inside concurrent transactions", async () => {
    const { item } = await targetMaterial();
    const outcomes = await Promise.allSettled([
      repository.commitResumeImport([draft({ destination: targetDestination(item) })]),
      repository.commitResumeImport([draft({ destination: targetDestination(item) })])
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await db.materialVersions.count()).toBe(2);
  });

  it("restores the complete target choice and confirmation and defaults legacy drafts to new material", async () => {
    const { item } = await targetMaterial();
    const candidate = draft({ facts: { company: "导入公司" }, destination: targetDestination(item) });
    candidate.destination = { ...targetDestination(item), confirmedDifferenceKey: resumeImportDifferenceKey(candidate, item) };
    await saveSession([candidate, draft()]);
    const restored = await repository.getResumeImportSession();
    expect(restored?.candidates[0]).toEqual(candidate);
    expect(restored?.candidates[1]?.destination).toEqual({ mode: "new-material" });
    await repository.moveMaterialToTrash(item.id);
    const restoredAgain = await repository.getResumeImportSession();
    expect(restoredAgain?.candidates[0]?.destination).toEqual(candidate.destination);
    await expect(repository.commitResumeImport(restoredAgain!.candidates)).rejects.toThrow("回收站");
    expect(await repository.getResumeImportSession()).toBeDefined();
  });

  it("compares only category facts, preserves missing-value differences and handles boolean facts", async () => {
    const { item } = await targetMaterial();
    const rows = compareResumeImport(draft({ facts: { isCurrent: false, company: "导入公司", unknown: "忽略" } }), item);
    expect(rows.find((row) => row.key === "isCurrent")?.different).toBe(false);
    expect(rows.find((row) => row.key === "company")).toMatchObject({ different: true, existing: "未填写", imported: "导入公司" });
    expect(rows.some((row) => row.key === "unknown")).toBe(false);
  });

  it("searches only active same-category targets by organization or internal name", async () => {
    const { item } = await targetMaterial();
    await repository.updateMaterial({ ...item, facts: { company: "星河示例公司" } }, 1);
    const trashed = await repository.createMaterial({ internalName: "星河旧经历", category: "work" });
    await repository.moveMaterialToTrash(trashed.item.id);
    await repository.createMaterial({ internalName: "星河项目", category: "project" });
    expect((await repository.listMaterialSummaries({ category: "work", query: "星河" })).map((row) => row.item.id)).toEqual([item.id]);
  });
});
