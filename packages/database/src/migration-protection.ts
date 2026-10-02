import Dexie from 'dexie';
import type { BackupDatabaseLike, BackupEnvelopeV1 } from './backup';
import { createFullBackup } from './backup';
import type { CareerWorkbenchDatabase } from './index';

export const SAFETY_DATABASE_NAME = 'career-workbench-safety';
export const CURRENT_DATABASE_SCHEMA_VERSION = 1;

export interface MigrationSafetySnapshot {
  id: 'latest';
  createdAt: string;
  sourceVersion: number;
  targetVersion: number;
  payloadSha256: string;
  backup: BackupEnvelopeV1;
}

const LEGACY_V1_STORES = {
  meta: '&key, updatedAt',
  settings: '&key, updatedAt',
  profiles: '&id, updatedAt, deletedAt',
  assets: '&id, updatedAt, deletedAt',
  materialItems: '&id, category, updatedAt, deletedAt, *tags',
  materialVersions: '&id, materialItemId, [materialItemId+name], updatedAt, deletedAt',
  interviewNotes: '&id, &materialVersionId, updatedAt, deletedAt',
  resumeProjects: '&id, updatedAt, deletedAt, archivedAt',
  trashBatches: '&id, deletedAt',
  aiCandidates: '&id, taskType, createdAt, expiresAt',
  undoSnapshots: '&id, objectId, createdAt, expiresAt'
};

function safetyDatabase(): Dexie {
  const db = new Dexie(SAFETY_DATABASE_NAME);
  db.version(1).stores({ snapshots: '&id, createdAt' });
  return db;
}

export async function getNativeDatabaseVersion(name: string): Promise<number | undefined> {
  const databases = indexedDB.databases ? await indexedDB.databases() : [];
  return databases.find((entry) => entry.name === name)?.version;
}

export async function saveMigrationSafetySnapshot(
  backup: BackupEnvelopeV1,
  sourceVersion: number,
  targetVersion: number
): Promise<MigrationSafetySnapshot> {
  const snapshot: MigrationSafetySnapshot = {
    id: 'latest',
    createdAt: new Date().toISOString(),
    sourceVersion,
    targetVersion,
    payloadSha256: backup.payloadSha256,
    backup
  };
  const db = safetyDatabase();
  try {
    await db.open();
    await db.table<MigrationSafetySnapshot>('snapshots').put(snapshot);
  } finally {
    db.close();
  }
  return snapshot;
}

export async function readLatestMigrationSafetySnapshot(): Promise<MigrationSafetySnapshot | undefined> {
  const db = safetyDatabase();
  try {
    await db.open();
    return await db.table<MigrationSafetySnapshot>('snapshots').get('latest');
  } finally {
    db.close();
  }
}

/**
 * Runs before Dexie opens the current schema. If a future schema version is
 * introduced, this reads the known v1 schema through a separate Dexie handle
 * and stores a complete safety backup before the real upgrade transaction.
 */
export async function prepareMigrationSnapshot(
  targetDatabase: CareerWorkbenchDatabase,
  targetVersion = CURRENT_DATABASE_SCHEMA_VERSION,
  versionReader: (name: string) => Promise<number | undefined> = getNativeDatabaseVersion
): Promise<MigrationSafetySnapshot | undefined> {
  const nativeVersion = await versionReader(targetDatabase.name);
  if (!nativeVersion || nativeVersion >= targetVersion) return undefined;
  if (nativeVersion !== 1) throw new Error(`无法为数据库版本 ${nativeVersion} 创建迁移前快照`);

  const legacy = new Dexie(targetDatabase.name);
  legacy.version(1).stores(LEGACY_V1_STORES);
  try {
    await legacy.open();
    const backup = await createFullBackup(legacy as unknown as BackupDatabaseLike);
    return await saveMigrationSafetySnapshot(backup, nativeVersion, targetVersion);
  } finally {
    legacy.close();
  }
}

