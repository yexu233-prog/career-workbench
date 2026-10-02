import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { CareerWorkbenchDatabase, CareerWorkbenchRepository, bootstrapDatabase, prepareMigrationSnapshot, readLatestMigrationSafetySnapshot, SAFETY_DATABASE_NAME } from "./index";

const databases: Array<Dexie | CareerWorkbenchDatabase> = [];
afterEach(async () => { for (const db of databases.splice(0)) await db.delete(); const safety = new Dexie(SAFETY_DATABASE_NAME); await safety.delete(); });

describe("migration protection", () => {
  it("stores a complete v1 snapshot before a simulated v2 upgrade", async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const db = new CareerWorkbenchDatabase(name); databases.push(db);
    const repository = new CareerWorkbenchRepository(db); await bootstrapDatabase(db);
    await repository.createMaterial({ internalName: "迁移前虚构素材", category: "work" });
    const snapshot = await prepareMigrationSnapshot(db, 2, async () => 1);
    expect(snapshot?.sourceVersion).toBe(1);
    expect((await readLatestMigrationSafetySnapshot())?.backup.payload.materialItems).toHaveLength(1);

    const upgraded = new Dexie(name); databases.push(upgraded);
    upgraded.version(1).stores({ meta: "&key", profiles: "&id", settings: "&key", materialItems: "&id" });
    upgraded.version(2).stores({ meta: "&key", profiles: "&id", settings: "&key", materialItems: "&id", migrationMarker: "&id" }).upgrade((transaction) => transaction.table("migrationMarker").put({ id: "ok" }));
    await upgraded.open();
    expect(await upgraded.table("migrationMarker").get("ok")).toEqual({ id: "ok" });
  });

  it("leaves v1 data intact when the simulated upgrade throws", async () => {
    const name = `migration-fail-${crypto.randomUUID()}`;
    const source = new Dexie(name); databases.push(source);
    source.version(1).stores({ records: "&id" }); await source.open(); await source.table("records").put({ id: "keep", value: "before" }); source.close();
    const failing = new Dexie(name); databases.push(failing);
    failing.version(1).stores({ records: "&id" }); failing.version(2).stores({ records: "&id", marker: "&id" }).upgrade(() => { throw new Error("simulated migration failure"); });
    await expect(failing.open()).rejects.toThrow("simulated migration failure");
    const verify = new Dexie(name); databases.push(verify); verify.version(1).stores({ records: "&id" }); await verify.open();
    expect(await verify.table("records").get("keep")).toEqual({ id: "keep", value: "before" });
  });
});
