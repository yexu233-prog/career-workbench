import { describe, expect, it } from "vitest";
import { buildResumeDocxFilename, buildResumeDocumentModel, buildResumePdfFilename, DEFAULT_RESUME_STYLE, getEducationEntryDisplay, getResumePageMargins, getResumePhotoDimensions, LEGACY_RESUME_STYLE, sanitizeWindowsFilename, syncResumeEntrySnapshot, type ResumeProject } from "./index";

function projectWithBullets(count: number): ResumeProject {
  const timestamp = new Date().toISOString();
  return {
    id: "resume-1", schemaVersion: 1, createdAt: timestamp, updatedAt: timestamp, revision: 1,
    name: "测试简历", targetRole: "产品经理", language: "zh-CN", targetLength: "one",
    jdText: "", jdOriginalText: "", jdSourceName: "",
    profile: {
      chineseName: "张三", englishName: "", phone: "13800000000", email: "test@example.com", city: "上海",
      targetDirection: "产品经理", summary: "关注用户价值与业务结果。", skills: ["需求分析", "SQL"], links: [], customFields: [], hiddenFields: []
    },
    modules: [{
      id: "module-1", title: "项目经历", kind: "material", category: "project", hidden: false, text: "", pageBreakBefore: false,
      entries: Array.from({ length: count }, (_, index) => ({
        id: `entry-${index}`, sourceMaterialItemId: `material-${index}`, sourceVersionId: `version-${index}`,
        sourceMaterialName: `项目${index}`, sourceVersionName: "原始版本", sourceCategory: "project", sourceVersionRevision: 1,
        lastSynced: { heading: `项目${index}`, organization: "示例公司", role: "负责人", period: "2025", location: "上海", summary: "项目概述", bullets: ["完成需求分析并推动跨团队交付，取得可量化的业务结果。"], links: [] },
        current: { heading: `项目${index}`, organization: "示例公司", role: "负责人", period: "2025", location: "上海", summary: "项目概述", bullets: ["完成需求分析并推动跨团队交付，取得可量化的业务结果。"], links: [] }
      }))
    }],
    style: { ...DEFAULT_RESUME_STYLE }
  };
}

describe("resume document model", () => {
  it("estimates the compact header from visible content instead of a fixed photo-sized block", () => {
    const project = projectWithBullets(0);
    project.profile.summary = "";
    project.profile.skills = [];
    const compact = buildResumeDocumentModel(project).pages[0]!.estimatedLines;
    project.profile.photo = { name: "test.png", mimeType: "image/png", data: new Blob(["test"]) };
    const withPhoto = buildResumeDocumentModel(project).pages[0]!.estimatedLines;
    expect(withPhoto).toBeGreaterThan(compact);
    project.profile.hiddenFields = ["photo"];
    expect(buildResumeDocumentModel(project).pages[0]!.estimatedLines).toBe(compact);
    project.profile.links = [{ id: "link", label: "", url: " " }];
    project.profile.customFields = [{ id: "custom", label: "", value: " " }];
    expect(buildResumeDocumentModel(project).pages[0]!.estimatedLines).toBe(compact);
    project.profile.email = "long-address-".repeat(25) + "@example.com";
    expect(buildResumeDocumentModel(project).pages[0]!.estimatedLines).toBeGreaterThan(compact);
  });

  it("keeps a short resume on one page", () => {
    expect(buildResumeDocumentModel(projectWithBullets(2)).pages).toHaveLength(1);
  });

  it("uses reference margins, an adaptive photo, and places skills after resume modules", () => {
    const project = projectWithBullets(1);
    expect(getResumePageMargins(DEFAULT_RESUME_STYLE)).toEqual({ verticalMm: 13.5, horizontalMm: 17 });
    expect(getResumePageMargins(LEGACY_RESUME_STYLE)).toEqual({ verticalMm: 18, horizontalMm: 18 });
    const header = { name: "示例姓名", targetRole: "产品经理", contactRows: [["13800000000", "a@example.com"], ["杭州"]] };
    const photo = getResumePhotoDimensions(DEFAULT_RESUME_STYLE, header);
    expect(photo.heightMm).toBe(26);
    expect(photo.widthMm).toBeCloseTo(photo.heightMm * 25.03 / 35.72);
    project.profile.skills = ["需求分析", "SQL"];
    const lastSection = buildResumeDocumentModel(project).pages.at(-1)!.sections.at(-1)!;
    expect(lastSection.id).toBe("profile-skills");
    expect(lastSection.title).toBe("专业技能");
  });

  it("shows education school before major and degree, including legacy snapshots", () => {
    expect(getEducationEntryDisplay({ heading: "社会学", organization: "示例大学", role: "硕士", period: "2025—至今", location: "", summary: "", bullets: [], links: [] }))
      .toEqual({ school: "示例大学", major: "社会学", degree: "硕士" });
    expect(getEducationEntryDisplay({ heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "", location: "", summary: "", bullets: [], links: [] }).degree)
      .toBe("硕士");
  });

  it("creates additional A4 pages without removing entries", () => {
    const model = buildResumeDocumentModel(projectWithBullets(18));
    expect(model.pages.length).toBeGreaterThan(1);
    expect(model.pages.flatMap((page) => page.sections).flatMap((section) => section.entries)).toHaveLength(18);
  });

  it("reports missing identity and empty content", () => {
    const project = projectWithBullets(0);
    project.profile.chineseName = "";
    project.targetRole = "";
    const model = buildResumeDocumentModel(project);
    expect(model.missingInformation).toEqual(expect.arrayContaining(["姓名未填写", "目标岗位未填写", "简历正文为空"]));
  });
});

describe("resume source synchronization", () => {
  it("updates only selected fields and preserves project-specific edits", () => {
    const entry = projectWithBullets(1).modules[0]!.entries[0]!;
    entry.current.summary = "项目内自定义概述";
    const latest = { ...entry.lastSynced, summary: "素材库新概述", bullets: ["素材库新要点"] };
    const synced = syncResumeEntrySnapshot(entry, latest, 2, new Set(["bullets"]));
    expect(synced.current.summary).toBe("项目内自定义概述");
    expect(synced.current.bullets).toEqual(["素材库新要点"]);
    expect(synced.lastSynced.summary).toBe("素材库新概述");
    expect(synced.sourceVersionRevision).toBe(2);
  });
});

describe("resume PDF filename", () => {
  it("uses the project creation date and removes Windows-invalid characters", () => {
    const project = projectWithBullets(1);
    project.createdAt = "2026-08-18T09:30:00.000Z";
    project.profile.chineseName = "张三/测试";
    project.targetRole = "产品经理:AI";
    expect(buildResumePdfFilename(project)).toBe("张三-测试-产品经理-AI-简历-2026-08-18.pdf");
  });

  it("provides explicit fallbacks and cleans trailing dots", () => {
    const project = projectWithBullets(1);
    project.createdAt = "2026-08-18T09:30:00.000Z";
    project.profile.chineseName = "";
    project.profile.englishName = "";
    project.targetRole = "";
    expect(buildResumePdfFilename(project)).toBe("未填写姓名-未填写岗位-简历-2026-08-18.pdf");
    expect(sanitizeWindowsFilename(" report... ")).toBe("report");
  });
});

describe("resume DOCX filename", () => {
  it("uses the same safe stem and project creation date as PDF", () => {
    const project = projectWithBullets(1);
    project.createdAt = "2026-08-18T09:30:00.000Z";
    expect(buildResumeDocxFilename(project)).toBe("张三-产品经理-简历-2026-08-18.docx");
  });
});
