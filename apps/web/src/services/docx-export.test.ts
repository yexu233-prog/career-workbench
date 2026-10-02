import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { DEFAULT_RESUME_STYLE, type ResumeProject } from "@career-workbench/domain";
import { createResumeDocx } from "./docx-export";

async function readDocxPart(blob: Blob, targetName: string): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  let endRecord = bytes.length - 22;
  while (endRecord >= 0 && bytes.readUInt32LE(endRecord) !== 0x06054b50) endRecord -= 1;
  if (endRecord < 0) throw new Error("DOCX ZIP directory is missing");
  const entryCount = bytes.readUInt16LE(endRecord + 10);
  let cursor = bytes.readUInt32LE(endRecord + 16);
  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("DOCX ZIP entry is invalid");
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    if (name === targetName) {
      const localNameLength = bytes.readUInt16LE(localOffset + 26);
      const localExtraLength = bytes.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      return (method === 8 ? inflateRawSync(compressed) : compressed).toString("utf8");
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`DOCX part missing: ${targetName}`);
}

function project(): ResumeProject {
  const now = new Date().toISOString();
  return {
    id: "docx-test", schemaVersion: 1, createdAt: now, updatedAt: now, revision: 1,
    name: "张三的简历", targetRole: "产品经理", language: "zh-CN", targetLength: "one",
    jdText: "", jdOriginalText: "", jdSourceName: "",
    profile: {
      chineseName: "张三", englishName: "Alex Zhang", phone: "13800000000", email: "alex@example.com", city: "杭州",
      targetDirection: "产品经理", summary: "负责**产品规划**与交付。", skills: ["需求分析", "SQL"],
      links: [{ id: "link-1", label: "作品集", url: "https://example.com" }], customFields: [], hiddenFields: [],
    },
    modules: [{
      id: "module-1", title: "项目经历", kind: "material", category: "project", hidden: false, text: "", pageBreakBefore: true,
      entries: [{
        id: "entry-1", sourceMaterialItemId: "material-1", sourceVersionId: "version-1", sourceMaterialName: "项目A", sourceVersionName: "岗位版本",
        sourceCategory: "project", sourceVersionRevision: 1,
        lastSynced: { heading: "项目A", organization: "示例公司", role: "负责人", period: "2025", location: "杭州", summary: "提升转化率", bullets: ["推动跨部门协作"], links: ["https://example.com/case"] },
        current: { heading: "项目A", organization: "示例公司", role: "负责人", period: "2025", location: "杭州", summary: "提升**转化率**", bullets: ["推动跨部门协作"], links: ["https://example.com/case"] },
      }],
    }],
    style: { ...DEFAULT_RESUME_STYLE },
  };
}

describe("editable Word export", () => {
  it("creates a real DOCX package from resume data", async () => {
    const blob = await createResumeDocx(project());
    expect(blob.size).toBeGreaterThan(500);
    expect([...new Uint8Array(await blob.slice(0, 2).arrayBuffer())]).toEqual([0x50, 0x4b]);
  });

  it("writes school, major, degree and skills in the reference order with A4 margins", async () => {
    const data = project();
    data.profile.skills = ["合成技能"];
    data.modules.unshift({
      id: "education-module", title: "教育经历", kind: "material", category: "education", hidden: false, text: "", pageBreakBefore: false,
      entries: [{
        id: "education-entry", sourceMaterialItemId: "education-material", sourceVersionId: "education-version",
        sourceMaterialName: "示例大学", sourceVersionName: "旧字段样例", sourceCategory: "education", sourceVersionRevision: 1,
        lastSynced: { heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "2023—2026", location: "杭州", summary: "", bullets: [], links: [] },
        current: { heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "2023—2026", location: "杭州", summary: "", bullets: [], links: [] }
      }]
    });
    const blob = await createResumeDocx(data);
    const documentXml = await readDocxPart(blob, "word/document.xml");
    expect(documentXml.indexOf("示例大学")).toBeLessThan(documentXml.indexOf("社会学"));
    expect(documentXml.indexOf("社会学")).toBeLessThan(documentXml.indexOf("硕士"));
    expect(documentXml.indexOf("2023—2026")).toBeLessThan(documentXml.indexOf("合成技能"));
    expect(documentXml).toContain('w:top="765"');
    expect(documentXml).toContain('w:left="964"');
  });

  it("uses the same contact and experience order for an existing project", async () => {
    const data = project();
    data.style.templateVersion = 1;
    const documentXml = await readDocxPart(await createResumeDocx(data), "word/document.xml");
    expect(documentXml.indexOf("13800000000")).toBeLessThan(documentXml.indexOf("alex@example.com"));
    expect(documentXml.indexOf("alex@example.com")).toBeLessThan(documentXml.indexOf("杭州"));
    expect(documentXml.indexOf("杭州")).toBeLessThan(documentXml.indexOf("求职意向：产品经理"));
    expect(documentXml.indexOf("示例公司")).toBeLessThan(documentXml.indexOf("负责人"));
    expect(documentXml.indexOf("负责人")).toBeLessThan(documentXml.indexOf("项目A"));
  });
});
