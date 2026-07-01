const DEFAULT_API_BASE_URL = 'http://localhost:8000/api';
const DEFAULT_FASTAPI_URL = 'http://localhost:8000';
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '');
export const FASTAPI_BASE_URL = (import.meta.env.VITE_FASTAPI_BASE_URL || DEFAULT_FASTAPI_URL).replace(/\/$/, '');

function resolveOriginFromApiBase(apiBase: string): string {
  const noTrailing = apiBase.replace(/\/$/, '');
  return noTrailing.replace(/\/api$/, '');
}

export const BACKEND_ORIGIN = resolveOriginFromApiBase(API_BASE_URL);
export const WS_BASE_URL = BACKEND_ORIGIN.replace(/^http/, 'ws');

function buildFastApiUrl(path: string): string {
  return `${FASTAPI_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function buildWsUrl(path: string): string {
  return `${WS_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
};

let refreshRequest: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const url = buildApiUrl(path);

  const response = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && retry && path !== '/auth/login' && path !== '/auth/refresh') {
    if (await refreshSession()) return apiRequest<T>(path, options, false);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let data: unknown = text;
  if (contentType.includes('application/json') && text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      ? String((data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `Request failed (${response.status})`)
      : text || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

export async function fastApiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const url = buildFastApiUrl(path);

  const response = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'include',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let data: unknown = text;
  if (contentType.includes('application/json') && text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    const message = typeof data === 'object' && data !== null
      ? String((data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `Request failed (${response.status})`)
      : text || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

type BackendAuthPayload = { email: string; password: string };

export async function backendLogin<T = unknown>({ email, password }: BackendAuthPayload): Promise<T> {
  return fastApiRequest<T>('/auth/login', { method: 'POST', body: { email, password } });
}

export async function backendRegister<T = unknown>({ email, password }: BackendAuthPayload): Promise<T> {
  return fastApiRequest<T>('/auth/register', {
    method: 'POST',
    body: { email, password, full_name: email.split('@')[0] || email, role: 'developer' },
  });
}

export async function backendMe<T = unknown>(): Promise<T> {
  return fastApiRequest<T>('/auth/me');
}

export async function backendLogout<T = unknown>(): Promise<T> {
  return fastApiRequest<T>('/auth/logout', { method: 'POST' });
}
