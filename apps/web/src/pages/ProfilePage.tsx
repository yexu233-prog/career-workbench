import { useEffect, useMemo, useState } from "react";
import type { GlobalProfile } from "@career-workbench/domain";
import { repository } from "@career-workbench/database";
import { FormField } from "../components/FormField";
import { SaveIndicator } from "../components/SaveIndicator";
import { useAutosavedDraft } from "../hooks/useAutosavedDraft";
import { useLiveQueryValue } from "../hooks/useLiveQueryValue";
import { storageErrorMessage } from "../services/user-errors";

const newId = () => crypto.randomUUID();

function ProfileEditor({ profile }: { profile: GlobalProfile }) {
  const autosave = useAutosavedDraft(profile, (draft, revision) => repository.updateProfile(draft, revision));
  const photo = useLiveQueryValue(() => repository.getAsset("profile-photo"), []);
  const [photoError, setPhotoError] = useState("");
  const photoUrl = useMemo(() => photo.value ? URL.createObjectURL(photo.value.data) : "", [photo.value]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const update = <K extends keyof GlobalProfile>(key: K, value: GlobalProfile[K]) => {
    autosave.updateDraft((current) => ({ ...current, [key]: value }));
  };

  const selectPhoto = async (file?: File) => {
    if (!file) return;
    setPhotoError("");
    try { await repository.setProfilePhoto(file); }
    catch (error) { setPhotoError(storageErrorMessage(error)); }
  };

  const removePhoto = async () => {
    setPhotoError("");
    try { await repository.removeProfilePhoto(); }
    catch (error) { setPhotoError(storageErrorMessage(error)); }
  };

  return <div className="settings-stack">
    <section className="content-panel editor-section profile-primary-panel">
      <div className="section-heading-row">
        <div><h2>基本资料</h2><p>新建简历项目时会复制这些资料；已有项目不会被自动覆盖。</p></div>
        <SaveIndicator status={autosave.status} errorMessage={autosave.errorMessage} />
      </div>
      <div className="profile-layout">
        <div className="form-grid">
          <FormField label="中文姓名" hint="显示在简历页眉；为空时回退显示英文姓名。"><input value={autosave.draft.chineseName} onChange={(event) => update("chineseName", event.target.value)} /></FormField>
          <FormField label="英文姓名" hint="有内容时与中文姓名一起显示；无中文姓名时作为姓名显示。"><input value={autosave.draft.englishName} onChange={(event) => update("englishName", event.target.value)} /></FormField>
          <FormField label="手机号码" hint="显示在简历页眉联系方式第一行；空值不显示。"><input value={autosave.draft.phone} onChange={(event) => update("phone", event.target.value)} /></FormField>
          <FormField label="电子邮箱" hint="显示在简历页眉联系方式第一行；空值不显示。"><input type="email" value={autosave.draft.email} onChange={(event) => update("email", event.target.value)} /></FormField>
          <FormField label="所在城市" hint="与电话、邮箱一起显示在姓名下方第一行；空值不显示。"><input value={autosave.draft.city} onChange={(event) => update("city", event.target.value)} /></FormField>
          <FormField label="目标方向" hint="仅作默认记录，不直接进入简历；页眉显示简历项目中的“目标岗位”。"><input value={autosave.draft.targetDirection} onChange={(event) => update("targetDirection", event.target.value)} placeholder="例如：B 端产品经理" /></FormField>
          <FormField label="个人简介" hint="有内容且项目未隐藏时，显示为简历中的“个人简介”栏目；空值不显示。" wide><textarea rows={5} value={autosave.draft.summary} onChange={(event) => update("summary", event.target.value)} /></FormField>
          <FormField label="技能" hint="有内容且项目未隐藏时显示为“专业技能”栏目；用逗号分隔多个技能。" wide><input value={autosave.draft.skills.join("，")} onChange={(event) => update("skills", event.target.value.split(/[，,]/).map((value) => value.trim()).filter(Boolean))} placeholder="例如：需求分析，SQL，数据可视化" /></FormField>
        </div>
        <aside className="profile-photo-card">
          <div className="profile-photo-preview">{photoUrl ? <img src={photoUrl} alt="个人照片预览" /> : <span aria-hidden="true">照片</span>}</div>
          <strong>个人照片</strong>
          <p>照片已上传且简历项目未隐藏时显示在右上角；未上传或被隐藏时不占位置。支持 JPG、PNG、WebP，不超过 5MB。</p>
          <label className="secondary-button file-button">{photoUrl ? "更换照片" : "上传照片"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void selectPhoto(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {photoUrl ? <button className="text-button danger-text" type="button" onClick={() => void removePhoto()}>移除照片</button> : null}
          {photoError ? <p className="inline-error">{photoError}</p> : null}
        </aside>
      </div>
      {autosave.errorMessage ? <p className="inline-error">{autosave.errorMessage}</p> : null}
    </section>

    <section className="content-panel editor-section">
      <div className="section-heading-row"><div><h2>个人链接</h2><p>填写有效链接后显示在求职意向下方；空链接不显示，也可在简历项目中隐藏。</p></div><button className="secondary-button" type="button" onClick={() => update("links", [...autosave.draft.links, { id: newId(), label: "", url: "" }])}>添加链接</button></div>
      {autosave.draft.links.length === 0 ? <p className="muted-empty">尚未添加链接。</p> : <div className="repeatable-list">{autosave.draft.links.map((link, index) => <div className="repeatable-row" key={link.id}>
        <input aria-label={`第 ${index + 1} 个链接名称`} value={link.label} placeholder="名称，如：作品集" onChange={(event) => update("links", autosave.draft.links.map((item) => item.id === link.id ? { ...item, label: event.target.value } : item))} />
        <input aria-label={`第 ${index + 1} 个链接地址`} value={link.url} placeholder="https://" onChange={(event) => update("links", autosave.draft.links.map((item) => item.id === link.id ? { ...item, url: event.target.value } : item))} />
        <button className="icon-button danger-text" type="button" aria-label={`删除第 ${index + 1} 个链接`} onClick={() => update("links", autosave.draft.links.filter((item) => item.id !== link.id))}>删除</button>
      </div>)}</div>}
    </section>

    <section className="content-panel editor-section">
      <div className="section-heading-row"><div><h2>自定义信息</h2><p>填写内容后显示在求职意向下方；空值不显示，也可在简历项目中隐藏。</p></div><button className="secondary-button" type="button" onClick={() => update("customFields", [...autosave.draft.customFields, { id: newId(), label: "", value: "" }])}>添加字段</button></div>
      {autosave.draft.customFields.length === 0 ? <p className="muted-empty">尚未添加自定义信息。</p> : <div className="repeatable-list">{autosave.draft.customFields.map((field, index) => <div className="repeatable-row" key={field.id}>
        <input aria-label={`第 ${index + 1} 个字段名称`} value={field.label} placeholder="字段名称" onChange={(event) => update("customFields", autosave.draft.customFields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item))} />
        <input aria-label={`第 ${index + 1} 个字段内容`} value={field.value} placeholder="字段内容" onChange={(event) => update("customFields", autosave.draft.customFields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item))} />
        <button className="icon-button danger-text" type="button" aria-label={`删除第 ${index + 1} 个字段`} onClick={() => update("customFields", autosave.draft.customFields.filter((item) => item.id !== field.id))}>删除</button>
      </div>)}</div>}
    </section>
  </div>;
}

export function ProfilePage() {
  const profile = useLiveQueryValue(() => repository.getProfile(), []);
  return <section className="page" aria-labelledby="profile-title">
    <header className="page-header"><div><p className="eyebrow">默认简历资料</p><h1 id="profile-title">个人资料</h1><p className="page-description">集中维护联系方式、简介、技能、链接和个人照片。每份简历项目仍保留自己的独立快照。</p></div></header>
    {profile.loading ? <div className="content-panel loading-panel">正在读取个人资料…</div> : null}
    {profile.error ? <div className="content-panel error-panel">{profile.error.message}</div> : null}
    {profile.value ? <ProfileEditor key={profile.value.id} profile={profile.value} /> : null}
  </section>;
}
