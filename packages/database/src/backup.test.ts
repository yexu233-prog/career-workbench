import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CareerWorkbenchDatabase, CareerWorkbenchRepository, bootstrapDatabase, isBackupReminderDue } from "./index";

let db: CareerWorkbenchDatabase;
let repository: CareerWorkbenchRepository;

beforeEach(async () => {
  db = new CareerWorkbenchDatabase(`backup-test-${crypto.randomUUID()}`);
  repository = new CareerWorkbenchRepository(db);
  await bootstrapDatabase(db);
});
afterEach(async () => { await db.delete(); });

describe("full backup", () => {
  it("round-trips business records and Blob data while excluding temporary data", async () => {
    const bundle = await repository.createMaterial({ internalName: "虚构项目", category: "project" });
    const experience = await repository.createExperience(bundle.item.id, "虚构项目经历");
    await repository.updateExperience(bundle.item.id, { ...experience, content: "仅用于回归测试的经历文本" }, experience.revision);
    const trashedExperience = await repository.createExperience(bundle.item.id, "已删除的虚构经历");
    const experienceTrashBatch = await repository.moveExperienceToTrash(bundle.item.id, trashedExperience.id);
    const version = bundle.versions[0]!;
    await repository.upsertInterviewNote(version.id, "面试时说明虚构结果");
    await repository.createResumeProject({ name: "虚构简历", targetRole: "产品经理", language: "zh-CN", targetLength: "one", jdText: "虚构 JD" });
    await db.assets.put({ id: "profile-photo", schemaVersion: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, kind: "profile-photo", name: "fake.png", mimeType: "image/png", size: 4, data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" }) });
    await db.settings.bulkPut([
      { key: "onboarding-state", value: { schemaVersion: 1, status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z" }, updatedAt: new Date().toISOString() },
      { key: "resume-import-session", value: { text: "temporary", candidates: [] }, updatedAt: new Date().toISOString() }
    ]);
    await repository.recordBackupSaved("picker");
    await db.aiCandidates.put({ id: "candidate", taskType: "generate-version", targetId: bundle.item.id, response: { requestId: "fake", status: "ready", result: { title: "temporary", summary: "temporary", bullets: [], content: "temporary", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [], provider: "fake", model: "fake" }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10000).toISOString(), approximateBytes: 10 });

    const envelope = await repository.createFullBackup();
    expect(envelope.payload.settings).toHaveLength(1);
    expect(envelope.payload.settings[0]).toMatchObject({ key: "onboarding-state" });
    expect(JSON.stringify(envelope)).not.toContain("temporary");
    expect(JSON.stringify(envelope)).not.toContain("backup-status");
    const inspection = await repository.inspectBackupFile(new Blob([JSON.stringify(envelope)], { type: "application/json" }));
    expect(inspection.compatible).toBe(true);
    expect(inspection.validatedBackup?.summary.recordCounts.materialItems).toBe(1);

    await db.materialItems.clear();
    await db.materialVersions.clear();
    await db.interviewNotes.clear();
    await db.resumeProjects.clear();
    await db.assets.clear();
    await db.settings.clear();
    await repository.restoreFullBackup(inspection.validatedBackup!);
    expect(await db.materialItems.count()).toBe(1);
    expect(await db.materialVersions.count()).toBe(1);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.[0]).toMatchObject({ id: experience.id, name: "虚构项目经历", content: "仅用于回归测试的经历文本" });
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === bundle.item.id)).toMatchObject({ needsReview: true, reviewPendingVersionCount: 1 });
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.find((item) => item.id === trashedExperience.id)?.deletedAt).toBeTruthy();
    expect((await repository.listTrash()).some((batch) => batch.id === experienceTrashBatch.id)).toBe(true);
    await repository.restoreTrashBatch(experienceTrashBatch.id);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.find((item) => item.id === trashedExperience.id)?.deletedAt).toBeUndefined();
    expect(await db.interviewNotes.count()).toBe(1);
    expect(await db.resumeProjects.count()).toBe(1);
    expect((await db.assets.get("profile-photo"))?.data).toBeInstanceOf(Blob);
    expect(await db.settings.get("resume-import-session")).toBeUndefined();
    expect(await repository.getBackupStatus()).toBeNull();
    expect(await db.aiCandidates.count()).toBe(0);
  });

  it("records only confirmed backup saves and reminds after seven days", async () => {
    expect(await repository.getBackupStatus()).toBeNull();
    expect(isBackupReminderDue(null)).toBe(true);
    const status = await repository.recordBackupSaved("confirmed-download");
    expect(await repository.getBackupStatus()).toEqual(status);
    const savedAt = Date.parse(status.lastSavedAt);
    expect(isBackupReminderDue(status, savedAt + 7 * 24 * 60 * 60 * 1000 - 1)).toBe(false);
    expect(isBackupReminderDue(status, savedAt + 7 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it("rejects a tampered or incompatible file without writing", async () => {
    const envelope = await repository.createFullBackup();
    const tampered = { ...envelope, appVersion: "tampered" };
    const inspection = await repository.inspectBackupFile(new Blob([JSON.stringify(tampered)]));
    expect(inspection.compatible).toBe(false);
    expect(inspection.errors.join(" ")).toContain("校验和");
    expect(await db.profiles.count()).toBe(1);
    const incompatible = { ...envelope, formatVersion: 99 };
    const incompatibleResult = await repository.inspectBackupFile(new Blob([JSON.stringify(incompatible)]));
    expect(incompatibleResult.compatible).toBe(false);
    expect(await db.profiles.count()).toBe(1);
  });
  it("rolls back every table when restore writing fails", async () => {
    const bundle = await repository.createMaterial({ internalName: "保留中的虚构素材", category: "work" });
    const envelope = await repository.createFullBackup();
    const inspection = await repository.inspectBackupFile(new Blob([JSON.stringify(envelope)]));
    const invalid = structuredClone(inspection.validatedBackup!);
    invalid.decodedPayload.materialItems.push(structuredClone(invalid.decodedPayload.materialItems[0]));
    await expect(repository.restoreFullBackup(invalid)).rejects.toBeTruthy();
    expect(await db.materialItems.get(bundle.item.id)).toBeTruthy();
    expect(await db.materialItems.count()).toBe(1);
    expect(await db.profiles.count()).toBe(1);
  });
});
