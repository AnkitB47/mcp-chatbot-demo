/* eslint-disable @typescript-eslint/no-explicit-any */
const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  const text = await response.text();
  const data = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : `Request failed with status ${response.status}`;
    const code = typeof data?.error?.code === 'string' ? data.error.code : undefined;
    throw new ApiError(response.status, message, code);
  }

  return data as T;
}

export interface SessionResponse {
  userId: string;
  username: string | null;
}

export interface ServerConfigPayload {
  url: string;
  transport: 'http' | 'sse';
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
}

export interface ToolDefinition {
  name: string;
  description?: string;
}

export interface ChatResponse {
  reply: {
    role: string;
    content: string;
  };
  toolResult?: {
    result: unknown;
  };
}

export const api = {
  getSession: () => apiFetch<SessionResponse>('/api/me'),

  register: (body: { username: string; email: string; password: string }) =>
    apiFetch<SessionResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { usernameOrEmail: string; password: string }) =>
    apiFetch<SessionResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  logout: () =>
    apiFetch<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    }),

  listTools: (server: ServerConfigPayload) =>
    apiFetch<{ tools: ToolDefinition[] }>('/api/mcp/list', {
      method: 'POST',
      body: JSON.stringify({ server }),
    }),

  sendChat: (payload: { message: string; maybeTool?: string | null; server: ServerConfigPayload }) =>
    apiFetch<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
