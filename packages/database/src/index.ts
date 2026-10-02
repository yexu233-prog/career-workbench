import Dexie, { type EntityTable } from "dexie";
import type {
  AssetRecord,
  GlobalProfile,
  InterviewNote,
  MaterialBundle,
  MaterialCategory,
  MaterialItem,
  MaterialExperience,
  MaterialSummary,
  MaterialVersion,
  OutputLanguage,
  ResumeEntryContent,
  ResumeEntrySnapshot,
  ResumeProject,
  ResumeProjectBundle,
  ResumeProfileSnapshot,
  ResumeProjectSummary,
  ResumeTargetLength,
  TrashBatch,
  TrashableTable
} from "@career-workbench/domain";
import { buildResumeDocumentModel, CATEGORY_FIELDS, DEFAULT_RESUME_STYLE, MATERIAL_CATEGORY_LABELS } from "@career-workbench/domain";
import { APP_VERSION, type AiTaskResponse, type AiTaskType } from "@career-workbench/shared";
import { buildImportedVersion, normalizeImportedFacts, ResumeImportValidationError, validateResumeImportTarget, type ResumeImportCommitResult, type ResumeImportDestination } from "./resume-import";
import { createFullBackup, inspectBackupFile, restoreFullBackup, type BackupEnvelopeV1, type BackupValidationResult, type RestoreResult, type ValidatedBackup } from "./backup";
import { prepareMigrationSnapshot } from './migration-protection';
export { CURRENT_DATABASE_SCHEMA_VERSION, SAFETY_DATABASE_NAME, getNativeDatabaseVersion, prepareMigrationSnapshot, readLatestMigrationSafetySnapshot, saveMigrationSafetySnapshot } from './migration-protection';
export type { BackupEnvelopeV1, BackupValidationResult, RestoreResult, ValidatedBackup } from "./backup";
export { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, BACKUP_MAX_BYTES } from "./backup";
export { compareResumeImport, resumeImportSharedKey, resumeImportDifferenceKey, validateResumeImportTarget, ResumeImportValidationError } from "./resume-import";
export type { ResumeImportDestination, ResumeImportCommitResult } from "./resume-import";

export interface MetaRecord {
  key: string;
  value: string | number | boolean;
  updatedAt: string;
}

export interface SettingsRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface OnboardingState {
  schemaVersion: 1;
  status: "new" | "started" | "completed";
  startedAt: string | null;
  completedAt: string | null;
}

export interface StoredRecord {
  id: string;
  updatedAt: string;
  deletedAt?: string;
  [key: string]: unknown;
}

export interface StoredAiCandidate {
  id: string;
  taskType: AiTaskType;
  targetId: string;
  response: AiTaskResponse;
  inputFingerprint?: string;
  createdAt: string;
  expiresAt: string;
  approximateBytes: number;
}

export interface ImportedMaterialDraft {
  internalName: string;
  category: MaterialCategory;
  facts: Record<string, string | boolean>;
  summary: string;
  bullets: string[];
  links: string[];
  creationMethod: "manual" | "ai";
}

export interface ResumeImportCandidateDraft extends ImportedMaterialDraft {
  id: string;
  selected: boolean;
  destination?: ResumeImportDestination;
}

export interface ResumeImportSessionInput {
  sourceName: string;
  sourceType: "txt" | "docx" | "pdf";
  parsedAt: string;
  text: string;
  warnings: string[];
  candidates: ResumeImportCandidateDraft[];
}

export interface ResumeImportSession extends ResumeImportSessionInput {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

const MATERIAL_CATEGORY_VALUES = new Set<MaterialCategory>(["work", "project", "education", "campus", "volunteer", "certificate", "custom"]);
const EXPERIENCE_CATEGORIES = new Set<MaterialCategory>(["work", "project", "campus"]);
const ONBOARDING_SETTINGS_KEY = "onboarding-state";
const BACKUP_STATUS_KEY = "backup-status";
const BACKUP_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;

export interface BackupStatus {
  schemaVersion: 1;
  lastSavedAt: string;
  method: "picker" | "confirmed-download";
}

export function isBackupReminderDue(status: BackupStatus | null, at = Date.now()): boolean {
  if (!status) return true;
  const savedAt = Date.parse(status.lastSavedAt);
  return !Number.isFinite(savedAt) || at - savedAt >= BACKUP_REMINDER_MS;
}

function newOnboardingState(): OnboardingState {
  return { schemaVersion: 1, status: "new", startedAt: null, completedAt: null };
}

function isOnboardingState(value: unknown): value is OnboardingState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<OnboardingState>;
  return state.schemaVersion === 1
    && (state.status === "new" || state.status === "started" || state.status === "completed")
    && (state.startedAt === null || typeof state.startedAt === "string")
    && (state.completedAt === null || typeof state.completedAt === "string")
    && (state.status !== "new" || (state.startedAt === null && state.completedAt === null))
    && (state.status !== "started" || (typeof state.startedAt === "string" && state.completedAt === null))
    && (state.status !== "completed" || (typeof state.startedAt === "string" && typeof state.completedAt === "string"));
}

function isResumeImportCandidateDraft(value: unknown): value is ResumeImportCandidateDraft {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ResumeImportCandidateDraft>;
  return typeof candidate.id === "string" && typeof candidate.selected === "boolean"
    && typeof candidate.internalName === "string" && MATERIAL_CATEGORY_VALUES.has(candidate.category as MaterialCategory)
    && Boolean(candidate.facts) && typeof candidate.facts === "object" && !Array.isArray(candidate.facts)
    && typeof candidate.summary === "string" && Array.isArray(candidate.bullets) && candidate.bullets.every((item) => typeof item === "string")
    && Array.isArray(candidate.links) && candidate.links.every((item) => typeof item === "string")
    && (candidate.creationMethod === "manual" || candidate.creationMethod === "ai")
    && isResumeImportDestination(candidate.destination);
}

function isResumeImportDestination(value: unknown): boolean {
  if (value === undefined) return true; // Existing temporary sessions default to new material.
  if (!value || typeof value !== "object") return false;
  const destination = value as Record<string, unknown>;
  return destination.mode === "new-material" || (destination.mode === "new-version"
    && typeof destination.materialItemId === "string" && typeof destination.versionName === "string"
    && (destination.expectedFactRevision === undefined || (typeof destination.expectedFactRevision === "number" && Number.isInteger(destination.expectedFactRevision) && destination.expectedFactRevision > 0))
    && (destination.expectedSharedKey === undefined || typeof destination.expectedSharedKey === "string")
    && (destination.confirmedDifferenceKey === undefined || typeof destination.confirmedDifferenceKey === "string"));
}

export class CareerWorkbenchDatabase extends Dexie {
  meta!: EntityTable<MetaRecord, "key">;
  settings!: EntityTable<SettingsRecord, "key">;
  profiles!: EntityTable<GlobalProfile, "id">;
  assets!: EntityTable<AssetRecord, "id">;
  materialItems!: EntityTable<MaterialItem, "id">;
  materialVersions!: EntityTable<MaterialVersion, "id">;
  interviewNotes!: EntityTable<InterviewNote, "id">;
  resumeProjects!: EntityTable<ResumeProject, "id">;
  trashBatches!: EntityTable<TrashBatch, "id">;
  aiCandidates!: EntityTable<StoredAiCandidate, "id">;
  undoSnapshots!: EntityTable<StoredRecord, "id">;

  constructor(name = "career-workbench") {
    super(name);
    let blockedNoticeShown = false;
    this.on("blocked", () => {
      if (blockedNoticeShown || typeof window === "undefined") return;
      blockedNoticeShown = true;
      window.alert("数据库升级被其他求职工作台窗口占用，请先关闭其他窗口后再重试；应用不会强制断开或覆盖其他窗口。");
    });

    this.version(1).stores({
      meta: "&key, updatedAt",
      settings: "&key, updatedAt",
      profiles: "&id, updatedAt, deletedAt",
      assets: "&id, updatedAt, deletedAt",
      materialItems: "&id, category, updatedAt, deletedAt, *tags",
      materialVersions: "&id, materialItemId, [materialItemId+name], updatedAt, deletedAt",
      interviewNotes: "&id, &materialVersionId, updatedAt, deletedAt",
      resumeProjects: "&id, updatedAt, deletedAt, archivedAt",
      trashBatches: "&id, deletedAt",
      aiCandidates: "&id, taskType, createdAt, expiresAt",
      undoSnapshots: "&id, objectId, createdAt, expiresAt"
    });
  }
}

export const database = new CareerWorkbenchDatabase();

export async function bootstrapDatabase(targetDatabase = database): Promise<void> {
  await prepareMigrationSnapshot(targetDatabase);
  const updatedAt = new Date().toISOString();
  await targetDatabase.transaction("rw", targetDatabase.meta, targetDatabase.profiles, async () => {
    await targetDatabase.meta.bulkPut([
      { key: "appVersion", value: APP_VERSION, updatedAt },
      { key: "databaseSchemaVersion", value: 1, updatedAt }
    ]);
    if (!(await targetDatabase.profiles.get("default"))) await targetDatabase.profiles.put(defaultProfile());
  });
}

export class RevisionConflictError extends Error {
  constructor() {
    super("数据已在其他窗口中发生变化");
    this.name = "RevisionConflictError";
  }
}

export class MaterialFactsChangedError extends Error {
  constructor() {
    super("共享事实或经历内容已再次更新，请重新检查当前版本后再确认。");
    this.name = "MaterialFactsChangedError";
  }
}

export class DuplicateVersionNameError extends Error {
  constructor() {
    super("同一素材中的版本名称不能重复");
    this.name = "DuplicateVersionNameError";
  }
}

export class OriginalVersionDeletionError extends Error {
  constructor() {
    super("原始版本不能单独删除");
    this.name = "OriginalVersionDeletionError";
  }
}

const now = () => new Date().toISOString();
const createId = () => crypto.randomUUID();

function defaultProfile(): GlobalProfile {
  const timestamp = now();
  return {
    id: "default",
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
    chineseName: "",
    englishName: "",
    phone: "",
    email: "",
    city: "",
    targetDirection: "",
    summary: "",
    skills: [],
    links: [],
    customFields: []
  };
}

export interface CreateMaterialInput {
  internalName: string;
  category: MaterialCategory;
}

export interface CreateVersionInput {
  name: string;
  language?: OutputLanguage;
  referenceVersionId?: string;
  inheritReviewState?: boolean;
}

export interface MaterialFilters {
  query?: string;
  category?: MaterialCategory | "all";
  language?: OutputLanguage | "all";
}

export interface CreateResumeProjectInput {
  name: string;
  targetRole: string;
  language: OutputLanguage;
  targetLength: ResumeTargetLength;
  jdText?: string;
}


export class CareerWorkbenchRepository {
  constructor(private readonly db: CareerWorkbenchDatabase = database) {}

  async createFullBackup(): Promise<BackupEnvelopeV1> {
    return createFullBackup(this.db);
  }

  async getBackupStatus(): Promise<BackupStatus | null> {
    const value = (await this.db.settings.get(BACKUP_STATUS_KEY))?.value as Partial<BackupStatus> | undefined;
    if (value?.schemaVersion !== 1 || typeof value.lastSavedAt !== "string" || !Number.isFinite(Date.parse(value.lastSavedAt))
      || (value.method !== "picker" && value.method !== "confirmed-download")) return null;
    return { schemaVersion: 1, lastSavedAt: value.lastSavedAt, method: value.method };
  }

  async recordBackupSaved(method: BackupStatus["method"]): Promise<BackupStatus> {
    if (method !== "picker" && method !== "confirmed-download") throw new Error("备份确认方式无效");
    const timestamp = now();
    const status: BackupStatus = { schemaVersion: 1, lastSavedAt: timestamp, method };
    await this.db.settings.put({ key: BACKUP_STATUS_KEY, value: status, updatedAt: timestamp });
    return status;
  }

  async inspectBackupFile(file: Blob): Promise<BackupValidationResult> {
    return inspectBackupFile(file);
  }

  async restoreFullBackup(validatedBackup: ValidatedBackup): Promise<RestoreResult> {
    return restoreFullBackup(this.db, validatedBackup);
  }

  async getOnboardingState(): Promise<OnboardingState> {
    const record = await this.db.settings.get(ONBOARDING_SETTINGS_KEY);
    if (!record) return newOnboardingState();
    if (!isOnboardingState(record.value)) {
      await this.db.settings.delete(ONBOARDING_SETTINGS_KEY);
      return newOnboardingState();
    }
    return structuredClone(record.value);
  }

  async startOnboarding(): Promise<OnboardingState> {
    const existing = await this.getOnboardingState();
    if (existing.status === "completed" || existing.status === "started") return existing;
    const timestamp = now();
    const state: OnboardingState = { schemaVersion: 1, status: "started", startedAt: timestamp, completedAt: null };
    await this.db.settings.put({ key: ONBOARDING_SETTINGS_KEY, value: state, updatedAt: timestamp });
    return structuredClone(state);
  }

  async completeOnboarding(): Promise<OnboardingState> {
    const existing = await this.getOnboardingState();
    if (existing.status === "completed") return existing;
    const timestamp = now();
    const state: OnboardingState = {
      schemaVersion: 1,
      status: "completed",
      startedAt: existing.startedAt ?? timestamp,
      completedAt: timestamp
    };
    await this.db.settings.put({ key: ONBOARDING_SETTINGS_KEY, value: state, updatedAt: timestamp });
    return structuredClone(state);
  }

  async saveResumeImportSession(input: ResumeImportSessionInput): Promise<ResumeImportSession> {
    const timestamp = now();
    const existing = await this.getResumeImportSession();
    const session: ResumeImportSession = {
      ...structuredClone(input),
      schemaVersion: 1,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    if (!session.sourceName.trim() || !session.text.trim()) throw new Error("导入会话缺少简历文字");
    if (session.text.length > 200_000) throw new Error("导入会话文字超过 20 万字符");
    if (session.candidates.length > 100) throw new Error("导入会话候选素材超过 100 条");
    const approximateBytes = new TextEncoder().encode(JSON.stringify(session)).byteLength;
    if (approximateBytes > 5 * 1024 * 1024) throw new Error("导入会话内容过大，无法自动保存");
    await this.db.settings.put({ key: "resume-import-session", value: session, updatedAt: timestamp });
    return session;
  }

  async getResumeImportSession(): Promise<ResumeImportSession | undefined> {
    const record = await this.db.settings.get("resume-import-session");
    if (!record) return undefined;
    const value = record.value as Partial<ResumeImportSession> | undefined;
    if (!value || value.schemaVersion !== 1 || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
      || typeof value.expiresAt !== "string" || typeof value.sourceName !== "string" || !value.sourceName.trim()
      || (value.sourceType !== "txt" && value.sourceType !== "docx" && value.sourceType !== "pdf")
      || typeof value.parsedAt !== "string" || typeof value.text !== "string" || !value.text.trim() || value.text.length > 200_000
      || !Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === "string")
      || !Array.isArray(value.candidates) || value.candidates.length > 100 || !value.candidates.every(isResumeImportCandidateDraft)) {
      await this.db.settings.delete("resume-import-session");
      return undefined;
    }
    if (value.expiresAt < now()) {
      await this.db.settings.delete("resume-import-session");
      return undefined;
    }
    const session = structuredClone(value as ResumeImportSession);
    session.candidates = session.candidates.map((candidate) => ({ ...candidate, destination: candidate.destination ?? { mode: "new-material" } }));
    return session;
  }

  async deleteResumeImportSession(): Promise<void> {
    await this.db.settings.delete("resume-import-session");
  }

  async saveAiCandidate(taskType: AiTaskType, targetId: string, response: AiTaskResponse, inputFingerprint?: string): Promise<StoredAiCandidate> {
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const candidate: StoredAiCandidate = { id: createId(), taskType, targetId, response, ...(inputFingerprint ? { inputFingerprint } : {}), createdAt, expiresAt, approximateBytes: new TextEncoder().encode(JSON.stringify(response)).byteLength };
    await this.db.transaction("rw", this.db.aiCandidates, async () => {
      const records = await this.db.aiCandidates.toArray();
      await this.db.aiCandidates.bulkDelete(records.filter((record) => record.expiresAt < createdAt || (record.taskType === taskType && record.targetId === targetId)).map((record) => record.id));
      await this.db.aiCandidates.put(candidate);
      const current = (await this.db.aiCandidates.toArray()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      let total = current.reduce((sum, record) => sum + record.approximateBytes, 0);
      const remove: string[] = [];
      for (const record of current) { if (total <= 10 * 1024 * 1024) break; remove.push(record.id); total -= record.approximateBytes; }
      if (remove.length) await this.db.aiCandidates.bulkDelete(remove);
    });
    return candidate;
  }

  async getAiCandidate(taskType: AiTaskType, targetId: string, inputFingerprint?: string): Promise<StoredAiCandidate | undefined> {
    const records = await this.db.aiCandidates.where("taskType").equals(taskType).toArray();
    const candidate = records.filter((record) => record.targetId === targetId && record.expiresAt >= now() && (!inputFingerprint || record.inputFingerprint === inputFingerprint)).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    return candidate;
  }

  async deleteAiCandidate(id: string): Promise<void> { await this.db.aiCandidates.delete(id); }

  async saveUndoSnapshot(objectId: string, objectType: string, data: unknown): Promise<void> {
    const createdAt = now();
    await this.db.undoSnapshots.put({ id: createId(), objectId, objectType, data, createdAt, updatedAt: createdAt, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
  }

  async getInterviewNoteContents(versionIds: string[]): Promise<Record<string, string>> {
    if (!versionIds.length) return {};
    const notes = await this.db.interviewNotes.where("materialVersionId").anyOf(versionIds).toArray();
    return Object.fromEntries(notes.filter((note) => !note.deletedAt && note.content.trim()).map((note) => [note.materialVersionId, note.content]));
  }

  async getProfile(): Promise<GlobalProfile> {
    return (await this.db.profiles.get("default")) ?? defaultProfile();
  }

  async updateProfile(draft: GlobalProfile, expectedRevision: number): Promise<GlobalProfile> {
    return this.db.transaction("rw", this.db.profiles, async () => {
      const existing = await this.db.profiles.get(draft.id);
      if (!existing || existing.revision !== expectedRevision) throw new RevisionConflictError();
      const saved: GlobalProfile = {
        ...draft,
        createdAt: existing.createdAt,
        updatedAt: now(),
        revision: existing.revision + 1
      };
      await this.db.profiles.put(saved);
      return saved;
    });
  }

  async setProfilePhoto(file: File): Promise<AssetRecord> {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (!allowedTypes.has(file.type)) throw new Error("照片仅支持 JPG、PNG 或 WebP");
    if (file.size > 5 * 1024 * 1024) throw new Error("照片不能超过5MB");

    return this.db.transaction("rw", this.db.assets, async () => {
      const timestamp = now();
      const asset: AssetRecord = {
        id: "profile-photo",
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        kind: "profile-photo",
        name: file.name,
        mimeType: file.type as AssetRecord["mimeType"],
        size: file.size,
        data: file
      };
      await this.db.assets.put(asset);
      return asset;
    });
  }

  async removeProfilePhoto(): Promise<void> {
    await this.db.assets.delete("profile-photo");
  }

  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return this.db.assets.get(id);
  }

  async createMaterial(input: CreateMaterialInput): Promise<MaterialBundle> {
    const internalName = input.internalName.trim();
    if (!internalName) throw new Error("素材名称不能为空");
    const timestamp = now();
    const materialId = createId();
    const originalVersionId = createId();
    const item: MaterialItem = {
      id: materialId,
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      internalName,
      category: input.category,
      tags: [],
      skills: [],
      links: [],
      factNotes: "",
      facts: {},
      factRevision: 1,
      originalVersionId
    };
    const originalVersion: MaterialVersion = {
      id: originalVersionId,
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      materialItemId: materialId,
      name: "原始版本",
      isOriginal: true,
      language: "zh-CN",
      summary: "",
      bullets: [],
      targetRole: "",
      jdText: "",
      emphasis: "",
      tags: [],
      notes: "",
      creationMethod: "manual",
      sourceFactRevision: item.factRevision
    };
    await this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, async () => {
      await this.db.materialItems.add(item);
      await this.db.materialVersions.add(originalVersion);
    });
    return { item, versions: [originalVersion], notes: [] };
  }

  async importMaterials(drafts: ImportedMaterialDraft[]): Promise<MaterialBundle[]> {
    const result = await this.commitResumeImport(drafts.map((draft) => ({ ...draft, id: createId(), selected: true, destination: { mode: "new-material" } })));
    return result.created.map(({ item, version }) => ({ item, versions: [version], notes: [] }));
  }

  async commitResumeImport(candidates: ResumeImportCandidateDraft[]): Promise<ResumeImportCommitResult> {
    // Snapshot caller-owned drafts before the first await; editing cannot alter a pending batch.
    const selected = structuredClone(candidates.filter((candidate) => candidate.selected));
    if (!selected.length) throw new Error("请至少选择一条候选素材");
    if (selected.length > 100) throw new Error("单次最多导入 100 条候选");
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, this.db.settings, async () => {
      const result: ResumeImportCommitResult = { newMaterialCount: 0, newVersionCount: 0, created: [] };
      const candidateIds = new Set<string>();
      for (const candidate of selected) {
        const fail = (message: string): never => { throw new ResumeImportValidationError(candidate.id, `“${candidate.internalName || "未命名候选"}”：${message}；本批次未写入任何内容。`); };
        if (!isResumeImportCandidateDraft(candidate)) fail("候选格式无效");
        if (candidateIds.has(candidate.id)) fail("同一候选不能重复提交");
        candidateIds.add(candidate.id);
        const timestamp = now();
        const destination = candidate.destination ?? { mode: "new-material" };
        let item: MaterialItem;
        let version: MaterialVersion;
        if (destination.mode === "new-version") {
          const target = await this.db.materialItems.get(destination.materialItemId);
          const error = validateResumeImportTarget(candidate, target);
          if (error) fail(error);
          if (!target) fail("目标素材不存在");
          item = target!;
          const name = destination.versionName.trim();
          try { await this.assertUniqueVersionName(item.id, name); }
          catch (reason) { if (reason instanceof DuplicateVersionNameError) fail("同一素材中的版本名称不能重复，请修改新版本名称"); throw reason; }
          version = buildImportedVersion(candidate, item, name, false, timestamp);
          result.newVersionCount += 1;
        } else {
          if (!candidate.internalName.trim()) fail("候选素材名称不能为空");
          item = {
            id: createId(), schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1,
            internalName: candidate.internalName.trim(), category: candidate.category, tags: [], skills: [],
            links: candidate.links.map((link) => link.trim()).filter(Boolean), factNotes: "",
            facts: normalizeImportedFacts(candidate), factRevision: 1, originalVersionId: createId()
          };
          version = buildImportedVersion(candidate, item, "原始版本", true, timestamp);
          await this.db.materialItems.add(item);
          result.newMaterialCount += 1;
        }
        await this.db.materialVersions.add(version);
        result.created.push({ candidateId: candidate.id, item, version });
      }
      await this.db.settings.delete("resume-import-session");
      return result;
    });
  }

  async getMaterialBundle(id: string, includeDeleted = false): Promise<MaterialBundle | undefined> {
    const item = await this.db.materialItems.get(id);
    if (!item || (!includeDeleted && item.deletedAt)) return undefined;
    const allVersions = await this.db.materialVersions.where("materialItemId").equals(id).toArray();
    const versions = allVersions
      .filter((version) => includeDeleted || !version.deletedAt)
      .sort((left, right) => Number(right.isOriginal) - Number(left.isOriginal) || left.createdAt.localeCompare(right.createdAt));
    const versionIds = new Set(versions.map((version) => version.id));
    const notes = (await this.db.interviewNotes.toArray()).filter(
      (note) => versionIds.has(note.materialVersionId) && (includeDeleted || !note.deletedAt)
    );
    return { item, versions, notes };
  }

  async listMaterialSummaries(filters: MaterialFilters = {}): Promise<MaterialSummary[]> {
    const items = (await this.db.materialItems.toArray()).filter((item) => !item.deletedAt);
    const versions = (await this.db.materialVersions.toArray()).filter((version) => !version.deletedAt);
    const normalizedQuery = filters.query?.trim().toLocaleLowerCase() ?? "";
    const summaries = items.map((item): MaterialSummary => {
      const itemVersions = versions.filter((version) => version.materialItemId === item.id);
      const reviewPendingVersionCount = itemVersions.filter((version) => version.sourceFactRevision < item.factRevision).length;
      return {
        item,
        organization: this.findOrganization(item),
        versionCount: itemVersions.length,
        languages: [...new Set(itemVersions.map((version) => version.language))],
        reviewPendingVersionCount,
        needsReview: reviewPendingVersionCount > 0,
        versionLinks: itemVersions.map(({ id, name }) => ({ id, name })),
        experienceLinks: (item.experiences ?? []).filter((experience) => !experience.deletedAt).map(({ id, name }) => ({ id, name }))
      };
    });
    return summaries
      .filter((summary) => !filters.category || filters.category === "all" || summary.item.category === filters.category)
      .filter((summary) => !filters.language || filters.language === "all" || summary.languages.includes(filters.language))
      .filter((summary) => !normalizedQuery || [summary.item.internalName, summary.organization, ...summary.item.tags, ...summary.item.skills]
        .join(" ").toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => right.item.updatedAt.localeCompare(left.item.updatedAt));
  }

  async updateMaterial(draft: MaterialItem, expectedRevision: number): Promise<MaterialItem> {
    return this.db.transaction("rw", this.db.materialItems, async () => {
      const existing = await this.db.materialItems.get(draft.id);
      if (!existing || existing.revision !== expectedRevision) throw new RevisionConflictError();
      if (!draft.internalName.trim()) throw new Error("素材名称不能为空");
      const factsChanged = JSON.stringify(existing.facts) !== JSON.stringify(draft.facts) || existing.factNotes !== draft.factNotes;
      const saved: MaterialItem = {
        ...draft,
        internalName: draft.internalName.trim(),
        createdAt: existing.createdAt,
        updatedAt: now(),
        revision: existing.revision + 1,
        factRevision: factsChanged ? existing.factRevision + 1 : existing.factRevision
      };
      await this.db.materialItems.put(saved);
      return saved;
    });
  }

  async createExperience(materialItemId: string, name: string): Promise<MaterialExperience> {
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("经历名称不能为空");
    return this.db.transaction("rw", this.db.materialItems, async () => {
      const item = await this.db.materialItems.get(materialItemId);
      if (!item || item.deletedAt) throw new Error("素材不存在或已删除");
      if (!EXPERIENCE_CATEGORIES.has(item.category)) throw new Error("当前素材类别不支持新增经历内容");
      const experiences = item.experiences ?? [];
      if (experiences.some((experience) => !experience.deletedAt && experience.name === normalizedName)) throw new Error("同一素材下的经历名称不能重复");
      const timestamp = now();
      const experience: MaterialExperience = { id: createId(), schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1, name: normalizedName, content: "" };
      await this.db.materialItems.put({ ...item, experiences: [...experiences, experience], updatedAt: timestamp, revision: item.revision + 1 });
      return experience;
    });
  }

  async updateExperience(materialItemId: string, draft: MaterialExperience, expectedRevision: number): Promise<MaterialExperience> {
    const normalizedName = draft.name.trim();
    if (!normalizedName) throw new Error("经历名称不能为空");
    return this.db.transaction("rw", this.db.materialItems, async () => {
      const item = await this.db.materialItems.get(materialItemId);
      if (!item || item.deletedAt) throw new Error("素材不存在或已删除");
      const experiences = [...(item.experiences ?? [])];
      const index = experiences.findIndex((experience) => experience.id === draft.id && !experience.deletedAt);
      if (index < 0 || experiences[index]?.revision !== expectedRevision) throw new RevisionConflictError();
      if (experiences.some((experience) => !experience.deletedAt && experience.id !== draft.id && experience.name === normalizedName)) throw new Error("同一素材下的经历名称不能重复");
      const existing = experiences[index]!;
      const timestamp = now();
      const saved: MaterialExperience = { ...draft, name: normalizedName, createdAt: existing.createdAt, updatedAt: timestamp, revision: existing.revision + 1 };
      experiences[index] = saved;
      await this.db.materialItems.put({ ...item, experiences, updatedAt: timestamp, revision: item.revision + 1, factRevision: existing.content !== saved.content ? item.factRevision + 1 : item.factRevision });
      return saved;
    });
  }

  async createAiVersionFromExperiences(materialItemId: string, input: {
    name: string; language: OutputLanguage; targetRole: string; jdText: string; emphasis: string; summary: string; bullets: string[]; aiModel: string;
    experienceRevisions: Array<{ id: string; revision: number }>;
  }): Promise<MaterialVersion> {
    const name = input.name.trim();
    if (!name) throw new Error("版本名称不能为空");
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, async () => {
      const item = await this.db.materialItems.get(materialItemId);
      if (!item || item.deletedAt) throw new Error("素材不存在或已删除");
      if (!EXPERIENCE_CATEGORIES.has(item.category)) throw new Error("当前素材类别不支持此生成方式");
      const current = new Map((item.experiences ?? []).filter((experience) => !experience.deletedAt).map((experience) => [experience.id, experience]));
      if (!input.experienceRevisions.length || input.experienceRevisions.some(({ id, revision }) => current.get(id)?.revision !== revision || !current.get(id)?.content.trim())) throw new Error("经历内容已变化或已删除，请重新选择并生成候选");
      await this.assertUniqueVersionName(materialItemId, name);
      const timestamp = now();
      const version: MaterialVersion = { id: createId(), schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1, materialItemId, name, isOriginal: false, language: input.language, summary: input.summary, bullets: [...input.bullets], targetRole: input.targetRole, jdText: input.jdText, emphasis: input.emphasis, tags: [], notes: "", creationMethod: "ai", sourceFactRevision: item.factRevision, aiGeneratedAt: timestamp, aiModel: input.aiModel };
      await this.db.materialVersions.add(version);
      return version;
    });
  }

  async moveExperienceToTrash(materialItemId: string, experienceId: string): Promise<TrashBatch> {
    return this.db.transaction("rw", this.db.materialItems, this.db.trashBatches, async () => {
      const item = await this.db.materialItems.get(materialItemId);
      const experience = item?.experiences?.find((candidate) => candidate.id === experienceId && !candidate.deletedAt);
      if (!item || item.deletedAt || !experience) throw new Error("经历内容不存在或已删除");
      const deletedAt = now();
      const batchId = createId();
      const experiences = item.experiences!.map((candidate) => candidate.id === experienceId ? { ...candidate, deletedAt, trashBatchId: batchId } : candidate);
      const batch: TrashBatch = { id: batchId, rootType: "experience", rootId: experienceId, displayName: experience.name, deletedAt, entries: [{ table: "materialExperiences", id: experienceId, materialItemId }] };
      await this.db.materialItems.put({ ...item, experiences, updatedAt: deletedAt, revision: item.revision + 1, factRevision: item.factRevision + 1 });
      await this.db.trashBatches.add(batch);
      return batch;
    });
  }

  async createVersion(materialItemId: string, input: CreateVersionInput): Promise<MaterialVersion> {
    const versionName = input.name.trim();
    if (!versionName) throw new Error("版本名称不能为空");
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, async () => {
      const item = await this.db.materialItems.get(materialItemId);
      if (!item || item.deletedAt) throw new Error("素材不存在或已删除");
      await this.assertUniqueVersionName(materialItemId, versionName);
      const reference = input.referenceVersionId ? await this.db.materialVersions.get(input.referenceVersionId) : undefined;
      if (reference && (reference.materialItemId !== materialItemId || reference.deletedAt)) throw new Error("参考版本无效");
      const timestamp = now();
      const version: MaterialVersion = {
        id: createId(),
        schemaVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        materialItemId,
        name: versionName,
        isOriginal: false,
        language: input.language ?? reference?.language ?? "zh-CN",
        summary: reference?.summary ?? "",
        bullets: [...(reference?.bullets ?? [])],
        targetRole: reference?.targetRole ?? "",
        jdText: reference?.jdText ?? "",
        emphasis: reference?.emphasis ?? "",
        tags: [...(reference?.tags ?? [])],
        notes: reference?.notes ?? "",
        creationMethod: "manual",
        ...(reference ? { referenceVersionId: reference.id } : {}),
        sourceFactRevision: input.inheritReviewState && reference ? reference.sourceFactRevision : item.factRevision
      };
      await this.db.materialVersions.add(version);
      return version;
    });
  }

  async updateVersion(draft: MaterialVersion, expectedRevision: number): Promise<MaterialVersion> {
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, async () => {
      const existing = await this.db.materialVersions.get(draft.id);
      if (!existing || existing.revision !== expectedRevision) throw new RevisionConflictError();
      if (!draft.name.trim()) throw new Error("版本名称不能为空");
      await this.assertUniqueVersionName(draft.materialItemId, draft.name.trim(), draft.id);
      const material = await this.db.materialItems.get(existing.materialItemId);
      if (!material || material.deletedAt) throw new Error("素材不存在或已删除");
      const saved: MaterialVersion = {
        ...draft,
        name: draft.name.trim(),
        isOriginal: existing.isOriginal,
        materialItemId: existing.materialItemId,
        createdAt: existing.createdAt,
        updatedAt: now(),
        revision: existing.revision + 1,
        sourceFactRevision: existing.sourceFactRevision
      };
      await this.db.materialVersions.put(saved);
      return saved;
    });
  }

  async markVersionFactsReviewed(versionId: string, expectedVersionRevision: number, expectedFactRevision: number): Promise<MaterialVersion> {
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, async () => {
      const existing = await this.db.materialVersions.get(versionId);
      if (!existing || existing.deletedAt || existing.revision !== expectedVersionRevision) throw new RevisionConflictError();
      const material = await this.db.materialItems.get(existing.materialItemId);
      if (!material || material.deletedAt) throw new Error("素材不存在或已删除");
      if (material.factRevision !== expectedFactRevision) throw new MaterialFactsChangedError();
      if (existing.sourceFactRevision >= material.factRevision) return existing;
      const saved: MaterialVersion = {
        ...existing,
        sourceFactRevision: material.factRevision,
        updatedAt: now(),
        revision: existing.revision + 1
      };
      await this.db.materialVersions.put(saved);
      return saved;
    });
  }

  async upsertInterviewNote(versionId: string, content: string, expectedRevision?: number, aiMetadata?: Pick<InterviewNote, "aiGeneratedAt" | "aiModel">): Promise<InterviewNote> {
    return this.db.transaction("rw", this.db.materialVersions, this.db.interviewNotes, async () => {
      const version = await this.db.materialVersions.get(versionId);
      if (!version || version.deletedAt) throw new Error("素材版本不存在或已删除");
      const existing = await this.db.interviewNotes.where("materialVersionId").equals(versionId).first();
      if (existing?.deletedAt) throw new Error("面试备注位于回收站，请先恢复或永久删除");
      if (existing && expectedRevision !== undefined && existing.revision !== expectedRevision) throw new RevisionConflictError();
      const timestamp = now();
      const saved: InterviewNote = existing
        ? { ...existing, content, basedOnVersionRevision: version.revision, updatedAt: timestamp, revision: existing.revision + 1, ...aiMetadata }
        : {
            id: createId(), schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1,
            materialVersionId: versionId, content, basedOnVersionRevision: version.revision, ...aiMetadata
          };
      await this.db.interviewNotes.put(saved);
      return saved;
    });
  }

  async copyMaterial(materialId: string): Promise<MaterialBundle> {
    const source = await this.getMaterialBundle(materialId);
    if (!source) throw new Error("素材不存在或已删除");
    return this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, this.db.interviewNotes, async () => {
      const timestamp = now();
      const newMaterialId = createId();
      const versionIdMap = new Map(source.versions.map((version) => [version.id, createId()]));
      const originalVersionId = versionIdMap.get(source.item.originalVersionId);
      if (!originalVersionId) throw new Error("原始版本关系损坏");
      const item: MaterialItem = {
        ...source.item,
        id: newMaterialId,
        internalName: `${source.item.internalName}（副本）`,
        experiences: (source.item.experiences ?? []).filter((experience) => !experience.deletedAt).map((experience) => ({
          ...experience, id: createId(), createdAt: timestamp, updatedAt: timestamp, revision: 1
        })),
        originalVersionId,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        factRevision: source.item.factRevision
      };
      delete item.deletedAt;
      delete item.trashBatchId;
      const versions = source.versions.map((version): MaterialVersion => {
        const copied: MaterialVersion = {
          ...version,
          id: versionIdMap.get(version.id)!,
          materialItemId: newMaterialId,
          createdAt: timestamp,
          updatedAt: timestamp,
          revision: 1,
          sourceFactRevision: version.sourceFactRevision,
          ...(version.referenceVersionId && versionIdMap.has(version.referenceVersionId)
            ? { referenceVersionId: versionIdMap.get(version.referenceVersionId)! }
            : {})
        };
        delete copied.deletedAt;
        delete copied.trashBatchId;
        return copied;
      });
      const notes = source.notes.map((note): InterviewNote => ({
        ...note,
        id: createId(),
        materialVersionId: versionIdMap.get(note.materialVersionId)!,
        createdAt: timestamp,
        updatedAt: timestamp,
        revision: 1,
        basedOnVersionRevision: 1
      }));
      await this.db.materialItems.add(item);
      await this.db.materialVersions.bulkAdd(versions);
      if (notes.length) await this.db.interviewNotes.bulkAdd(notes);
      return { item, versions, notes };
    });
  }

  async createResumeProject(input: CreateResumeProjectInput): Promise<ResumeProject> {
    const name = input.name.trim();
    if (!name) throw new Error("简历项目名称不能为空");
    const profile = await this.getProfile();
    const photo = await this.getAsset("profile-photo");
    const timestamp = now();
    const jdText = input.jdText?.trim() ?? "";
    const project: ResumeProject = {
      id: createId(),
      schemaVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      name,
      targetRole: input.targetRole.trim(),
      language: input.language,
      targetLength: input.targetLength,
      jdText,
      jdOriginalText: jdText,
      jdSourceName: jdText ? "手动粘贴" : "",
      jdSourceType: jdText ? "pasted" : "empty",
      ...(jdText ? { jdParsedAt: timestamp } : {}),
      jdWarnings: [],
      profile: {
        chineseName: profile.chineseName,
        englishName: profile.englishName,
        phone: profile.phone,
        email: profile.email,
        city: profile.city,
        targetDirection: profile.targetDirection,
        summary: profile.summary,
        skills: [...profile.skills],
        links: profile.links.map((link) => ({ ...link })),
        customFields: profile.customFields.map((field) => ({ ...field })),
        hiddenFields: [],
        ...(photo ? { photo: { name: photo.name, mimeType: photo.mimeType, data: photo.data } } : {})
      },
      sourceProfileRevision: profile.revision,
      ...(photo ? { sourcePhotoRevision: photo.revision } : {}),
      modules: [],
      style: { ...DEFAULT_RESUME_STYLE }
    };
    await this.db.resumeProjects.add(project);
    return project;
  }

  async getResumeProjectBundle(id: string, includeDeleted = false): Promise<ResumeProjectBundle | undefined> {
    const project = await this.db.resumeProjects.get(id);
    if (!project || (!includeDeleted && project.deletedAt)) return undefined;
    const sourceStates = await Promise.all(project.modules.flatMap((module) => module.entries).map(async (entry) => {
      const item = await this.db.materialItems.get(entry.sourceMaterialItemId);
      const version = await this.db.materialVersions.get(entry.sourceVersionId);
      if (!item || !version || item.deletedAt || version.deletedAt) {
        return { entryId: entry.id, status: "deleted" as const };
      }
      const latestContent = this.toResumeEntryContent(item, version);
      const changed = JSON.stringify(latestContent) !== JSON.stringify(entry.lastSynced);
      return {
        entryId: entry.id,
        status: changed ? "updated" as const : "current" as const,
        latestRevision: version.revision,
        latestContent
      };
    }));
    const globalProfile = await this.getProfile();
    const globalPhoto = await this.getAsset("profile-photo");
    const latestProfile: ResumeProfileSnapshot = {
      chineseName: globalProfile.chineseName, englishName: globalProfile.englishName, phone: globalProfile.phone, email: globalProfile.email,
      city: globalProfile.city, targetDirection: globalProfile.targetDirection, summary: globalProfile.summary, skills: [...globalProfile.skills],
      links: globalProfile.links.map((link) => ({ ...link })), customFields: globalProfile.customFields.map((field) => ({ ...field })), hiddenFields: [...project.profile.hiddenFields],
      ...(globalPhoto ? { photo: { name: globalPhoto.name, mimeType: globalPhoto.mimeType, data: globalPhoto.data } } : {})
    };
    const legacyComparable = (profile: ResumeProfileSnapshot) => JSON.stringify({ ...profile, hiddenFields: [], photo: profile.photo ? { name: profile.photo.name, mimeType: profile.photo.mimeType } : undefined });
    const profileChanged = project.sourceProfileRevision === undefined
      ? legacyComparable(project.profile) !== legacyComparable(latestProfile)
      : project.sourceProfileRevision !== globalProfile.revision || (project.sourcePhotoRevision ?? 0) !== (globalPhoto?.revision ?? 0);
    return { project, sourceStates, profileSource: { status: profileChanged ? "updated" : "current", latest: latestProfile, profileRevision: globalProfile.revision, ...(globalPhoto ? { photoRevision: globalPhoto.revision } : {}) } };
  }

  async listResumeProjectSummaries(query = "", archived = false): Promise<ResumeProjectSummary[]> {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const projects = (await this.db.resumeProjects.toArray())
      .filter((project) => !project.deletedAt && Boolean(project.archivedAt) === archived)
      .filter((project) => !normalizedQuery || `${project.name} ${project.targetRole}`.toLocaleLowerCase().includes(normalizedQuery));
    const summaries = await Promise.all(projects.map(async (project): Promise<ResumeProjectSummary> => {
      const bundle = await this.getResumeProjectBundle(project.id);
      const sourceStates = bundle?.sourceStates ?? [];
      return {
        project,
        entryCount: project.modules.reduce((total, module) => total + module.entries.length, 0),
        actualPageCount: buildResumeDocumentModel(project).pages.length,
        updatedSourceCount: sourceStates.filter((state) => state.status === "updated").length,
        deletedSourceCount: sourceStates.filter((state) => state.status === "deleted").length
      };
    }));
    return summaries.sort((left, right) => right.project.updatedAt.localeCompare(left.project.updatedAt));
  }

  async updateResumeProject(draft: ResumeProject, expectedRevision: number): Promise<ResumeProject> {
    return this.db.transaction("rw", this.db.resumeProjects, async () => {
      const existing = await this.db.resumeProjects.get(draft.id);
      if (!existing || existing.deletedAt || existing.revision !== expectedRevision) throw new RevisionConflictError();
      if (!draft.name.trim()) throw new Error("简历项目名称不能为空");
      const saved: ResumeProject = {
        ...draft,
        name: draft.name.trim(),
        createdAt: existing.createdAt,
        updatedAt: now(),
        revision: existing.revision + 1
      };
      await this.db.resumeProjects.put(saved);
      return saved;
    });
  }

  async copyResumeProject(id: string): Promise<ResumeProject> {
    const source = await this.db.resumeProjects.get(id);
    if (!source || source.deletedAt) throw new Error("简历项目不存在或已删除");
    const timestamp = now();
    const copied: ResumeProject = structuredClone(source);
    copied.id = createId();
    copied.name = `${source.name}（副本）`;
    copied.createdAt = timestamp;
    copied.updatedAt = timestamp;
    copied.revision = 1;
    copied.modules = copied.modules.map((module) => ({
      ...module,
      id: createId(),
      entries: module.entries.map((entry) => ({ ...entry, id: createId() }))
    }));
    delete copied.deletedAt;
    delete copied.trashBatchId;
    delete copied.archivedAt;
    delete copied.lastExportedAt;
    await this.db.resumeProjects.add(copied);
    return copied;
  }

  async setResumeProjectArchived(id: string, archived: boolean): Promise<void> {
    const project = await this.db.resumeProjects.get(id);
    if (!project || project.deletedAt) throw new Error("简历项目不存在或已删除");
    const saved: ResumeProject = { ...project, updatedAt: now(), revision: project.revision + 1 };
    if (archived) saved.archivedAt = now();
    else delete saved.archivedAt;
    await this.db.resumeProjects.put(saved);
  }

  async listAvailableMaterialBundles(): Promise<MaterialBundle[]> {
    const items = (await this.db.materialItems.toArray()).filter((item) => !item.deletedAt);
    const bundles = await Promise.all(items.map((item) => this.getMaterialBundle(item.id)));
    return bundles.filter((bundle): bundle is MaterialBundle => Boolean(bundle));
  }

  async createResumeEntrySnapshot(versionId: string): Promise<ResumeEntrySnapshot> {
    const version = await this.db.materialVersions.get(versionId);
    if (!version || version.deletedAt) throw new Error("素材版本不存在或已删除");
    const item = await this.db.materialItems.get(version.materialItemId);
    if (!item || item.deletedAt) throw new Error("素材不存在或已删除");
    const content = this.toResumeEntryContent(item, version);
    return {
      id: createId(),
      sourceMaterialItemId: item.id,
      sourceVersionId: version.id,
      sourceMaterialName: item.internalName,
      sourceVersionName: version.name,
      sourceCategory: item.category,
      sourceVersionRevision: version.revision,
      lastSynced: structuredClone(content),
      current: structuredClone(content)
    };
  }

  async saveResumeEntryAsMaterialVersion(entry: ResumeEntrySnapshot, name: string): Promise<MaterialVersion> {
    const version = await this.createVersion(entry.sourceMaterialItemId, { name, referenceVersionId: entry.sourceVersionId, inheritReviewState: true });
    return this.updateVersion({
      ...version,
      summary: entry.current.summary,
      bullets: [...entry.current.bullets],
      notes: `由简历项目条目“${entry.current.heading}”另存`
    }, version.revision);
  }

  async moveResumeProjectToTrash(id: string): Promise<TrashBatch> {
    const project = await this.db.resumeProjects.get(id);
    if (!project || project.deletedAt) throw new Error("简历项目不存在或已删除");
    return this.createTrashBatch("resumeProject", id, project.name, [{ table: "resumeProjects", id }]);
  }

  async moveMaterialToTrash(materialId: string): Promise<TrashBatch> {
    const bundle = await this.getMaterialBundle(materialId);
    if (!bundle) throw new Error("素材不存在或已删除");
    return this.createTrashBatch("material", materialId, bundle.item.internalName, [
      { table: "materialItems", id: bundle.item.id },
      ...bundle.versions.map((version) => ({ table: "materialVersions" as const, id: version.id })),
      ...bundle.notes.map((note) => ({ table: "interviewNotes" as const, id: note.id }))
    ]);
  }

  async moveVersionToTrash(versionId: string): Promise<TrashBatch> {
    const version = await this.db.materialVersions.get(versionId);
    if (!version || version.deletedAt) throw new Error("版本不存在或已删除");
    if (version.isOriginal) throw new OriginalVersionDeletionError();
    const notes = (await this.db.interviewNotes.where("materialVersionId").equals(versionId).toArray()).filter((note) => !note.deletedAt);
    return this.createTrashBatch("version", versionId, version.name, [
      { table: "materialVersions", id: version.id },
      ...notes.map((note) => ({ table: "interviewNotes" as const, id: note.id }))
    ]);
  }

  async moveInterviewNoteToTrash(noteId: string): Promise<TrashBatch> {
    const note = await this.db.interviewNotes.get(noteId);
    if (!note || note.deletedAt) throw new Error("面试备注不存在或已删除");
    return this.createTrashBatch("interviewNote", noteId, "面试备注", [{ table: "interviewNotes", id: noteId }]);
  }

  async listTrash(): Promise<TrashBatch[]> {
    return (await this.db.trashBatches.toArray()).sort((left, right) => right.deletedAt.localeCompare(left.deletedAt));
  }

  async restoreTrashBatch(batchId: string): Promise<void> {
    await this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, this.db.interviewNotes, this.db.resumeProjects, this.db.trashBatches, async () => {
      const batch = await this.db.trashBatches.get(batchId);
      if (!batch) throw new Error("回收站记录不存在");
      for (const entry of batch.entries) {
        if (entry.table === "materialExperiences") {
          const parent = entry.materialItemId ? await this.db.materialItems.get(entry.materialItemId) : undefined;
          if (!parent || parent.deletedAt) throw new Error("请先从回收站恢复所属素材");
          const experiences = (parent.experiences ?? []).map((experience) => {
            if (experience.id !== entry.id) return experience;
            delete experience.deletedAt;
            delete experience.trashBatchId;
            return { ...experience, revision: experience.revision + 1, updatedAt: now() };
          });
          await this.db.materialItems.put({ ...parent, experiences, updatedAt: now(), revision: parent.revision + 1, factRevision: parent.factRevision + 1 });
        } else if (entry.table === "materialItems") {
          const record = await this.db.materialItems.get(entry.id);
          if (record) {
            delete record.deletedAt;
            delete record.trashBatchId;
            record.updatedAt = now();
            await this.db.materialItems.put(record);
          }
        } else if (entry.table === "materialVersions") {
          const record = await this.db.materialVersions.get(entry.id);
          if (record) {
            record.name = await this.availableRestoredVersionName(record.materialItemId, record.name, record.id);
            delete record.deletedAt;
            delete record.trashBatchId;
            record.updatedAt = now();
            await this.db.materialVersions.put(record);
          }
        } else if (entry.table === "interviewNotes") {
          const record = await this.db.interviewNotes.get(entry.id);
          if (record) {
            const activeNote = (await this.db.interviewNotes.where("materialVersionId").equals(record.materialVersionId).toArray())
              .find((note) => !note.deletedAt && note.id !== record.id);
            if (activeNote) throw new Error("该版本已经存在面试备注，请先处理现有备注");
            delete record.deletedAt;
            delete record.trashBatchId;
            record.updatedAt = now();
            await this.db.interviewNotes.put(record);
          }
        } else {
          const record = await this.db.resumeProjects.get(entry.id);
          if (record) {
            delete record.deletedAt;
            delete record.trashBatchId;
            record.updatedAt = now();
            record.revision += 1;
            await this.db.resumeProjects.put(record);
          }
        }
      }
      await this.db.trashBatches.delete(batchId);
    });
  }

  async permanentlyDeleteTrashBatch(batchId: string): Promise<void> {
    await this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, this.db.interviewNotes, this.db.resumeProjects, this.db.trashBatches, async () => {
      const batch = await this.db.trashBatches.get(batchId);
      if (!batch) return;
      for (const entry of batch.entries) {
        if (entry.table === "materialExperiences") {
          const parent = entry.materialItemId ? await this.db.materialItems.get(entry.materialItemId) : undefined;
          if (parent) await this.db.materialItems.put({ ...parent, experiences: (parent.experiences ?? []).filter((experience) => experience.id !== entry.id), updatedAt: now(), revision: parent.revision + 1, factRevision: parent.factRevision + 1 });
        } else await this.tableFor(entry.table).delete(entry.id);
      }
      if (batch.rootType === "material") {
        const childBatches = await this.db.trashBatches.toArray();
        for (const child of childBatches) if (child.id !== batch.id && child.entries.some((entry) => entry.table === "materialExperiences" && entry.materialItemId === batch.rootId)) await this.db.trashBatches.delete(child.id);
      }
      await this.db.trashBatches.delete(batchId);
    });
  }

  private findOrganization(item: MaterialItem): string {
    for (const key of ["company", "projectName", "school", "organization", "issuer", "activity", "itemName"]) {
      const value = item.facts[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "未填写组织信息";
  }

  private toResumeEntryContent(item: MaterialItem, version: MaterialVersion): ResumeEntryContent {
    const text = (key: string) => typeof item.facts[key] === "string" ? String(item.facts[key]).trim() : "";
    const heading = text("projectName") || text("activity") || text("certificateName") || text("itemName")
      || text("position") || text("major") || item.internalName;
    const organization = text("company") || text("school") || text("organization") || text("issuer");
    const role = text("position") || text("role") || (item.category === "education"
      ? text("degree")
      : [text("degree"), text("major")].filter(Boolean).join(" · "));
    const period = text("period") || text("serviceTime") || text("issuedAt")
      || [text("startDate"), text("endDate")].filter(Boolean).join(" – ");
    return {
      heading,
      organization,
      role,
      period,
      location: text("location"),
      summary: version.summary,
      bullets: [...version.bullets],
      links: [...item.links]
    };
  }

  private async assertUniqueVersionName(materialItemId: string, name: string, excludedId?: string): Promise<void> {
    const versions = await this.db.materialVersions.where("materialItemId").equals(materialItemId).toArray();
    if (versions.some((version) => !version.deletedAt && version.id !== excludedId && version.name === name)) {
      throw new DuplicateVersionNameError();
    }
  }

  private async availableRestoredVersionName(materialItemId: string, requestedName: string, restoredId: string): Promise<string> {
    const versions = await this.db.materialVersions.where("materialItemId").equals(materialItemId).toArray();
    const usedNames = new Set(versions.filter((version) => !version.deletedAt && version.id !== restoredId).map((version) => version.name));
    if (!usedNames.has(requestedName)) return requestedName;
    let suffix = 1;
    let candidate = `${requestedName}（已恢复）`;
    while (usedNames.has(candidate)) {
      suffix += 1;
      candidate = `${requestedName}（已恢复${suffix}）`;
    }
    return candidate;
  }

  private async createTrashBatch(
    rootType: TrashBatch["rootType"],
    rootId: string,
    displayName: string,
    entries: TrashBatch["entries"]
  ): Promise<TrashBatch> {
    const deletedAt = now();
    const batch: TrashBatch = { id: createId(), rootType, rootId, displayName, deletedAt, entries };
    await this.db.transaction("rw", this.db.materialItems, this.db.materialVersions, this.db.interviewNotes, this.db.resumeProjects, this.db.trashBatches, async () => {
      for (const entry of entries) await this.tableFor(entry.table).update(entry.id, { deletedAt, trashBatchId: batch.id });
      await this.db.trashBatches.add(batch);
    });
    return batch;
  }

  private tableFor(table: TrashableTable): EntityTable<MaterialItem | MaterialVersion | InterviewNote | ResumeProject, "id"> {
    if (table === "materialExperiences") throw new Error("经历内容需要通过所属素材处理");
    if (table === "materialItems") return this.db.materialItems as EntityTable<MaterialItem | MaterialVersion | InterviewNote | ResumeProject, "id">;
    if (table === "materialVersions") return this.db.materialVersions as EntityTable<MaterialItem | MaterialVersion | InterviewNote | ResumeProject, "id">;
    if (table === "interviewNotes") return this.db.interviewNotes as EntityTable<MaterialItem | MaterialVersion | InterviewNote | ResumeProject, "id">;
    return this.db.resumeProjects as EntityTable<MaterialItem | MaterialVersion | InterviewNote | ResumeProject, "id">;
  }
}

export const repository = new CareerWorkbenchRepository(database);
export { liveQuery } from "dexie";
