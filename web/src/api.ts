let csrf = '';
let sessionRequest: Promise<void> | undefined;
export function session(): Promise<void> {
  if (!sessionRequest) sessionRequest = (async () => {
    const response = await fetch('/api/session', { headers: { 'X-Quota-Client': '1' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Cannot connect to the local server.');
    csrf = (await response.json()).csrf;
  })().catch(() => { throw new Error('Cannot connect to the local server.'); }).finally(() => { sessionRequest = undefined; });
  return sessionRequest;
}
export async function api<T>(path: string, method = 'GET', body?: unknown, renew = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method, headers: { 'X-Quota-Client': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
  } catch {
    // A mutation might have reached the server. Never retry network failures automatically.
    throw new Error(method === 'GET' ? 'The local server could not be reached.' : 'The save could not be confirmed. Reconnect and check before trying again.');
  }
  // A 401 is rejected before any route mutation; renew once after a restart/session expiry.
  if (response.status === 401 && renew) {
    await session();
    return api<T>(path, method, body, false);
  }
  if (!response.ok) {
    const message = await response.json().catch(() => ({ error: 'The local server could not be reached.' }));
    throw new Error(message.error || 'Request failed.');
  }
  return response.json() as Promise<T>;
}
