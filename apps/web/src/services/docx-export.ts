import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TabStopType,
  Table,
  TableBorders,
  TableLayoutType,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import {
  buildResumeProfileHeader,
  getEducationEntryDisplay,
  getExperienceEntryDisplay,
  getResumePageMargins,
  getResumePhotoDimensions,
  parseBoldText,
  stripBoldMarkup,
  type ResumeEntrySnapshot,
  type ResumeProject,
} from "@career-workbench/domain";

const ACCENT = (color: string) => color.replace(/^#/, "").toUpperCase();
const font = "Arial";

function textRuns(value: string, color?: string, size?: number): TextRun[] {
  const runs: TextRun[] = [];
  for (const { text, bold } of parseBoldText(value)) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (index > 0) runs.push(new TextRun({ break: 1, font, ...(size ? { size } : {}) }));
      if (line) runs.push(new TextRun({ text: line, bold, ...(color ? { color } : {}), ...(size ? { size } : {}), font }));
    });
  }
  return runs;
}

function paragraph(value: string, referenceTemplate = false): Paragraph {
  return new Paragraph({
    children: textRuns(value),
    spacing: { after: referenceTemplate ? 10 : 90, line: referenceTemplate ? 240 : 276 },
  });
}

function hyperlinkParagraph(label: string, url: string, referenceTemplate = false): Paragraph {
  return new Paragraph({
    children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, style: "Hyperlink", font })] })],
    spacing: { after: referenceTemplate ? 10 : 90, line: referenceTemplate ? 240 : 276 },
  });
}

async function photoBytes(photo: NonNullable<ResumeProject["profile"]["photo"]>): Promise<{ bytes: Uint8Array; type: "jpg" | "png" }> {
  const source = photo.data;
  if (photo.mimeType === "image/jpeg" || photo.mimeType === "image/png") {
    return { bytes: new Uint8Array(await source.arrayBuffer()), type: photo.mimeType === "image/jpeg" ? "jpg" : "png" };
  }
  if (typeof createImageBitmap !== "function") throw new Error("当前浏览器无法转换 WebP 照片；请改用 JPG 或 PNG 后重试");
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("WebP 照片转换失败；请改用 JPG 或 PNG 后重试");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("WebP 照片转换失败；请改用 JPG 或 PNG 后重试")), "image/png"));
    return { bytes: new Uint8Array(await png.arrayBuffer()), type: "png" };
  } finally {
    bitmap.close();
  }
}

function entryParagraphs(entry: ResumeEntrySnapshot, accent: string, templateVersion: 1 | 2): Paragraph[] {
  const content = entry.current;
  const blocks: Paragraph[] = [];
  if (entry.sourceCategory === "education") {
    const education = getEducationEntryDisplay(content);
    const study = [education.major, education.degree].filter(Boolean).join(" ");
    const school = education.school || study || content.heading;
    const headerRuns = [
      new TextRun({ text: stripBoldMarkup(school), bold: true, font, color: "404040" }),
      ...(education.school && study ? [new TextRun({ text: `  ${stripBoldMarkup(study)}`, font, color: "404040" })] : []),
      ...(content.period ? [new TextRun({ text: `\t${content.period}`, font, color: "757575" })] : []),
    ];
    blocks.push(new Paragraph({ children: headerRuns, tabStops: [{ type: TabStopType.RIGHT, position: 9900 }], spacing: { before: 45, after: 10, line: 240 } }));
    if (content.location.trim()) blocks.push(new Paragraph({ children: textRuns(content.location, "757575"), spacing: { after: 20, line: 240 } }));
    if (content.summary.trim()) blocks.push(paragraph(content.summary, true));
    for (const bullet of content.bullets.filter((item) => item.trim())) {
      blocks.push(new Paragraph({ children: textRuns(bullet), bullet: { level: 0 }, indent: { left: 360, hanging: 180 }, spacing: { after: 20, line: 240 } }));
    }
    for (const link of content.links.filter((item) => item.trim())) {
      const match = /^(https?:\/\/\S+)$/i.exec(link.trim());
      blocks.push(match ? hyperlinkParagraph(link.trim(), match[1]!, true) : paragraph(link, true));
    }
    return blocks;
  }
  if (entry.sourceCategory === "work" || entry.sourceCategory === "project") {
    const experience = getExperienceEntryDisplay(content);
    const headingRuns = [
      new TextRun({ text: stripBoldMarkup(experience.organization), bold: true, font, color: accent }),
      ...(experience.role ? [new TextRun({ text: `  ${stripBoldMarkup(experience.role)}`, font, color: "404040" })] : []),
    ];
    blocks.push(new Paragraph({ children: headingRuns, spacing: { before: 110, after: 40 } }));
    if (experience.title) blocks.push(new Paragraph({ children: textRuns(experience.title), spacing: { after: 30 } }));
    const meta = [content.period, content.location].filter(Boolean).join(" · ");
    if (meta) blocks.push(new Paragraph({ children: textRuns(meta), spacing: { after: 60 } }));
    if (content.summary.trim()) blocks.push(paragraph(content.summary, templateVersion >= 2));
    for (const bullet of content.bullets.filter((item) => item.trim())) {
      blocks.push(new Paragraph({ children: textRuns(bullet), bullet: { level: 0 }, indent: { left: 360, hanging: 180 }, spacing: { after: templateVersion >= 2 ? 10 : 45, line: templateVersion >= 2 ? 240 : 276 } }));
    }
    for (const link of content.links.filter((item) => item.trim())) {
      const match = /^(https?:\/\/\S+)$/i.exec(link.trim());
      blocks.push(match ? hyperlinkParagraph(link.trim(), match[1]!, templateVersion >= 2) : paragraph(link, templateVersion >= 2));
    }
    return blocks;
  }
  const heading = [content.heading, content.organization].filter(Boolean).join(" · ");
  if (heading) blocks.push(new Paragraph({ children: [new TextRun({ text: stripBoldMarkup(heading), bold: true, font, color: accent })], spacing: { before: 110, after: 40 } }));
  const meta = [content.role, content.period, content.location].filter(Boolean).join(" · ");
  if (meta) blocks.push(new Paragraph({ children: textRuns(meta), spacing: { after: 60 } }));
  if (content.summary.trim()) blocks.push(paragraph(content.summary, templateVersion >= 2));
  for (const bullet of content.bullets.filter((item) => item.trim())) {
    blocks.push(new Paragraph({ children: textRuns(bullet), bullet: { level: 0 }, indent: { left: 360, hanging: 180 }, spacing: { after: templateVersion >= 2 ? 10 : 45, line: templateVersion >= 2 ? 240 : 276 } }));
  }
  for (const link of content.links.filter((item) => item.trim())) {
    const match = /^(https?:\/\/\S+)$/i.exec(link.trim());
    blocks.push(match ? hyperlinkParagraph(link.trim(), match[1]!, templateVersion >= 2) : paragraph(link, templateVersion >= 2));
  }
  return blocks;
}

/** Build a semantic, editable DOCX. Word lays out pages itself; only explicit module page breaks are retained. */
export async function createResumeDocx(project: ResumeProject): Promise<Blob> {
  const profile = project.profile;
  const hidden = new Set(profile.hiddenFields);
  const accent = ACCENT(project.style.accentColor);
  const header = buildResumeProfileHeader(profile, project.targetRole);
  const margins = getResumePageMargins(project.style);
  const referenceTemplate = project.style.templateVersion >= 2;
  const children: Array<Paragraph | Table> = [];
  const identity: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: header.name, bold: true, size: referenceTemplate ? 52 : 40, color: accent, font })], spacing: referenceTemplate ? { after: 30, line: 240 } : { after: 40 } }),
    ...(header.primaryContacts.length ? [new Paragraph({ children: textRuns(header.primaryContacts.join("　|　"), undefined, referenceTemplate ? 18 : undefined), spacing: referenceTemplate ? { after: 20, line: 240 } : { after: 30 } })] : []),
    ...(header.targetRole ? [new Paragraph({ children: [new TextRun({ text: `求职意向：${header.targetRole}`, bold: true, size: referenceTemplate ? 20 : 24, color: referenceTemplate ? "404040" : accent, font })], spacing: referenceTemplate ? { after: 40, line: 240 } : { after: 70 } })] : []),
    ...(!hidden.has("customFields") && profile.customFields.some((field) => field.value.trim()) ? [new Paragraph({ children: textRuns(profile.customFields.filter((field) => field.value.trim()).map((field) => `${field.label.trim() || "其他"}：${field.value.trim()}`).join("　|　"), undefined, referenceTemplate ? 18 : undefined), spacing: referenceTemplate ? { after: 20, line: 240 } : { after: 30 } })] : []),
  ];
  const profileLinks = !hidden.has("links") ? profile.links.filter((link) => link.url.trim()) : [];
  let visiblePhoto: ImageRun | undefined;
  const photoDimensions = getResumePhotoDimensions(project.style, header);
  if (profile.photo && !hidden.has("photo")) {
    const encoded = await photoBytes(profile.photo);
    visiblePhoto = new ImageRun({ data: encoded.bytes, type: encoded.type, transformation: { width: photoDimensions.widthMm * 96 / 25.4, height: photoDimensions.heightMm * 96 / 25.4 }, altText: { title: "个人照片", description: "简历个人照片", name: "个人照片" } });
  }
  if (visiblePhoto) {
    const tableWidth = referenceTemplate ? Math.round((210 - margins.horizontalMm * 2) * 56.7) : 9350;
    const photoColumnWidth = referenceTemplate ? Math.round((photoDimensions.widthMm + 4) * 56.7) : 1450;
    const identityColumnWidth = tableWidth - photoColumnWidth;
    const photoCell = new TableCell({
      width: { size: photoColumnWidth, type: WidthType.DXA },
      children: [new Paragraph({ children: [visiblePhoto], alignment: AlignmentType.RIGHT })],
    });
    const identityCell = new TableCell({
      width: { size: identityColumnWidth, type: WidthType.DXA },
      children: [...identity, ...profileLinks.map((link) => hyperlinkParagraph(`${link.label.trim() || "链接"}：${link.url.trim()}`, link.url.trim()))],
    });
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      columnWidths: [identityColumnWidth, photoColumnWidth],
      rows: [new TableRow({ children: [identityCell, photoCell] })],
      borders: TableBorders.NONE,
      layout: TableLayoutType.FIXED,
    }));
  } else children.push(...identity, ...profileLinks.map((link) => hyperlinkParagraph(`${link.label.trim() || "链接"}：${link.url.trim()}`, link.url.trim())));

  const section = (title: string, pageBreakBefore = false) => new Paragraph({
    children: [new TextRun({ text: title, bold: true, size: referenceTemplate ? 24 : 23, color: referenceTemplate ? "376092" : accent, font })],
    heading: HeadingLevel.HEADING_2,
    pageBreakBefore,
    keepNext: true,
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: referenceTemplate ? "8EAADB" : accent, space: 4 } },
    spacing: { before: referenceTemplate ? 100 : 180, after: referenceTemplate ? 40 : 90 },
  });

  if (!hidden.has("summary") && profile.summary.trim()) {
    children.push(section("个人简介"), paragraph(profile.summary, referenceTemplate));
  }
  if (!referenceTemplate && !hidden.has("skills") && profile.skills.length) {
    children.push(section("专业技能"), paragraph(profile.skills.join(" · ")));
  }
  for (const module of project.modules.filter((item) => !item.hidden)) {
    const hasContent = module.kind === "freeText" ? Boolean(module.text.trim()) : module.entries.some((entry) =>
      entry.current.heading.trim() || entry.current.summary.trim() || entry.current.bullets.some(Boolean),
    );
    if (!hasContent) continue;
    children.push(section(module.title || "未命名栏目", module.pageBreakBefore));
    if (module.kind === "freeText") {
      children.push(paragraph(module.text, referenceTemplate));
    } else {
      for (const entry of module.entries) children.push(...entryParagraphs(entry, accent, project.style.templateVersion));
    }
  }

  if (referenceTemplate && !hidden.has("skills")) {
    const skills = profile.skills.filter((skill) => skill.trim());
    if (skills.length) children.push(section("专业技能"), paragraph(skills.join(" · "), true));
  }

  const documentFile = new Document({
    title: `${header.name} - ${project.targetRole || "简历"}`,
    creator: "求职工作台",
    description: "由求职工作台在本机生成的可编辑简历",
    styles: { default: { document: { run: { font, size: Math.round(project.style.fontSizePt * 2), color: referenceTemplate ? "404040" : "26302D" }, paragraph: { spacing: { line: Math.round(project.style.lineHeight * 240) } } } } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: Math.round(margins.verticalMm * 56.7), right: Math.round(margins.horizontalMm * 56.7), bottom: Math.round(margins.verticalMm * 56.7), left: Math.round(margins.horizontalMm * 56.7) } } },
      children,
    }],
  });
  return Packer.toBlob(documentFile);
}
