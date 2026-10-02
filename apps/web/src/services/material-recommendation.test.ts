import { describe, expect, it } from "vitest";
import type { MaterialBundle } from "@career-workbench/domain";
import { buildRecommendationPlan, fingerprintAiScope } from "./material-recommendation";

function bundle(id: string, summary: string, language: "zh-CN" | "en" = "zh-CN"): MaterialBundle {
  const timestamp = "2026-08-21T00:00:00.000Z";
  return {
    item: { id, schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1, internalName: id, category: "project", tags: [], skills: [], links: [], factNotes: "", facts: {}, factRevision: 1, originalVersionId: `${id}-version` },
    versions: [{ id: `${id}-version`, schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1, materialItemId: id, name: "原始版本", isOriginal: true, language, summary, bullets: [], targetRole: "", jdText: "", emphasis: "", tags: [], notes: "", creationMethod: "manual", sourceFactRevision: 1 }],
    notes: []
  };
}

describe("material recommendation planning", () => {
  it("ranks locally, limits the default scope and excludes selected materials", () => {
    const bundles = [bundle("selected", "产品经理"), bundle("backend", "负责后端开发"), bundle("product", "负责产品需求分析")];
    const plan = buildRecommendationPlan({ targetRole: "产品经理", jdText: "需求分析", language: "zh-CN" }, bundles, new Set(["selected"]), false, false, 1);
    expect(plan.totalEligible).toBe(2);
    expect(plan.materials[0]?.materialItemId).toBe("product");
    expect(plan.locallyFiltered).toBe(true);
  });

  it("allows a user-controlled full evaluation", () => {
    const bundles = [bundle("one", "产品"), bundle("two", "项目")];
    expect(buildRecommendationPlan({ targetRole: "产品", jdText: "项目", language: "zh-CN" }, bundles, new Set(), false, true, 1).submittedCount).toBe(2);
  });

  it("creates a stable scope fingerprint that changes with the input", () => {
    expect(fingerprintAiScope({ a: 1 })).toBe(fingerprintAiScope({ a: 1 }));
    expect(fingerprintAiScope({ a: 1 })).not.toBe(fingerprintAiScope({ a: 2 }));
  });
});
