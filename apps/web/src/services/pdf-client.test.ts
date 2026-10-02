import { describe, expect, it } from "vitest";
import { DEFAULT_RESUME_STYLE, type ResumeDocumentModel } from "@career-workbench/domain";
import { renderResumePdfHtml } from "./pdf-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResumePreview } from "../components/ResumePreview";

function modelWithBoldText(): ResumeDocumentModel {
  const content = {
    heading: "虚构增长项目",
    organization: "",
    role: "产品负责人",
    period: "",
    location: "",
    summary: "负责 **需求分析** 与方案设计",
    bullets: ["推动 **跨团队协作** 完成交付"],
    links: []
  };
  return {
    profile: { chineseName: "测试用户", englishName: "", phone: "", email: "", city: "", targetDirection: "", summary: "", skills: [], links: [], customFields: [], hiddenFields: [] },
    targetRole: "产品经理",
    style: { ...DEFAULT_RESUME_STYLE },
    pages: [{ number: 1, showHeader: true, estimatedLines: 8, sections: [{ id: "project", title: "项目经历", kind: "material", text: "", entries: [{ id: "entry-1", sourceMaterialItemId: "material-1", sourceVersionId: "version-1", sourceMaterialName: "虚构增长项目", sourceVersionName: "原始版本", sourceCategory: "project", sourceVersionRevision: 1, lastSynced: { ...content, bullets: [...content.bullets] }, current: { ...content, bullets: [...content.bullets] } }] }] }],
    overflowModuleIds: [],
    missingInformation: []
  };
}

describe("resume PDF HTML", () => {
  it("puts phone, email and city before the target role and omits blank optional fields", () => {
    const model = modelWithBoldText();
    Object.assign(model.profile, { phone: " 13800000000 ", email: " example@example.com ", city: " 上海 ", links: [{ id: "link", label: "", url: " " }], customFields: [{ id: "custom", label: "", value: " " }] });
    const html = renderResumePdfHtml(model);
    expect(html).toContain('<div class="resume-contact"><div class="resume-contact-row"><span>13800000000</span><span>example@example.com</span><span>上海</span></div></div>');
    expect(html.indexOf("13800000000")).toBeLessThan(html.indexOf("求职意向：产品经理"));
    expect(html).not.toContain('class="resume-photo-placeholder"');
    expect(html).not.toContain("链接：");
    expect(html).not.toContain("其他：");
  });

  it("keeps the same header markup with and without the preview-only photo hint", () => {
    const model = modelWithBoldText();
    const preview = renderToStaticMarkup(createElement(ResumePreview, { model, showPhotoPlaceholder: true }));
    const pdf = renderResumePdfHtml(model);
    const header = (html: string) => html.match(/<header[\s\S]*?<\/header>/)?.[0];
    expect(preview).toContain('class="resume-photo-placeholder"');
    expect(header(preview)).toEqual(header(pdf));
    expect(header(preview)).not.toContain("resume-photo-placeholder");
  });

  it("retains a supplied photo only when it is visible", () => {
    const model = modelWithBoldText();
    expect(renderResumePdfHtml(model, "data:image/png;base64,dGVzdA==")).toContain('class="resume-paper-header has-photo"');
    model.profile.hiddenFields = ["photo", "email"];
    model.profile.email = "hidden@example.com";
    const html = renderResumePdfHtml(model, "data:image/png;base64,dGVzdA==");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("hidden@example.com");
  });

  it("keeps long profile values intact and escapes markup", () => {
    const model = modelWithBoldText();
    const address = `${"long-email-".repeat(18)}@example.com`;
    model.profile.email = address;
    model.profile.customFields = [{ id: "custom", label: "说明", value: "<script>alert(1)</script>" }];
    const html = renderResumePdfHtml(model);
    expect(html).toContain(address);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("renders supported bold markers as strong elements without leaking markers", () => {
    const html = renderResumePdfHtml(modelWithBoldText());
    expect(html).toContain("<strong>需求分析</strong>");
    expect(html).toContain("<strong>跨团队协作</strong>");
    expect(html).not.toContain("**需求分析**");
  });

  it("uses the versioned reference layout and renders education school before major and degree", () => {
    const model = modelWithBoldText();
    model.profile.skills = ["SQL"];
    const education = {
      id: "education-entry", sourceMaterialItemId: "education-material", sourceVersionId: "education-version",
      sourceMaterialName: "示例大学", sourceVersionName: "样例", sourceCategory: "education" as const, sourceVersionRevision: 1,
      lastSynced: { heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "2023—2026", location: "", summary: "", bullets: [], links: [] },
      current: { heading: "社会学", organization: "示例大学", role: "硕士 · 社会学", period: "2023—2026", location: "", summary: "", bullets: [], links: [] }
    };
    model.pages[0]!.sections.unshift({ id: "education", title: "教育经历", kind: "material", text: "", entries: [education] });
    model.pages[0]!.sections.push({ id: "profile-skills", title: "专业技能", kind: "freeText", text: "SQL", entries: [] });
    const html = renderResumePdfHtml(model);
    expect(html).toContain("resume-template-v2");
    expect(html).toContain("<strong>示例大学</strong><span>社会学 硕士</span>");
    expect(html.indexOf("<strong>示例大学</strong>")).toBeLessThan(html.indexOf("<h2>专业技能</h2>"));
  });

  it("keeps the requested entry order for saved version-one projects", () => {
    const model = modelWithBoldText();
    model.style.templateVersion = 1;
    model.profile.phone = "13800000000";
    model.profile.email = "example@example.com";
    model.profile.city = "杭州";
    const project = model.pages[0]!.sections[0]!.entries[0]!;
    project.current = { ...project.current, heading: "增长项目", organization: "示例公司", role: "产品经理" };
    model.pages[0]!.sections.push({ id: "education", title: "教育经历", kind: "material", text: "", entries: [{ ...project, id: "education-entry", sourceCategory: "education", current: { ...project.current, heading: "社会学", organization: "示例大学", role: "硕士" } }] });
    const html = renderResumePdfHtml(model);
    expect(html.indexOf("13800000000")).toBeLessThan(html.indexOf("求职意向：产品经理"));
    expect(html.indexOf("示例公司")).toBeLessThan(html.indexOf("增长项目"));
    expect(html.indexOf("示例公司")).toBeLessThan(html.indexOf("<span>产品经理</span>"));
    expect(html.indexOf("示例大学")).toBeLessThan(html.indexOf("社会学"));
  });
});
