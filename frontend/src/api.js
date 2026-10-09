// Thin wrapper around fetch for the Express API.
async function request(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Cannot reach the backend. Is "npm run dev" running in the backend folder?');
  }
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

export const api = {
  health: () => request('GET', '/health'),
  stages: () => request('GET', '/stages'),
  companies: () => request('GET', '/companies'),
  list: params => request('GET', '/applications?' + new URLSearchParams(params)),
  get: id => request('GET', `/applications/${id}`),
  create: body => request('POST', '/applications', body),
  update: (id, body) => request('PUT', `/applications/${id}`, body),
  setStage: (id, stage) => request('PATCH', `/applications/${id}/stage`, { stage }),
  setViewed: (id, viewed) => request('PATCH', `/applications/${id}/viewed`, { viewed }),
  remove: id => request('DELETE', `/applications/${id}`),
  addInteraction: (id, body) => request('POST', `/applications/${id}/interactions`, body),
  removeInteraction: id => request('DELETE', `/interactions/${id}`),
  removeContact: id => request('DELETE', `/contacts/${id}`),
  lookup: q => request('GET', '/lookup?q=' + encodeURIComponent(q)),
  dashboard: () => request('GET', '/dashboard'),
  schema: () => request('GET', '/schema'),
  sql: sql => request('POST', '/sql', { sql }),
  authStatus: () => request('GET', '/auth/status'),
  logout: () => request('POST', '/auth/logout'),
  gmailSync: () => request('POST', '/gmail/sync'),
  gmailReview: () => request('GET', '/gmail/review'),
  gmailReviewAdd: (id, body) => request('POST', `/gmail/review/${encodeURIComponent(id)}/add`, body),
  gmailReviewDismiss: id => request('POST', `/gmail/review/${encodeURIComponent(id)}/dismiss`),
};
