export const MATERIAL_CATEGORIES = [
  "work",
  "project",
  "education",
  "campus",
  "volunteer",
  "certificate",
  "custom"
] as const;

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];
export type OutputLanguage = "zh-CN" | "en";
export type SaveStatus = "idle" | "saving" | "saved" | "failed" | "conflict";

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  work: "工作",
  project: "项目",
  education: "教育",
  campus: "校园",
  volunteer: "志愿",
  certificate: "证书",
  custom: "自定义"
};

export interface CategoryFieldDefinition {
  key: string;
  label: string;
  type?: "text" | "boolean";
  placeholder?: string;
  resumePlacement?: string;
}

export const CATEGORY_FIELDS: Record<MaterialCategory, readonly CategoryFieldDefinition[]> = {
  work: [
    { key: "company", label: "公司", resumePlacement: "组织或公司" },
    { key: "department", label: "部门" },
    { key: "position", label: "职位", resumePlacement: "条目标题和角色" },
    { key: "employmentType", label: "用工类型", placeholder: "如：全职、实习" },
    { key: "location", label: "地点", resumePlacement: "地点" },
    { key: "startDate", label: "开始时间", placeholder: "如：2024-03", resumePlacement: "时间" },
    { key: "endDate", label: "结束时间", placeholder: "如：2025-06", resumePlacement: "时间" },
    { key: "isCurrent", label: "目前仍在职", type: "boolean" }
  ],
  project: [
    { key: "projectName", label: "项目名称", resumePlacement: "条目标题" },
    { key: "role", label: "项目角色", resumePlacement: "角色" },
    { key: "period", label: "项目周期", resumePlacement: "时间" },
    { key: "url", label: "项目或作品链接" },
    { key: "teamSize", label: "团队规模" }
  ],
  education: [
    { key: "school", label: "学校", resumePlacement: "组织或公司" },
    { key: "degree", label: "学历", resumePlacement: "角色" },
    { key: "major", label: "专业", resumePlacement: "条目标题" },
    { key: "startDate", label: "开始时间", resumePlacement: "时间" },
    { key: "endDate", label: "结束时间", resumePlacement: "时间" },
    { key: "grade", label: "成绩" },
    { key: "honors", label: "荣誉" },
    { key: "courses", label: "主修课程" }
  ],
  campus: [
    { key: "organization", label: "组织或活动", resumePlacement: "组织或公司" },
    { key: "role", label: "担任角色", resumePlacement: "角色" },
    { key: "startDate", label: "开始时间", resumePlacement: "时间" },
    { key: "endDate", label: "结束时间", resumePlacement: "时间" },
    { key: "location", label: "地点", resumePlacement: "地点" }
  ],
  volunteer: [
    { key: "organization", label: "组织", resumePlacement: "组织或公司" },
    { key: "activity", label: "活动名称", resumePlacement: "条目标题" },
    { key: "role", label: "担任角色", resumePlacement: "角色" },
    { key: "serviceTime", label: "服务时间", resumePlacement: "时间" },
    { key: "location", label: "地点", resumePlacement: "地点" }
  ],
  certificate: [
    { key: "certificateName", label: "证书名称", resumePlacement: "条目标题" },
    { key: "issuer", label: "颁发机构", resumePlacement: "组织或公司" },
    { key: "issuedAt", label: "取得时间", resumePlacement: "时间" },
    { key: "expiresAt", label: "有效期" },
    { key: "certificateNumber", label: "证书编号" },
    { key: "verificationUrl", label: "验证链接" }
  ],
  custom: [
    { key: "customTypeName", label: "自定义类型名称" },
    { key: "itemName", label: "条目名称", resumePlacement: "条目标题" },
    { key: "organization", label: "组织", resumePlacement: "组织或公司" },
    { key: "role", label: "角色", resumePlacement: "角色" },
    { key: "period", label: "时间", resumePlacement: "时间" },
    { key: "location", label: "地点", resumePlacement: "地点" },
    { key: "url", label: "链接" }
  ]
};

export interface RevisionedRecord {
  id: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deletedAt?: string;
  trashBatchId?: string;
}

export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

export interface CustomProfileField {
  id: string;
  label: string;
  value: string;
}

export interface GlobalProfile extends RevisionedRecord {
  chineseName: string;
  englishName: string;
  phone: string;
  email: string;
  city: string;
  targetDirection: string;
  summary: string;
  skills: string[];
  links: ProfileLink[];
  customFields: CustomProfileField[];
  photoAssetId?: string;
}

export type MaterialFactValue = string | boolean;

export interface MaterialExperience extends RevisionedRecord {
  name: string;
  content: string;
}

export interface MaterialItem extends RevisionedRecord {
  internalName: string;
  category: MaterialCategory;
  tags: string[];
  skills: string[];
  links: string[];
  factNotes: string;
  facts: Record<string, MaterialFactValue>;
  factRevision: number;
  originalVersionId: string;
  experiences?: MaterialExperience[];
}

export interface MaterialVersion extends RevisionedRecord {
  materialItemId: string;
  name: string;
  isOriginal: boolean;
  language: OutputLanguage;
  summary: string;
  bullets: string[];
  targetRole: string;
  jdText: string;
  emphasis: string;
  tags: string[];
  notes: string;
  creationMethod: "manual" | "ai";
  referenceVersionId?: string;
  sourceFactRevision: number;
  aiGeneratedAt?: string;
  aiModel?: string;
}

export interface InterviewNote extends RevisionedRecord {
  materialVersionId: string;
  content: string;
  basedOnVersionRevision: number;
  aiGeneratedAt?: string;
  aiModel?: string;
}

export interface AssetRecord extends RevisionedRecord {
  kind: "profile-photo";
  name: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
  data: Blob;
}

export type TrashableTable = "materialItems" | "materialVersions" | "interviewNotes" | "resumeProjects" | "materialExperiences";

export interface TrashEntry {
  table: TrashableTable;
  id: string;
  materialItemId?: string;
}

export interface TrashBatch {
  id: string;
  rootType: "material" | "version" | "interviewNote" | "resumeProject" | "experience";
  rootId: string;
  displayName: string;
  deletedAt: string;
  entries: TrashEntry[];
}

export interface MaterialSummary {
  item: MaterialItem;
  organization: string;
  versionCount: number;
  languages: OutputLanguage[];
  reviewPendingVersionCount: number;
  needsReview: boolean;
  versionLinks: Array<{ id: string; name: string }>;
  experienceLinks: Array<{ id: string; name: string }>;
}

export interface MaterialBundle {
  item: MaterialItem;
  versions: MaterialVersion[];
  notes: InterviewNote[];
}

export type ResumeTargetLength = "one" | "two" | "unlimited";
export type ResumeModuleKind = "material" | "freeText";
export type ResumeSourceStatus = "current" | "updated" | "deleted";

export interface BoldTextSegment {
  text: string;
  bold: boolean;
}

export interface BoldTextEditResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function parseBoldText(value: string): BoldTextSegment[] {
  const segments: BoldTextSegment[] = [];
  const append = (text: string, bold: boolean) => {
    if (!text) return;
    const previous = segments[segments.length - 1];
    if (previous?.bold === bold) previous.text += text;
    else segments.push({ text, bold });
  };
  let cursor = 0;
  while (cursor < value.length) {
    const opening = value.indexOf("**", cursor);
    if (opening < 0) { append(value.slice(cursor), false); break; }
    const closing = value.indexOf("**", opening + 2);
    if (closing < 0) { append(value.slice(cursor), false); break; }
    if (closing === opening + 2) {
      append(value.slice(cursor, closing + 2), false);
      cursor = closing + 2;
      continue;
    }
    append(value.slice(cursor, opening), false);
    append(value.slice(opening + 2, closing), true);
    cursor = closing + 2;
  }
  return segments;
}

export function stripBoldMarkup(value: string): string {
  return parseBoldText(value).map((segment) => segment.text).join("");
}

export function toggleBoldMarkup(value: string, selectionStart: number, selectionEnd: number): BoldTextEditResult {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  if (start === end) return { value, selectionStart: start, selectionEnd: end };
  if (value.slice(start, start + 2) === "**" && value.slice(end - 2, end) === "**" && end - start > 4) {
    return { value: `${value.slice(0, start)}${value.slice(start + 2, end - 2)}${value.slice(end)}`, selectionStart: start, selectionEnd: end - 4 };
  }
  if (value.slice(Math.max(0, start - 2), start) === "**" && value.slice(end, end + 2) === "**") {
    return { value: `${value.slice(0, start - 2)}${value.slice(start, end)}${value.slice(end + 2)}`, selectionStart: start - 2, selectionEnd: end - 2 };
  }
  return { value: `${value.slice(0, start)}**${value.slice(start, end)}**${value.slice(end)}`, selectionStart: start + 2, selectionEnd: end + 2 };
}

export interface ResumeProfileSnapshot {
  chineseName: string;
  englishName: string;
  phone: string;
  email: string;
  city: string;
  targetDirection: string;
  summary: string;
  skills: string[];
  links: ProfileLink[];
  customFields: CustomProfileField[];
  hiddenFields: string[];
  photo?: {
    name: string;
    mimeType: AssetRecord["mimeType"];
    data: Blob;
  };
}

export interface ResumeEntryContent {
  heading: string;
  organization: string;
  role: string;
  period: string;
  location: string;
  summary: string;
  bullets: string[];
  links: string[];
}

export interface ResumeEntrySnapshot {
  id: string;
  sourceMaterialItemId: string;
  sourceVersionId: string;
  sourceMaterialName: string;
  sourceVersionName: string;
  sourceCategory: MaterialCategory;
  sourceVersionRevision: number;
  lastSynced: ResumeEntryContent;
  current: ResumeEntryContent;
  aiGeneratedAt?: string;
  aiModel?: string;
}

export type ResumeSyncField = "metadata" | "summary" | "bullets" | "links";

export function syncResumeEntrySnapshot(
  entry: ResumeEntrySnapshot,
  latest: ResumeEntryContent,
  latestRevision: number,
  fields: ReadonlySet<ResumeSyncField>
): ResumeEntrySnapshot {
  const current: ResumeEntryContent = structuredClone(entry.current);
  if (fields.has("metadata")) {
    current.heading = latest.heading;
    current.organization = latest.organization;
    current.role = latest.role;
    current.period = latest.period;
    current.location = latest.location;
  }
  if (fields.has("summary")) current.summary = latest.summary;
  if (fields.has("bullets")) current.bullets = [...latest.bullets];
  if (fields.has("links")) current.links = [...latest.links];
  return {
    ...entry,
    sourceVersionRevision: latestRevision,
    lastSynced: structuredClone(latest),
    current
  };
}

export interface ResumeModule {
  id: string;
  title: string;
  kind: ResumeModuleKind;
  category?: MaterialCategory;
  hidden: boolean;
  entries: ResumeEntrySnapshot[];
  text: string;
  pageBreakBefore: boolean;
}

export interface ResumeStyleSettings {
  templateId: "standard-single-column";
  templateVersion: 1 | 2;
  accentColor: string;
  fontSizePt: number;
  lineHeight: number;
  /** Legacy single margin. Also serves as fallback for v2 margins. */
  marginMm: number;
  /** Version 2 supports the reference template's independent page margins. */
  marginVerticalMm?: number;
  marginHorizontalMm?: number;
}

export interface ResumeProject extends RevisionedRecord {
  name: string;
  targetRole: string;
  language: OutputLanguage;
  targetLength: ResumeTargetLength;
  jdText: string;
  jdOriginalText: string;
  jdSourceName: string;
  jdSourceType?: "empty" | "pasted" | "txt" | "docx" | "pdf";
  jdParsedAt?: string;
  jdWarnings?: string[];
  profile: ResumeProfileSnapshot;
  sourceProfileRevision?: number;
  sourcePhotoRevision?: number;
  modules: ResumeModule[];
  style: ResumeStyleSettings;
  archivedAt?: string;
  lastExportedAt?: string;
}

export interface ResumeProjectSummary {
  project: ResumeProject;
  entryCount: number;
  actualPageCount: number;
  updatedSourceCount: number;
  deletedSourceCount: number;
}

export interface ResumeEntrySourceState {
  entryId: string;
  status: ResumeSourceStatus;
  latestRevision?: number;
  latestContent?: ResumeEntryContent;
}

export interface ResumeProjectBundle {
  project: ResumeProject;
  sourceStates: ResumeEntrySourceState[];
  profileSource: {
    status: "current" | "updated";
    latest: ResumeProfileSnapshot;
    profileRevision: number;
    photoRevision?: number;
  };
}

export interface ResumeDocumentSection {
  id: string;
  title: string;
  kind: ResumeModuleKind;
  text: string;
  entries: ResumeEntrySnapshot[];
}

export interface ResumeDocumentPage {
  number: number;
  showHeader: boolean;
  sections: ResumeDocumentSection[];
  estimatedLines: number;
}

export interface ResumeDocumentModel {
  profile: ResumeProfileSnapshot;
  targetRole: string;
  style: ResumeStyleSettings;
  pages: ResumeDocumentPage[];
  overflowModuleIds: string[];
  missingInformation: string[];
}

export function sanitizeWindowsFilename(value: string): string {
  const sanitized = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "未命名";
}

export function buildResumePdfFilename(project: Pick<ResumeProject, "createdAt" | "profile" | "targetRole">): string {
  const name = project.profile.chineseName.trim() || project.profile.englishName.trim() || "未填写姓名";
  const targetRole = project.targetRole.trim() || "未填写岗位";
  const createdDate = /^\d{4}-\d{2}-\d{2}/.exec(project.createdAt)?.[0] ?? new Date().toISOString().slice(0, 10);
  return `${sanitizeWindowsFilename(name)}-${sanitizeWindowsFilename(targetRole)}-简历-${createdDate}.pdf`;
}

export function buildResumeDocxFilename(project: Pick<ResumeProject, "createdAt" | "profile" | "targetRole">): string {
  return buildResumePdfFilename(project).replace(/\.pdf$/i, ".docx");
}

export const DEFAULT_RESUME_STYLE: ResumeStyleSettings = {
  templateId: "standard-single-column",
  templateVersion: 2,
  accentColor: "#4F81BD",
  fontSizePt: 9.5,
  lineHeight: 1,
  marginMm: 17,
  marginVerticalMm: 13.5,
  marginHorizontalMm: 17
};

export const LEGACY_RESUME_STYLE: ResumeStyleSettings = {
  templateId: "standard-single-column",
  templateVersion: 1,
  accentColor: "#285E55",
  fontSizePt: 10.5,
  lineHeight: 1.45,
  marginMm: 18
};

export function getResumePageMargins(style: ResumeStyleSettings): { verticalMm: number; horizontalMm: number } {
  if (style.templateVersion === 1) return { verticalMm: style.marginMm, horizontalMm: style.marginMm };
  return {
    verticalMm: style.marginVerticalMm ?? style.marginMm,
    horizontalMm: style.marginHorizontalMm ?? style.marginMm
  };
}

export interface ResumePhotoDimensions {
  widthMm: number;
  heightMm: number;
}

export function getResumePhotoDimensions(
  style: ResumeStyleSettings,
  header: Pick<ReturnType<typeof buildResumeProfileHeader>, "name" | "targetRole" | "contactRows">
): ResumePhotoDimensions {
  if (style.templateVersion === 1) return { widthMm: 20, heightMm: 26 };
  const contactLines = header.contactRows.reduce((total, row) => total + Math.max(1, Math.ceil(row.join(" · ").length / 72)), 0);
  const textHeightMm = 10.5 + (header.targetRole ? 4.6 : 0) + contactLines * 3.2 + 2;
  const heightMm = Math.max(26, Math.min(35.72, textHeightMm));
  return { widthMm: heightMm * (25.03 / 35.72), heightMm };
}

export interface EducationEntryDisplay {
  school: string;
  major: string;
  degree: string;
}

/** Keeps older education snapshots readable while presenting school before major and degree. */
export function getEducationEntryDisplay(content: ResumeEntryContent): EducationEntryDisplay {
  const major = content.heading.trim();
  let degree = content.role.trim();
  const legacySuffix = major ? ` · ${major}` : "";
  if (legacySuffix && degree.endsWith(legacySuffix)) degree = degree.slice(0, -legacySuffix.length).trim();
  return { school: content.organization.trim(), major, degree };
}

/** Display only: retain the saved heading while putting the organization before the role. */
export function getExperienceEntryDisplay(content: ResumeEntryContent) {
  const organization = content.organization.trim();
  const heading = content.heading.trim();
  const role = content.role.trim() || (organization ? heading : "");
  return {
    organization: organization || heading,
    role: organization ? role : content.role.trim(),
    title: organization && heading !== role && heading !== organization ? heading : ""
  };
}

function visibleProfileValue(profile: ResumeProfileSnapshot, field: string, value: string): string {
  return profile.hiddenFields.includes(field) ? "" : value.trim();
}

/** The header's visible content is shared by layout estimation and both renderers. */
export function buildResumeProfileHeader(profile: ResumeProfileSnapshot, targetRole: string) {
  const phone = visibleProfileValue(profile, "phone", profile.phone);
  const email = visibleProfileValue(profile, "email", profile.email);
  const city = visibleProfileValue(profile, "city", profile.city);
  const optionalDetails = [
    ...(!profile.hiddenFields.includes("links") ? profile.links
      .filter((link) => link.url.trim())
      .map((link) => `${link.label.trim() || "链接"}：${link.url.trim()}`) : []),
    ...(!profile.hiddenFields.includes("customFields") ? profile.customFields
      .filter((field) => field.value.trim())
      .map((field) => `${field.label.trim() || "其他"}：${field.value.trim()}`) : [])
  ];
  const primaryContacts = [phone, email, city].filter(Boolean);
  const contactRows = [primaryContacts, optionalDetails].filter((row) => row.length > 0);
  const details = contactRows.flat();
  return {
    name: [visibleProfileValue(profile, "chineseName", profile.chineseName), visibleProfileValue(profile, "englishName", profile.englishName)].filter(Boolean).join(" · ") || "未填写姓名",
    targetRole: targetRole.trim(),
    primaryContacts,
    optionalDetails,
    details,
    contactRows,
    hasPhoto: Boolean(profile.photo) && !profile.hiddenFields.includes("photo")
  };
}

function estimateTextLines(value: string, charactersPerLine: number): number {
  const plainText = stripBoldMarkup(value);
  if (!plainText.trim()) return 0;
  return plainText.split(/\r?\n/).reduce((total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

function estimateEntryLines(entry: ResumeEntrySnapshot, charactersPerLine: number): number {
  const content = entry.current;
  return 2
    + estimateTextLines(content.summary, charactersPerLine)
    + content.bullets.reduce((total, bullet) => total + estimateTextLines(bullet, Math.max(12, charactersPerLine - 3)), 0)
    + (content.links.some((link) => link.trim()) ? 1 : 0);
}

export function buildResumeDocumentModel(project: ResumeProject): ResumeDocumentModel {
  const margins = getResumePageMargins(project.style);
  const charactersPerLine = Math.max(24, Math.round(70 * (10.5 / project.style.fontSizePt)));
  const usableHeightMm = 297 - margins.verticalMm * 2;
  const lineHeightMm = project.style.fontSizePt * 0.3528 * project.style.lineHeight;
  const pageCapacity = Math.max(28, Math.floor(usableHeightMm / lineHeightMm));
  const header = buildResumeProfileHeader(project.profile, project.targetRole);
  const photoDimensions = getResumePhotoDimensions(project.style, header);
  const horizontalPhotoGapMm = 14 * 25.4 / 96;
  const headerWidthMm = Math.max(30, 210 - margins.horizontalMm * 2 - (header.hasPhoto ? photoDimensions.widthMm + horizontalPhotoGapMm : 0));
  const isReferenceTemplate = project.style.templateVersion >= 2;
  const nameFontSize = isReferenceTemplate ? 26 : 22;
  const detailFontSize = isReferenceTemplate ? 9 : 8.5;
  const roleFontSize = isReferenceTemplate ? 10 : 10.5;
  const roleLineHeight = isReferenceTemplate ? 1.25 : 1.35;
  const roleSpacingMm = (isReferenceTemplate ? 2 : 3) * 25.4 / 96;
  const contactLineHeight = isReferenceTemplate ? 1.2 : 1.25;
  const headerTextHeightMm = estimateTextLines(header.name, Math.max(4, Math.floor(headerWidthMm / (nameFontSize * 0.3528)))) * nameFontSize * 0.3528 * 1.15
    + (header.targetRole ? estimateTextLines(header.targetRole, Math.max(8, Math.floor(headerWidthMm / (roleFontSize * 0.3528)))) * roleFontSize * 0.3528 * roleLineHeight + roleSpacingMm : 0)
    + (header.contactRows.length ? header.contactRows.reduce((sum, row) => sum + estimateTextLines(row.join("   "), Math.max(8, Math.floor(headerWidthMm / (detailFontSize * 0.3528)))), 0) * detailFontSize * 0.3528 * contactLineHeight : 0)
    + 3 * 25.4 / 96;
  const headerLines = Math.ceil((Math.max(headerTextHeightMm, header.hasPhoto ? photoDimensions.heightMm : 0) + 6 * 25.4 / 96) / lineHeightMm)
    + estimateTextLines(visibleProfileValue(project.profile, "summary", project.profile.summary), charactersPerLine)
    + (!isReferenceTemplate && project.profile.skills.length && !project.profile.hiddenFields.includes("skills") ? 2 : 0);
  const pages: ResumeDocumentPage[] = [{ number: 1, showHeader: true, sections: [], estimatedLines: headerLines }];
  const overflowModuleIds: string[] = [];

  const currentPage = () => pages[pages.length - 1]!;
  const addPage = () => pages.push({ number: pages.length + 1, showHeader: false, sections: [], estimatedLines: 0 });

  for (const module of project.modules.filter((candidate) => !candidate.hidden)) {
    if (module.pageBreakBefore && (currentPage().sections.length > 0 || currentPage().estimatedLines > headerLines)) addPage();
    if (module.kind === "freeText") {
      if (!module.text.trim()) continue;
      const lines = 2 + estimateTextLines(module.text, charactersPerLine);
      if (currentPage().estimatedLines + lines > pageCapacity && currentPage().sections.length > 0) addPage();
      currentPage().sections.push({ id: module.id, title: module.title, kind: module.kind, text: module.text, entries: [] });
      currentPage().estimatedLines += lines;
      if (lines > pageCapacity) overflowModuleIds.push(module.id);
      continue;
    }

    const visibleEntries = module.entries.filter((entry) => entry.current.heading.trim() || entry.current.summary.trim() || entry.current.bullets.some(Boolean));
    if (!visibleEntries.length) continue;
    for (const entry of visibleEntries) {
      const entryLines = estimateEntryLines(entry, charactersPerLine);
      const needsTitle = !currentPage().sections.some((section) => section.id === module.id);
      const requiredLines = entryLines + (needsTitle ? 2 : 0);
      if (currentPage().estimatedLines + requiredLines > pageCapacity && currentPage().sections.length > 0) addPage();
      let section = currentPage().sections.find((candidate) => candidate.id === module.id);
      if (!section) {
        section = { id: module.id, title: module.title, kind: module.kind, text: "", entries: [] };
        currentPage().sections.push(section);
        currentPage().estimatedLines += 2;
      }
      section.entries.push(entry);
      currentPage().estimatedLines += entryLines;
      if (entryLines > pageCapacity) overflowModuleIds.push(module.id);
    }
  }

  const visibleSkills = project.profile.skills.filter((skill) => skill.trim());
  if (isReferenceTemplate && !project.profile.hiddenFields.includes("skills") && visibleSkills.length) {
    const text = visibleSkills.join(" · ");
    const lines = 2 + estimateTextLines(text, charactersPerLine);
    if (currentPage().estimatedLines + lines > pageCapacity && currentPage().sections.length > 0) addPage();
    currentPage().sections.push({ id: "profile-skills", title: "专业技能", kind: "freeText", text, entries: [] });
    currentPage().estimatedLines += lines;
  }

  const missingInformation: string[] = [];
  if (!visibleProfileValue(project.profile, "chineseName", project.profile.chineseName)
    && !visibleProfileValue(project.profile, "englishName", project.profile.englishName)) missingInformation.push("姓名未填写");
  if (!project.targetRole.trim()) missingInformation.push("目标岗位未填写");
  if (!project.modules.some((module) => !module.hidden && (module.text.trim() || module.entries.length))) missingInformation.push("简历正文为空");

  return { profile: project.profile, targetRole: project.targetRole, style: project.style, pages, overflowModuleIds: [...new Set(overflowModuleIds)], missingInformation };
}

export const INTERVIEW_NOTE_OUTLINE = `## 经历背景

## 目标与职责

## 关键行动

## 结果与证据

## 困难与冲突

## 复盘总结

## 可能追问

## 回答提纲

## 自由备注`;
