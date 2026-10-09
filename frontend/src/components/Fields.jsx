import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CHANNELS, MODES, PLATFORMS, TYPES } from '../utils.js';

/** Labeled form controls. Uncontrolled with defaultValue, read back with FormData. */
export function Field({ name, label, value, type = 'text', options, blank, area, rows, full, placeholder, required, list }) {
  const id = 'f-' + name;
  const cls = 'fld' + (full ? ' full' : '');
  const v = value ?? '';
  if (options) {
    return (
      <label className={cls} htmlFor={id}><span>{label}</span>
        <select id={id} name={name} defaultValue={String(v)}>
          {blank && <option value="">—</option>}
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }
  if (area) {
    return (
      <label className={cls} htmlFor={id}><span>{label}</span>
        <textarea id={id} name={name} rows={rows} defaultValue={v} />
      </label>
    );
  }
  return (
    <label className={cls} htmlFor={id}><span>{label}</span>
      <input id={id} name={name} type={type} defaultValue={v} placeholder={placeholder} required={required} list={list} />
    </label>
  );
}

export function DetailFields({ d }) {
  const [companies, setCompanies] = useState([]);
  useEffect(() => { api.companies().then(setCompanies).catch(() => {}); }, []);
  return (
    <div className="form">
      <Field name="company" label="Company *" value={d.company} required list="coList" />
      <Field name="title" label="Role / job title *" value={d.title} required />
      <Field name="location" label="Job location" value={d.location} placeholder="Bengaluru" />
      <Field name="work_mode" label="Work mode" value={d.work_mode} options={MODES} blank />
      <Field name="applied_on" label="Applied on *" value={d.applied_on} type="date" required />
      <Field name="platform" label="Applied through" value={d.platform} options={PLATFORMS} />
      <Field name="job_url" label="Job link" value={d.job_url} full placeholder="https://www.linkedin.com/jobs/view/…" />
      <Field name="employment_type" label="Employment type" value={d.employment_type} options={TYPES} blank />
      <Field name="salary_text" label="Salary (as listed)" value={d.salary_text} />
      <Field name="resume_version" label="Résumé version sent" value={d.resume_version} placeholder="DS_resume_v3" />
      <Field name="priority" label="Priority (1–5)" value={d.priority ?? ''} options={['1', '2', '3', '4', '5']} blank />
      <Field name="website" label="Company website" value={d.website} />
      <Field name="city" label="Company city" value={d.city} />
      <Field name="address" label="Company address" value={d.address} full />
      <Field name="review" label="My notes / review" value={d.review} full area />
      <Field name="description" label="Job description (snapshot — postings get taken down)" value={d.description} full area rows={5} />
      <datalist id="coList">{companies.map(c => <option key={c.company_id} value={c.name} />)}</datalist>
    </div>
  );
}

export const formData = form => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v).trim()]));
export { CHANNELS };
