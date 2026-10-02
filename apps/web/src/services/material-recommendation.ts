import { MATERIAL_CATEGORY_LABELS, stripBoldMarkup, type MaterialBundle, type ResumeProject } from "@career-workbench/domain";

export interface RecommendationMaterialPayload {
  id: string;
  materialItemId: string;
  materialName: string;
  category: string;
  versionName: string;
  language: string;
  facts: Record<string, string | boolean>;
  skills: string[];
  summary: string;
  bullets: string[];
}

export interface RecommendationPlan {
  materials: RecommendationMaterialPayload[];
  totalEligible: number;
  submittedCount: number;
  locallyFiltered: boolean;
}

function searchableTokens(value: string): string[] {
  const normalized = stripBoldMarkup(value).toLocaleLowerCase();
  const tokens = normalized.match(/[a-z0-9][a-z0-9+#.-]{1,}|[\u3400-\u9fff]+/g) ?? [];
  const result = new Set<string>();
  for (const token of tokens) {
    if (/^[\u3400-\u9fff]+$/.test(token)) {
      if (token.length <= 4) result.add(token);
      for (let index = 0; index < token.length - 1; index += 1) result.add(token.slice(index, index + 2));
    } else result.add(token);
  }
  return [...result];
}

function materialPayloads(bundles: MaterialBundle[], selectedMaterialIds: ReadonlySet<string>, allowDuplicates: boolean): RecommendationMaterialPayload[] {
  return bundles.flatMap((bundle) => {
    if (!allowDuplicates && selectedMaterialIds.has(bundle.item.id)) return [];
    return bundle.versions.filter((version) => !version.deletedAt).map((version) => ({
      id: version.id,
      materialItemId: bundle.item.id,
      materialName: bundle.item.internalName,
      category: MATERIAL_CATEGORY_LABELS[bundle.item.category],
      versionName: version.name,
      language: version.language,
      facts: bundle.item.facts,
      skills: bundle.item.skills,
      summary: version.summary,
      bullets: version.bullets
    }));
  });
}

function scoreCandidate(candidate: RecommendationMaterialPayload, roleTokens: string[], jdTokens: string[], projectLanguage: ResumeProject["language"]): number {
  const searchable = [candidate.materialName, candidate.category, candidate.versionName, ...Object.values(candidate.facts).map(String), ...candidate.skills, candidate.summary, ...candidate.bullets].join("\n").toLocaleLowerCase();
  const roleScore = roleTokens.reduce((total, token) => total + (searchable.includes(token) ? 4 : 0), 0);
  const jdScore = jdTokens.reduce((total, token) => total + (searchable.includes(token) ? 1 : 0), 0);
  return roleScore + jdScore + (candidate.language === projectLanguage ? 2 : 0);
}

export function buildRecommendationPlan(
  project: Pick<ResumeProject, "targetRole" | "jdText" | "language">,
  bundles: MaterialBundle[],
  selectedMaterialIds: ReadonlySet<string>,
  allowDuplicates: boolean,
  evaluateAll: boolean,
  limit = 30
): RecommendationPlan {
  const eligible = materialPayloads(bundles, selectedMaterialIds, allowDuplicates);
  const roleTokens = searchableTokens(project.targetRole);
  const jdTokens = searchableTokens(project.jdText);
  const ranked = eligible.map((candidate, index) => ({ candidate, index, score: scoreCandidate(candidate, roleTokens, jdTokens, project.language) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const materials = (evaluateAll ? ranked : ranked.slice(0, limit)).map((item) => item.candidate);
  return { materials, totalEligible: eligible.length, submittedCount: materials.length, locallyFiltered: materials.length < eligible.length };
}

export function fingerprintAiScope(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}
