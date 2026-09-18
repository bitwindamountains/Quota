let csrf = '';
export async function session() {
  const response = await fetch('/api/session', { headers: { 'X-Quota-Client': '1' } });
  if (!response.ok) throw new Error('Cannot connect to the local server.');
  csrf = (await response.json()).csrf;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method, headers: { 'X-Quota-Client': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const message = await response.json().catch(() => ({ error: 'The local server could not be reached.' }));
    throw new Error(message.error || 'Request failed.');
  }
  return response.json() as Promise<T>;
}
