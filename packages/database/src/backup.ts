import type { CareerWorkbenchDatabase, MetaRecord, SettingsRecord } from './index';
import { APP_VERSION } from '@career-workbench/shared';

export const BACKUP_FORMAT = 'career-workbench-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_BYTES = 100 * 1024 * 1024;
export const BACKUP_SETTINGS_ALLOWLIST = new Set(['onboarding-state']);

export type BackupJsonValue = null | boolean | number | string | BackupJsonValue[] | { [key: string]: BackupJsonValue };

export interface BackupPayloadV1 {
  profiles: BackupJsonValue[];
  assets: BackupJsonValue[];
  materialItems: BackupJsonValue[];
  materialVersions: BackupJsonValue[];
  interviewNotes: BackupJsonValue[];
  resumeProjects: BackupJsonValue[];
  trashBatches: BackupJsonValue[];
  settings: BackupJsonValue[];
}

export interface BackupEnvelopeV1 {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  databaseSchemaVersion: number;
  exportedAt: string;
  recordCounts: Record<keyof BackupPayloadV1, number>;
  payloadSha256: string;
  payload: BackupPayloadV1;
}

export interface BackupSummary {
  exportedAt: string;
  appVersion: string;
  databaseSchemaVersion: number;
  recordCounts: Record<keyof BackupPayloadV1, number>;
  sizeBytes: number;
}

export interface ValidatedBackup {
  envelope: BackupEnvelopeV1;
  decodedPayload: DecodedBackupPayload;
  summary: BackupSummary;
}

export interface BackupValidationResult {
  compatible: boolean;
  errors: string[];
  warnings: string[];
  summary?: BackupSummary;
  validatedBackup?: ValidatedBackup;
}

export interface RestoreResult {
  restoredAt: string;
  recordCounts: Record<keyof BackupPayloadV1, number>;
}

interface DecodedBackupPayload {
  profiles: unknown[];
  assets: unknown[];
  materialItems: unknown[];
  materialVersions: unknown[];
  interviewNotes: unknown[];
  resumeProjects: unknown[];
  trashBatches: unknown[];
  settings: unknown[];
}

type BackupTable<T> = {
  toArray(): Promise<T[]>;
  clear(): Promise<void>;
  bulkAdd(records: T[]): Promise<unknown>;
};

export type BackupDatabaseLike = Pick<CareerWorkbenchDatabase,
  'meta' | 'settings' | 'profiles' | 'assets' | 'materialItems' | 'materialVersions' |
  'interviewNotes' | 'resumeProjects' | 'trashBatches' | 'aiCandidates' | 'undoSnapshots'> & {
    transaction: CareerWorkbenchDatabase['transaction'];
  };

type BlobJson = {
  __backupType: 'blob';
  mimeType: string;
  size: number;
  base64: string;
};

const PAYLOAD_KEYS: (keyof BackupPayloadV1)[] = [
  'profiles', 'assets', 'materialItems', 'materialVersions', 'interviewNotes',
  'resumeProjects', 'trashBatches', 'settings',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(result);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encodeValue(value: unknown): Promise<BackupJsonValue> {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    return { __backupType: 'blob', mimeType: value.type || 'application/octet-stream', size: bytes.byteLength, base64: bytesToBase64(bytes) } as unknown as BackupJsonValue;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return Promise.all(value.map((item) => encodeValue(item)));
  if (isRecord(value)) {
    const output: Record<string, BackupJsonValue> = {};
    for (const key of Object.keys(value).sort()) output[key] = await encodeValue(value[key]);
    return output;
  }
  throw new Error(`备份包含不支持的数据类型：${typeof value}`);
}

function decodeValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => decodeValue(item, `${path}[${index}]`));
  if (!isRecord(value)) return value;
  if (value.__backupType === 'blob') {
    if (typeof value.mimeType !== 'string' || typeof value.base64 !== 'string' || !Number.isInteger(value.size) || (value.size as number) < 0) {
      throw new Error(`图片数据无效：${path}`);
    }
    const bytes = base64ToBytes(value.base64);
    if (bytes.byteLength !== (value.size as number)) throw new Error(`图片大小校验失败：${path}`);
    return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: value.mimeType });
  }
  if ('__backupType' in value) throw new Error(`未知的备份特殊数据类型：${path}`);
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) output[key] = decodeValue(child, `${path}.${key}`);
  return output;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function canonicalPayload(envelope: Omit<BackupEnvelopeV1, 'payloadSha256'>): string {
  return JSON.stringify(stableValue(envelope));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readPayload(db: BackupDatabaseLike): Promise<BackupPayloadV1> {
  const transaction = db.transaction as unknown as (...args: unknown[]) => Promise<unknown>;
  const records = await transaction.call(db, 'r', db.profiles, db.assets, db.materialItems, db.materialVersions,
    db.interviewNotes, db.resumeProjects, db.trashBatches, db.settings, async () => ({
      profiles: await db.profiles.toArray(),
      assets: await db.assets.toArray(),
      materialItems: await db.materialItems.toArray(),
      materialVersions: await db.materialVersions.toArray(),
      interviewNotes: await db.interviewNotes.toArray(),
      resumeProjects: await db.resumeProjects.toArray(),
      trashBatches: await db.trashBatches.toArray(),
      settings: (await db.settings.toArray()).filter((record: SettingsRecord) => BACKUP_SETTINGS_ALLOWLIST.has(record.key)),
    })) as any;
  const encoded = {} as BackupPayloadV1;
  for (const key of PAYLOAD_KEYS) encoded[key] = await Promise.all(records[key].map((record: unknown) => encodeValue(record)));
  return encoded;
}

function recordCounts(payload: BackupPayloadV1): Record<keyof BackupPayloadV1, number> {
  return Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, payload[key].length])) as Record<keyof BackupPayloadV1, number>;
}

export async function createFullBackup(db: BackupDatabaseLike): Promise<BackupEnvelopeV1> {
  const payload = await readPayload(db);
  const withoutHash = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    databaseSchemaVersion: 1,
    exportedAt: new Date().toISOString(),
    recordCounts: recordCounts(payload),
    payload,
  } as const;
  const payloadSha256 = await sha256(canonicalPayload(withoutHash));
  const envelope = { ...withoutHash, payloadSha256 };
  const size = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
  if (size > BACKUP_MAX_BYTES) throw new Error(`备份文件超过 100MB 上限（${Math.ceil(size / 1024 / 1024)}MB），已阻止导出`);
  return envelope;
}

function validateArrayRecords(payload: DecodedBackupPayload, errors: string[]): void {
  const idsByTable = new Map<string, Set<string>>();
  if (!payload.profiles.some((record) => isRecord(record) && record.id === 'default')) errors.push('备份缺少默认个人资料');
  for (const key of PAYLOAD_KEYS) {
    const records = payload[key];
    if (!Array.isArray(records)) { errors.push(`字段 payload.${key} 必须是数组`); continue; }
    const ids = new Set<string>();
    for (const [index, record] of records.entries()) {
      if (!isRecord(record) || typeof record.id !== 'string' && key !== 'settings') errors.push(`payload.${key}[${index}] 缺少有效 ID`);
      if (isRecord(record) && typeof record.id === 'string') {
        if (ids.has(record.id)) errors.push(`payload.${key} 存在重复 ID：${record.id}`);
        ids.add(record.id);
      }
    }
    idsByTable.set(key, ids);
  }
  const itemIds = idsByTable.get('materialItems') ?? new Set();
  const versionIds = idsByTable.get('materialVersions') ?? new Set();
  for (const record of payload.materialVersions) {
    if (isRecord(record) && typeof record.materialItemId === 'string' && !itemIds.has(record.materialItemId)) errors.push(`版本 ${String(record.id)} 关联的素材不存在`);
  }
  for (const record of payload.interviewNotes) {
    if (isRecord(record) && typeof record.materialVersionId === 'string' && !versionIds.has(record.materialVersionId)) errors.push(`面试备注 ${String(record.id)} 关联的版本不存在`);
  }
  for (const record of payload.materialItems) {
    if (isRecord(record) && typeof record.originalVersionId === 'string' && !versionIds.has(record.originalVersionId)) errors.push(`素材 ${String(record.id)} 的原始版本不存在`);
  }
  const experienceOwners = new Map<string, { materialId: string; experience: Record<string, unknown> }>();
  const activeExperienceNames = new Map<string, Set<string>>();
  for (const record of payload.materialItems) {
    if (!isRecord(record) || record.experiences === undefined) continue;
    if (!Array.isArray(record.experiences)) { errors.push(`素材 ${String(record.id)} 的经历内容格式无效`); continue; }
    for (const experience of record.experiences) {
      if (!isRecord(experience) || typeof experience.id !== 'string' || typeof experience.name !== 'string' || !experience.name.trim() || typeof experience.content !== 'string' || experience.schemaVersion !== 1 || typeof experience.createdAt !== 'string' || typeof experience.updatedAt !== 'string' || !Number.isInteger(experience.revision) || (experience.revision as number) < 1 || (experience.deletedAt !== undefined && typeof experience.deletedAt !== 'string') || (experience.trashBatchId !== undefined && typeof experience.trashBatchId !== 'string')) {
        errors.push(`素材 ${String(record.id)} 包含无效的经历内容`);
        continue;
      }
      if (experienceOwners.has(experience.id)) errors.push(`经历内容存在重复 ID：${experience.id}`);
      experienceOwners.set(experience.id, { materialId: record.id as string, experience });
      if (!experience.deletedAt) {
        const names = activeExperienceNames.get(record.id as string) ?? new Set<string>();
        if (names.has(experience.name)) errors.push(`素材 ${String(record.id)} 的经历名称重复：${experience.name}`);
        names.add(experience.name);
        activeExperienceNames.set(record.id as string, names);
      }
    }
  }
  const experienceTrashRefs = new Map<string, number>();
  for (const record of payload.trashBatches) {
    if (!isRecord(record) || !Array.isArray(record.entries)) continue;
    for (const entry of record.entries) {
      if (!isRecord(entry) || entry.table !== 'materialExperiences') continue;
      const owner = typeof entry.materialItemId === 'string' ? entry.materialItemId : '';
      const experience = typeof entry.id === 'string' ? experienceOwners.get(entry.id) : undefined;
      if (!experience || experience.materialId !== owner || !experience.experience.deletedAt) errors.push(`回收站中的经历内容 ${String(entry.id)} 关联关系无效`);
      if (typeof record.id === 'string' && typeof entry.id === 'string') {
        const ref = `${record.id}\u0000${owner}\u0000${entry.id}`;
        experienceTrashRefs.set(ref, (experienceTrashRefs.get(ref) ?? 0) + 1);
      }
    }
  }
  for (const [id, owner] of experienceOwners) {
    const trashed = typeof owner.experience.deletedAt === 'string';
    const batchId = typeof owner.experience.trashBatchId === 'string' ? owner.experience.trashBatchId : '';
    const referenceCount = experienceTrashRefs.get(`${batchId}\u0000${owner.materialId}\u0000${id}`) ?? 0;
    if (trashed && referenceCount !== 1) errors.push(`已删除的经历内容 ${id} 缺少唯一的回收站记录`);
    if (!trashed && batchId) errors.push(`未删除的经历内容 ${id} 不能关联回收站记录`);
  }
  const names = new Set<string>();
  for (const record of payload.materialVersions) {
    if (isRecord(record) && typeof record.materialItemId === 'string' && typeof record.name === 'string') {
      const key = `${record.materialItemId}\u0000${record.name}`;
      if (names.has(key)) errors.push(`同一素材下存在重复版本名称：${record.name}`);
      names.add(key);
    }
  }
}

export async function inspectBackupFile(file: Blob): Promise<BackupValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (file.size > BACKUP_MAX_BYTES) return { compatible: false, errors: ['备份文件超过 100MB 上限，已阻止读取'], warnings };
  let raw: unknown;
  try { raw = JSON.parse(await file.text()) as unknown; } catch { return { compatible: false, errors: ['备份文件不是有效 JSON'], warnings }; }
  if (!isRecord(raw)) return { compatible: false, errors: ['备份根对象无效'], warnings };
  if (raw.format !== BACKUP_FORMAT) errors.push('备份格式不兼容');
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) errors.push(`备份格式版本不兼容：${String(raw.formatVersion)}`);
  if (typeof raw.appVersion !== 'string') errors.push('缺少应用版本');
  if (raw.databaseSchemaVersion !== 1) errors.push(`数据库版本不兼容：${String(raw.databaseSchemaVersion)}`);
  if (typeof raw.exportedAt !== 'string') errors.push('缺少导出时间');
  if (typeof raw.payloadSha256 !== 'string') errors.push('缺少备份校验和');
  if (!isRecord(raw.payload)) errors.push('缺少备份数据');
  if (errors.length) return { compatible: false, errors, warnings };
  const withoutHash = { ...raw };
  delete withoutHash.payloadSha256;
  const expectedHash = await sha256(canonicalPayload(withoutHash as Omit<BackupEnvelopeV1, 'payloadSha256'>));
  if (expectedHash !== raw.payloadSha256) errors.push('备份校验和不匹配，文件可能已被篡改或损坏');
  let decodedPayload: DecodedBackupPayload;
  try {
    decodedPayload = decodeValue(raw.payload, 'payload') as DecodedBackupPayload;
    validateArrayRecords(decodedPayload, errors);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : '备份中的图片或字段无法解析');
    decodedPayload = { profiles: [], assets: [], materialItems: [], materialVersions: [], interviewNotes: [], resumeProjects: [], trashBatches: [], settings: [] };
  }
  const countsValue = raw.recordCounts;
  if (!isRecord(countsValue)) errors.push('缺少有效记录数量摘要');
  const counts = (isRecord(countsValue) ? countsValue : {}) as Partial<Record<keyof BackupPayloadV1, unknown>>;
  for (const key of PAYLOAD_KEYS) {
    if (!Number.isInteger(counts[key])) errors.push(`记录数量摘要无效：${key}`);
    else if (counts[key] !== decodedPayload[key].length) errors.push(`记录数量与备份内容不一致：${key}`);
  }
  const summary: BackupSummary = {
    exportedAt: raw.exportedAt as string,
    appVersion: raw.appVersion as string,
    databaseSchemaVersion: raw.databaseSchemaVersion as number,
    recordCounts: Object.fromEntries(PAYLOAD_KEYS.map((key) => [key, typeof counts[key] === 'number' ? counts[key] : 0])) as Record<keyof BackupPayloadV1, number>,
    sizeBytes: new TextEncoder().encode(JSON.stringify(raw)).byteLength,
  };
  if (!decodedPayload.settings.some((record) => isRecord(record) && record.key === 'onboarding-state')) warnings.push('备份不包含引导状态，将使用当前引导状态');
  if (errors.length) return { compatible: false, errors, warnings, summary };
  return { compatible: true, errors, warnings, summary, validatedBackup: { envelope: raw as unknown as BackupEnvelopeV1, decodedPayload, summary } };
}

export async function restoreFullBackup(db: BackupDatabaseLike, validatedBackup: ValidatedBackup): Promise<RestoreResult> {
  const payload = validatedBackup.decodedPayload;
  const tables = [db.meta, db.settings, db.profiles, db.assets, db.materialItems, db.materialVersions,
    db.interviewNotes, db.resumeProjects, db.trashBatches, db.aiCandidates, db.undoSnapshots];
  const transaction = db.transaction as unknown as (...args: unknown[]) => Promise<unknown>;
  await transaction.call(db, 'rw', ...tables, async () => {
    for (const table of tables) await table.clear();
    await db.profiles.bulkAdd(payload.profiles as never[]);
    await db.assets.bulkAdd(payload.assets as never[]);
    await db.materialItems.bulkAdd(payload.materialItems as never[]);
    await db.materialVersions.bulkAdd(payload.materialVersions as never[]);
    await db.interviewNotes.bulkAdd(payload.interviewNotes as never[]);
    await db.resumeProjects.bulkAdd(payload.resumeProjects as never[]);
    await db.trashBatches.bulkAdd(payload.trashBatches as never[]);
    await db.settings.bulkAdd(payload.settings as never[]);
    const now = new Date().toISOString();
    await db.meta.bulkAdd([
      { key: 'appVersion', value: APP_VERSION, updatedAt: now },
      { key: 'databaseSchemaVersion', value: 1, updatedAt: now },
    ] as MetaRecord[]);
  });
  return { restoredAt: new Date().toISOString(), recordCounts: recordCounts(validatedBackup.envelope.payload) };
}

