import { useEffect, useMemo, type CSSProperties } from "react";
import type { ResumeDocumentModel, ResumeEntrySnapshot, ResumeProfileSnapshot } from "@career-workbench/domain";
import { buildResumeProfileHeader, getEducationEntryDisplay, getExperienceEntryDisplay, getResumePhotoDimensions } from "@career-workbench/domain";
import { BoldText } from "./BoldText";

function usePhotoUrl(profile: ResumeProfileSnapshot, disabled = false): string {
  const url = useMemo(() => !disabled && profile.photo ? URL.createObjectURL(profile.photo.data) : "", [disabled, profile.photo]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

function visible(profile: ResumeProfileSnapshot, field: string): boolean {
  return !profile.hiddenFields.includes(field);
}

function ResumeEntryView({ entry, active = false }: { entry: ResumeEntrySnapshot; active?: boolean }) {
  const content = entry.current;
  const education = entry.sourceCategory === "education" ? getEducationEntryDisplay(content) : undefined;
  const experience = entry.sourceCategory === "work" || entry.sourceCategory === "project" ? getExperienceEntryDisplay(content) : undefined;
  return (
    <article className={`resume-paper-entry${active ? " active-preview-entry" : ""}`}>
      {education ? <div className="resume-entry-heading resume-education-heading">
        <div><strong>{education.school || education.major || content.heading}</strong>{education.school && (education.major || education.degree) ? <span>{[education.major, education.degree].filter(Boolean).join(" ")}</span> : null}</div>
        <span>{content.period}</span>
      </div> : experience ? <div className="resume-entry-heading">
        <div><strong>{experience.organization}</strong>{experience.role ? <span>{experience.role}</span> : null}</div>
        <span>{content.period}</span>
      </div> : <div className="resume-entry-heading">
        <div><strong>{content.heading}</strong>{content.organization ? <span>{content.organization}</span> : null}</div>
        <span>{content.period}</span>
      </div>}
      {(education ? content.location : experience ? experience.title || content.location : content.role || content.location) ? <div className="resume-entry-meta"><span>{education ? "" : experience ? experience.title : content.role}</span><span>{content.location}</span></div> : null}
      {content.summary ? <p><BoldText value={content.summary} /></p> : null}
      {content.bullets.some((bullet) => bullet.trim()) ? <ul>{content.bullets.filter((bullet) => bullet.trim()).map((bullet, index) => <li key={index}><BoldText value={bullet} /></li>)}</ul> : null}
      {content.links.some((link) => link.trim()) ? <div className="resume-entry-links">{content.links.filter(Boolean).join(" · ")}</div> : null}
    </article>
  );
}

export function ResumePreview({ model, photoUrlOverride, showPhotoPlaceholder = false, activeEntryId }: { model: ResumeDocumentModel; photoUrlOverride?: string; showPhotoPlaceholder?: boolean; activeEntryId?: string }) {
  const generatedPhotoUrl = usePhotoUrl(model.profile, Boolean(photoUrlOverride));
  const photoUrl = photoUrlOverride ?? generatedPhotoUrl;
  const header = buildResumeProfileHeader(model.profile, model.targetRole);
  const photoDimensions = getResumePhotoDimensions(model.style, header);
  const hasPhoto = Boolean(photoUrl) && visible(model.profile, "photo");
  const referenceTemplate = model.style.templateVersion >= 2;

  return (
    <div className={`resume-pages${referenceTemplate ? " resume-template-v2" : " resume-template-v1"}`} style={{ "--resume-accent": model.style.accentColor, "--resume-font-size": `${model.style.fontSizePt}pt`, "--resume-line-height": model.style.lineHeight, "--resume-margin": `${model.style.marginMm}mm`, "--resume-margin-horizontal": `${model.style.templateVersion >= 2 ? model.style.marginHorizontalMm ?? model.style.marginMm : model.style.marginMm}mm`, "--resume-margin-vertical": `${model.style.templateVersion >= 2 ? model.style.marginVerticalMm ?? model.style.marginMm : model.style.marginMm}mm`, "--resume-photo-width": `${photoDimensions.widthMm}mm`, "--resume-photo-height": `${photoDimensions.heightMm}mm` } as CSSProperties}>
      {model.pages.map((page) => (
        <article className="resume-paper" key={page.number} aria-label={`简历第 ${page.number} 页`}>
          <span className="page-number-label">第 {page.number} 页</span>
          <div className="resume-paper-inner">
            {page.showHeader ? (
              <>
                {showPhotoPlaceholder && !hasPhoto ? <div className="resume-photo-placeholder" aria-label="个人照片位置">个人照片 · {visible(model.profile, "photo") ? "未上传，可在个人资料中添加" : "当前项目已隐藏"}</div> : null}
                <header className={`resume-paper-header${hasPhoto ? " has-photo" : ""}`}>
                  <div className="resume-identity">
                    <h1>{header.name}</h1>
                    {header.primaryContacts.length ? <div className="resume-contact"><div className="resume-contact-row">{header.primaryContacts.map((detail, index) => <span key={index}>{detail}</span>)}</div></div> : null}
                    {header.targetRole ? <p className="resume-target-role">求职意向：{header.targetRole}</p> : null}
                    {header.optionalDetails.length ? <div className="resume-contact"><div className="resume-contact-row">{header.optionalDetails.map((detail, index) => <span key={index}>{detail}</span>)}</div></div> : null}
                  </div>
                  {hasPhoto ? <img src={photoUrl} alt="" /> : null}
                </header>
                {visible(model.profile, "summary") && model.profile.summary.trim() ? <section className="resume-paper-section"><h2>个人简介</h2><p>{model.profile.summary}</p></section> : null}
                {!referenceTemplate && visible(model.profile, "skills") && model.profile.skills.length ? <section className="resume-paper-section"><h2>专业技能</h2><p>{model.profile.skills.join(" · ")}</p></section> : null}
              </>
            ) : null}
            {page.sections.map((section) => (
              <section className="resume-paper-section" key={`${page.number}-${section.id}`}>
                <h2>{section.title}</h2>
                {section.kind === "freeText" ? <p className="resume-free-text">{section.text}</p> : section.entries.map((entry) => <ResumeEntryView key={entry.id} entry={entry} active={entry.id === activeEntryId} />)}
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
