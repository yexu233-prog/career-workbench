import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CareerWorkbenchDatabase,
  CareerWorkbenchRepository,
  DuplicateVersionNameError,
  MaterialFactsChangedError,
  RevisionConflictError,
  bootstrapDatabase
} from "./index";

let db: CareerWorkbenchDatabase;
let repository: CareerWorkbenchRepository;

beforeEach(async () => {
  db = new CareerWorkbenchDatabase(`test-${crypto.randomUUID()}`);
  repository = new CareerWorkbenchRepository(db);
  await bootstrapDatabase(db);
});

afterEach(async () => {
  await db.delete();
});

describe("onboarding repository", () => {
  it("returns a new state without writing a settings record", async () => {
    expect(await repository.getOnboardingState()).toEqual({
      schemaVersion: 1,
      status: "new",
      startedAt: null,
      completedAt: null
    });
    expect(await db.settings.get("onboarding-state")).toBeUndefined();
  });

  it("starts and completes onboarding with local timestamps", async () => {
    const started = await repository.startOnboarding();
    expect(started.status).toBe("started");
    expect(started.startedAt).toBeTruthy();
    expect(started.completedAt).toBeNull();

    const completed = await repository.completeOnboarding();
    expect(completed.status).toBe("completed");
    expect(completed.startedAt).toBe(started.startedAt);
    expect(completed.completedAt).toBeTruthy();
    expect((await db.settings.get("onboarding-state"))?.value).toEqual(completed);
  });

  it("keeps a completed state when the tutorial is opened again", async () => {
    const completed = await repository.completeOnboarding();
    const reopened = await repository.startOnboarding();
    const completedAgain = await repository.completeOnboarding();
    expect(reopened).toEqual(completed);
    expect(completedAgain).toEqual(completed);
  });

  it("discards an invalid onboarding setting and safely returns to new", async () => {
    await db.settings.put({ key: "onboarding-state", value: { schemaVersion: 99, status: "completed" }, updatedAt: new Date().toISOString() });
    expect(await repository.getOnboardingState()).toEqual({ schemaVersion: 1, status: "new", startedAt: null, completedAt: null });
    expect(await db.settings.get("onboarding-state")).toBeUndefined();
  });
});

describe("material repository", () => {
  it("keeps one stable profile when reads overlap after bootstrap", async () => {
    const [first, second] = await Promise.all([repository.getProfile(), repository.getProfile()]);
    expect(first.id).toBe("default");
    expect(second.id).toBe("default");
    expect(await db.profiles.count()).toBe(1);
  });

  it("creates a material with exactly one original version", async () => {
    const bundle = await repository.createMaterial({ internalName: "支付系统重构", category: "project" });
    expect(bundle.item.internalName).toBe("支付系统重构");
    expect(bundle.versions).toHaveLength(1);
    expect(bundle.versions[0]).toMatchObject({ name: "原始版本", isOriginal: true, materialItemId: bundle.item.id });
    expect(bundle.item.originalVersionId).toBe(bundle.versions[0]?.id);
  });

  it("prevents duplicate active version names", async () => {
    const bundle = await repository.createMaterial({ internalName: "用户研究", category: "work" });
    await repository.createVersion(bundle.item.id, { name: "产品经理版" });
    await expect(repository.createVersion(bundle.item.id, { name: "产品经理版" })).rejects.toBeInstanceOf(DuplicateVersionNameError);
  });

  it("detects stale revisions", async () => {
    const bundle = await repository.createMaterial({ internalName: "数据看板", category: "project" });
    await repository.updateMaterial({ ...bundle.item, factNotes: "第一次修改" }, 1);
    await expect(repository.updateMaterial({ ...bundle.item, factNotes: "过期修改" }, 1)).rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("creates, autosaves and independently revisions named experience content", async () => {
    const bundle = await repository.createMaterial({ internalName: "校园活动", category: "campus" });
    const experience = await repository.createExperience(bundle.item.id, "迎新活动优化");
    const saved = await repository.updateExperience(bundle.item.id, { ...experience, content: "情境与行动的虚构描述" }, experience.revision);
    expect(saved.revision).toBe(2);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.[0]).toMatchObject({ id: experience.id, name: "迎新活动优化", content: "情境与行动的虚构描述" });
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.factRevision).toBe(bundle.item.factRevision + 1);
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === bundle.item.id)?.reviewPendingVersionCount).toBe(1);
    await expect(repository.updateExperience(bundle.item.id, { ...experience, name: "过期覆盖" }, experience.revision)).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(repository.createExperience(bundle.item.id, "迎新活动优化")).rejects.toThrow("不能重复");
  });

  it("moves an experience into trash, restores it and permanently removes it", async () => {
    const bundle = await repository.createMaterial({ internalName: "志愿活动素材", category: "project" });
    const experience = await repository.createExperience(bundle.item.id, "服务流程优化");
    await repository.updateExperience(bundle.item.id, { ...experience, content: "示例经历正文" }, experience.revision);
    const batch = await repository.moveExperienceToTrash(bundle.item.id, experience.id);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.[0]?.deletedAt).toBeTruthy();
    await repository.restoreTrashBatch(batch.id);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.[0]?.deletedAt).toBeUndefined();
    const secondBatch = await repository.moveExperienceToTrash(bundle.item.id, experience.id);
    await repository.permanentlyDeleteTrashBatch(secondBatch.id);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences).toEqual([]);
  });

  it("keeps experience content when the material changes to an unsupported category", async () => {
    const bundle = await repository.createMaterial({ internalName: "工作经历", category: "work" });
    const experience = await repository.createExperience(bundle.item.id, "产品改版");
    await repository.updateExperience(bundle.item.id, { ...experience, content: "虚构经历" }, experience.revision);
    const latest = (await repository.getMaterialBundle(bundle.item.id))!.item;
    await repository.updateMaterial({ ...latest, category: "custom" }, latest.revision);
    expect((await repository.getMaterialBundle(bundle.item.id))?.item.experiences?.[0]?.content).toBe("虚构经历");
    await expect(repository.createExperience(bundle.item.id, "不支持的新增")).rejects.toThrow("不支持新增");
  });

  it("removes nested experience trash links when its parent material is permanently deleted", async () => {
    const bundle = await repository.createMaterial({ internalName: "工作项目", category: "project" });
    const experience = await repository.createExperience(bundle.item.id, "项目推进");
    const experienceBatch = await repository.moveExperienceToTrash(bundle.item.id, experience.id);
    const materialBatch = await repository.moveMaterialToTrash(bundle.item.id);
    expect(await repository.listTrash()).toHaveLength(2);
    await repository.permanentlyDeleteTrashBatch(materialBatch.id);
    expect(await repository.listTrash()).toHaveLength(0);
    expect(await db.materialItems.get(bundle.item.id)).toBeUndefined();
    await expect(repository.restoreTrashBatch(experienceBatch.id)).rejects.toThrow("回收站记录不存在");
  });

  it("creates AI versions only while the selected experience revisions are still current", async () => {
    const bundle = await repository.createMaterial({ internalName: "项目成果素材", category: "project" });
    const experience = await repository.createExperience(bundle.item.id, "项目交付");
    const savedExperience = await repository.updateExperience(bundle.item.id, { ...experience, content: "虚构的完整经历文本" }, experience.revision);
    await expect(repository.createAiVersionFromExperiences(bundle.item.id, {
      name: "岗位版", language: "zh-CN", targetRole: "产品经理", jdText: "虚构 JD", emphasis: "突出交付", summary: "候选概述", bullets: ["候选要点"], aiModel: "fake-model",
      experienceRevisions: [{ id: experience.id, revision: experience.revision }]
    })).rejects.toThrow("已变化或已删除");
    const created = await repository.createAiVersionFromExperiences(bundle.item.id, {
      name: "岗位版", language: "zh-CN", targetRole: "产品经理", jdText: "虚构 JD", emphasis: "突出交付", summary: "候选概述", bullets: ["候选要点"], aiModel: "fake-model",
      experienceRevisions: [{ id: savedExperience.id, revision: savedExperience.revision }]
    });
    expect(created).toMatchObject({ name: "岗位版", summary: "候选概述", bullets: ["候选要点"], creationMethod: "ai", sourceFactRevision: (await repository.getMaterialBundle(bundle.item.id))?.item.factRevision });
  });

  it("moves a version and its note to trash and restores both", async () => {
    const bundle = await repository.createMaterial({ internalName: "增长实验", category: "project" });
    const version = await repository.createVersion(bundle.item.id, { name: "增长岗位版" });
    const note = await repository.upsertInterviewNote(version.id, "重点说明实验假设");
    const item = (await repository.getMaterialBundle(bundle.item.id))!.item;
    await repository.updateMaterial({ ...item, factNotes: "新增实验边界" }, item.revision);
    const batch = await repository.moveVersionToTrash(version.id);
    expect((await repository.getMaterialBundle(bundle.item.id))?.versions.some((item) => item.id === version.id)).toBe(false);
    expect(await repository.listTrash()).toHaveLength(1);
    await repository.restoreTrashBatch(batch.id);
    const restored = await repository.getMaterialBundle(bundle.item.id);
    expect(restored?.versions.some((item) => item.id === version.id)).toBe(true);
    expect(restored?.notes.some((item) => item.id === note.id)).toBe(true);
    expect(restored?.versions.find((item) => item.id === version.id)?.sourceFactRevision).toBe(version.sourceFactRevision);
  });

  it("copies all active versions and notes into an independent material", async () => {
    const bundle = await repository.createMaterial({ internalName: "客户洞察", category: "work" });
    const version = await repository.createVersion(bundle.item.id, {
      name: "咨询版",
      referenceVersionId: bundle.item.originalVersionId
    });
    await repository.upsertInterviewNote(version.id, "客户访谈复盘");
    const experience = await repository.createExperience(bundle.item.id, "客户访谈");
    await repository.updateExperience(bundle.item.id, { ...experience, content: "访谈内容" }, experience.revision);
    const copied = await repository.copyMaterial(bundle.item.id);
    expect(copied.item.id).not.toBe(bundle.item.id);
    expect(copied.item.internalName).toBe("客户洞察（副本）");
    expect(copied.versions).toHaveLength(2);
    expect(copied.notes).toHaveLength(1);
    expect(copied.item.experiences?.[0]?.id).not.toBe(experience.id);
    expect(copied.item.experiences?.[0]?.content).toBe("访谈内容");
    expect(copied.item.factRevision).toBe(bundle.item.factRevision + 1);
    expect(copied.versions.every((item) => item.sourceFactRevision < copied.item.factRevision)).toBe(true);
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === copied.item.id)?.reviewPendingVersionCount).toBe(2);
  });

  it("cascades a material into one trash batch and permanently removes every record", async () => {
    const bundle = await repository.createMaterial({ internalName: "渠道策略", category: "work" });
    const version = await repository.createVersion(bundle.item.id, { name: "运营版" });
    await repository.upsertInterviewNote(version.id, "复盘渠道选择");

    const batch = await repository.moveMaterialToTrash(bundle.item.id);
    expect(batch.entries).toHaveLength(4);
    expect(await repository.getMaterialBundle(bundle.item.id)).toBeUndefined();

    await repository.permanentlyDeleteTrashBatch(batch.id);
    expect(await repository.listTrash()).toHaveLength(0);
    expect(await db.materialItems.get(bundle.item.id)).toBeUndefined();
    expect(await db.materialVersions.where("materialItemId").equals(bundle.item.id).count()).toBe(0);
    expect(await db.interviewNotes.where("materialVersionId").equals(version.id).count()).toBe(0);
  });

  it("does not clear pending review on version edits and clears it only after explicit confirmation", async () => {
    const bundle = await repository.createMaterial({ internalName: "指标体系", category: "project" });
    const changedItem = await repository.updateMaterial({ ...bundle.item, factNotes: "补充事实" }, bundle.item.revision);
    const original = bundle.versions[0]!;
    const savedVersion = await repository.updateVersion({ ...original, summary: "重新核对后的表达" }, original.revision);
    expect(savedVersion.sourceFactRevision).toBe(original.sourceFactRevision);
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === bundle.item.id)).toMatchObject({
      needsReview: true,
      reviewPendingVersionCount: 1
    });

    const reviewed = await repository.markVersionFactsReviewed(savedVersion.id, savedVersion.revision, changedItem.factRevision);
    expect(reviewed.sourceFactRevision).toBe(changedItem.factRevision);
    expect(reviewed.revision).toBe(savedVersion.revision + 1);
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === bundle.item.id)).toMatchObject({
      needsReview: false,
      reviewPendingVersionCount: 0
    });
    const repeatedConfirmation = await repository.markVersionFactsReviewed(reviewed.id, reviewed.revision, changedItem.factRevision);
    expect(repeatedConfirmation.revision).toBe(reviewed.revision);
  });

  it("rejects a review confirmation if facts or the version changed while the user was checking", async () => {
    const bundle = await repository.createMaterial({ internalName: "服务流程", category: "work" });
    const original = bundle.versions[0]!;
    const changedItem = await repository.updateMaterial({ ...bundle.item, factNotes: "补充事实一" }, bundle.item.revision);
    const latestItem = await repository.updateMaterial({ ...changedItem, factNotes: "补充事实二" }, changedItem.revision);
    await expect(repository.markVersionFactsReviewed(original.id, original.revision, changedItem.factRevision))
      .rejects.toBeInstanceOf(MaterialFactsChangedError);
    expect((await db.materialVersions.get(original.id))?.sourceFactRevision).toBe(original.sourceFactRevision);
    await expect(repository.markVersionFactsReviewed(original.id, original.revision + 1, latestItem.factRevision))
      .rejects.toBeInstanceOf(RevisionConflictError);
  });

  it("preserves stale review state when manually copying a version", async () => {
    const bundle = await repository.createMaterial({ internalName: "预算分析", category: "project" });
    const changedItem = await repository.updateMaterial({ ...bundle.item, factNotes: "补充事实" }, bundle.item.revision);
    const copied = await repository.createVersion(bundle.item.id, {
      name: "复制版本",
      referenceVersionId: bundle.versions[0]!.id,
      inheritReviewState: true
    });
    const aiFresh = await repository.createVersion(bundle.item.id, { name: "新生成版本", referenceVersionId: bundle.versions[0]!.id });
    expect(copied.sourceFactRevision).toBe(bundle.versions[0]?.sourceFactRevision);
    expect(copied.sourceFactRevision).toBeLessThan(changedItem.factRevision);
    expect(aiFresh.sourceFactRevision).toBe(changedItem.factRevision);
  });

  it("imports confirmed resume candidates in one batch and discards unknown facts", async () => {
    const imported = await repository.importMaterials([
      { internalName: "示例公司产品经理", category: "work", facts: { company: "示例公司", position: "产品经理", unknown: "不应保存" }, summary: "负责产品规划", bullets: ["推动项目交付"], links: [], creationMethod: "ai" },
      { internalName: "示例大学", category: "education", facts: { school: "示例大学", major: "计算机" }, summary: "", bullets: [], links: [], creationMethod: "manual" }
    ]);
    expect(imported).toHaveLength(2);
    expect(imported[0]?.item.facts).toEqual({ company: "示例公司", position: "产品经理" });
    expect(imported[0]?.versions[0]).toMatchObject({ summary: "负责产品规划", bullets: ["推动项目交付"], creationMethod: "ai" });
    expect(await db.materialItems.count()).toBe(2);
    expect(await db.materialVersions.count()).toBe(2);
  });

  it("does not write a partial import batch when a candidate is invalid", async () => {
    await expect(repository.importMaterials([
      { internalName: "有效候选", category: "project", facts: {}, summary: "", bullets: [], links: [], creationMethod: "manual" },
      { internalName: "   ", category: "work", facts: {}, summary: "", bullets: [], links: [], creationMethod: "manual" }
    ])).rejects.toThrow("名称不能为空");
    expect(await db.materialItems.count()).toBe(0);
    expect(await db.materialVersions.count()).toBe(0);
  });

  it("saves, restores and clears a temporary resume import session", async () => {
    const saved = await repository.saveResumeImportSession({
      sourceName: "示例简历.txt",
      sourceType: "txt",
      parsedAt: "2026-08-19T00:00:00.000Z",
      text: "示例公司\n产品经理",
      warnings: ["请核对日期"],
      candidates: [{ id: "candidate-1", selected: true, internalName: "示例经历", category: "work", facts: { company: "示例公司" }, summary: "负责产品工作", bullets: [], links: [], creationMethod: "manual" }]
    });
    expect(saved.expiresAt).toBeTruthy();
    expect((await repository.getResumeImportSession())?.candidates[0]?.internalName).toBe("示例经历");
    await repository.deleteResumeImportSession();
    expect(await repository.getResumeImportSession()).toBeUndefined();
  });

  it("clears the temporary session in the same transaction as a successful import", async () => {
    await repository.saveResumeImportSession({ sourceName: "示例.txt", sourceType: "txt", parsedAt: new Date().toISOString(), text: "示例经历", warnings: [], candidates: [] });
    await repository.importMaterials([{ internalName: "正式素材", category: "custom", facts: {}, summary: "", bullets: [], links: [], creationMethod: "manual" }]);
    expect(await repository.getResumeImportSession()).toBeUndefined();
    expect(await db.materialItems.count()).toBe(1);
  });

  it("removes an expired resume import session instead of restoring it", async () => {
    await db.settings.put({
      key: "resume-import-session",
      updatedAt: "2026-08-01T00:00:00.000Z",
      value: { schemaVersion: 1, createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-02T00:00:00.000Z", sourceName: "过期.txt", sourceType: "txt", parsedAt: "2026-08-01T00:00:00.000Z", text: "过期内容", warnings: [], candidates: [] }
    });
    expect(await repository.getResumeImportSession()).toBeUndefined();
    expect(await db.settings.get("resume-import-session")).toBeUndefined();
  });
});

describe("resume project repository", () => {
  it("creates a long-lived project with an independent profile snapshot", async () => {
    const profile = await repository.getProfile();
    await repository.updateProfile({ ...profile, chineseName: "测试用户", skills: ["需求分析"] }, profile.revision);
    const project = await repository.createResumeProject({
      name: "产品经理求职简历",
      targetRole: "产品经理",
      language: "zh-CN",
      targetLength: "one"
    });
    const latestProfile = await repository.getProfile();
    await repository.updateProfile({ ...latestProfile, chineseName: "后来修改" }, latestProfile.revision);
    expect(project.profile.chineseName).toBe("测试用户");
    expect(project.profile.skills).toEqual(["需求分析"]);
    expect((await repository.getResumeProjectBundle(project.id))?.profileSource.status).toBe("updated");
  });

  it("creates new projects with the current template and puts school first in education snapshots", async () => {
    const project = await repository.createResumeProject({ name: "教育排版回归", targetRole: "产品经理", language: "zh-CN", targetLength: "one" });
    expect(project.style.templateVersion).toBe(2);
    const education = await repository.createMaterial({ internalName: "示例大学", category: "education" });
    const populatedEducation = await repository.updateMaterial({
      ...education.item,
      facts: { school: "示例大学", major: "社会学", degree: "硕士" }
    }, education.item.revision);
    const entry = await repository.createResumeEntrySnapshot(populatedEducation.originalVersionId);
    expect(entry.current).toMatchObject({ heading: "社会学", organization: "示例大学", role: "硕士" });
  });

  it("detects source updates without changing the project snapshot", async () => {
    const material = await repository.createMaterial({ internalName: "增长项目", category: "project" });
    const sourceVersion = await repository.updateVersion({
      ...material.versions[0]!,
      summary: "原始概述",
      bullets: ["原始要点"]
    }, material.versions[0]!.revision);
    const entry = await repository.createResumeEntrySnapshot(sourceVersion.id);
    const project = await repository.createResumeProject({ name: "增长简历", targetRole: "增长产品", language: "zh-CN", targetLength: "one" });
    project.modules = [{ id: crypto.randomUUID(), title: "项目经历", kind: "material", category: "project", hidden: false, entries: [entry], text: "", pageBreakBefore: false }];
    const saved = await repository.updateResumeProject(project, project.revision);

    await repository.updateVersion({ ...sourceVersion, summary: "素材库新概述" }, sourceVersion.revision);
    const bundle = await repository.getResumeProjectBundle(saved.id);
    expect(bundle?.sourceStates[0]?.status).toBe("updated");
    expect(bundle?.project.modules[0]?.entries[0]?.current.summary).toBe("原始概述");
  });

  it("preserves pending review when saving an old resume snapshot as a new material version", async () => {
    const material = await repository.createMaterial({ internalName: "留存分析", category: "project" });
    const changedItem = await repository.updateMaterial({ ...material.item, factNotes: "补充事实" }, material.item.revision);
    const entry = await repository.createResumeEntrySnapshot(material.item.originalVersionId);
    const saved = await repository.saveResumeEntryAsMaterialVersion(entry, "简历快照版本");
    expect(saved.sourceFactRevision).toBe(material.item.factRevision);
    expect(saved.sourceFactRevision).toBeLessThan(changedItem.factRevision);
    expect((await repository.listMaterialSummaries()).find(({ item }) => item.id === material.item.id)?.reviewPendingVersionCount).toBe(2);
  });

  it("keeps the snapshot when its source is deleted", async () => {
    const material = await repository.createMaterial({ internalName: "用户访谈", category: "work" });
    const entry = await repository.createResumeEntrySnapshot(material.item.originalVersionId);
    const project = await repository.createResumeProject({ name: "研究简历", targetRole: "用户研究", language: "zh-CN", targetLength: "one" });
    project.modules = [{ id: crypto.randomUUID(), title: "工作经历", kind: "material", category: "work", hidden: false, entries: [entry], text: "", pageBreakBefore: false }];
    const saved = await repository.updateResumeProject(project, project.revision);
    await repository.moveMaterialToTrash(material.item.id);
    const bundle = await repository.getResumeProjectBundle(saved.id);
    expect(bundle?.sourceStates[0]?.status).toBe("deleted");
    expect(bundle?.project.modules[0]?.entries).toHaveLength(1);
  });

  it("copies and trashes resume projects independently", async () => {
    const project = await repository.createResumeProject({ name: "原项目", targetRole: "分析师", language: "zh-CN", targetLength: "two" });
    const copied = await repository.copyResumeProject(project.id);
    expect(copied.id).not.toBe(project.id);
    expect(copied.name).toBe("原项目（副本）");
    const batch = await repository.moveResumeProjectToTrash(project.id);
    expect((await repository.getResumeProjectBundle(project.id))).toBeUndefined();
    await repository.restoreTrashBatch(batch.id);
    expect((await repository.getResumeProjectBundle(project.id))?.project.name).toBe("原项目");
  });

  it("permanently deletes a trashed resume project", async () => {
    const project = await repository.createResumeProject({ name: "待删除项目", targetRole: "分析师", language: "zh-CN", targetLength: "one" });
    const batch = await repository.moveResumeProjectToTrash(project.id);
    await repository.permanentlyDeleteTrashBatch(batch.id);
    expect(await db.resumeProjects.get(project.id)).toBeUndefined();
    expect(await repository.listTrash()).toHaveLength(0);
  });
});

describe("AI candidate repository", () => {
  it("replaces only the active candidate for the same task and target", async () => {
    const response = { requestId: "one", status: "ready" as const, result: { title: "", summary: "候选一", bullets: [], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [], provider: "mock", model: "mock" };
    await repository.saveAiCandidate("generate-version", "version-1", response);
    await repository.saveAiCandidate("generate-version", "version-1", { ...response, requestId: "two", result: { ...response.result, summary: "候选二" } });
    expect(await db.aiCandidates.count()).toBe(1);
    expect((await repository.getAiCandidate("generate-version", "version-1"))?.response.result.summary).toBe("候选二");
  });

  it("restores a candidate only when the submitted scope is unchanged", async () => {
    const response = { requestId: "scope", status: "ready" as const, result: { title: "", summary: "", bullets: [], content: "", recommendations: [], rewrites: [] }, missingFacts: [], warnings: [], provider: "mock", model: "mock" };
    await repository.saveAiCandidate("recommend-materials", "project-1", response, "fingerprint-one");
    expect(await repository.getAiCandidate("recommend-materials", "project-1", "fingerprint-one")).toBeTruthy();
    expect(await repository.getAiCandidate("recommend-materials", "project-1", "fingerprint-two")).toBeUndefined();
  });
});
