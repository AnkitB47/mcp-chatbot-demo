const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed with status ${response.status}`;
    let code: string | undefined;

    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) {
        if (typeof parsed.error === 'string') {
          message = parsed.error;
        } else {
          if (typeof parsed.error.message === 'string') {
            message = parsed.error.message;
          }
          if (typeof parsed.error.code === 'string') {
            code = parsed.error.code;
          }
        }
      }
    } catch {
      // Ignore JSON parse issues for error bodies.
    }

    throw new ApiError(response.status, message, code);
  }

  return response;
}

export interface SessionResponse {
  userId: string;
  email: string;
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

export interface ListToolsApiResponse {
  tools: ToolDefinition[];
  warnings?: string[];
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
  getSession: async () => {
    const res = await apiFetch('/api/me');
    return (await res.json()) as SessionResponse;
  },

  register: async (body: { username: string; email: string; password: string }) => {
    const res = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; userId: string };
  },

  login: async (body: { usernameOrEmail: string; password: string }) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean };
  },

  logout: async () => {
    const res = await apiFetch('/api/auth/logout', {
      method: 'POST',
    });
    return (await res.json()) as { ok: boolean };
  },

  listTools: async (server: ServerConfigPayload) => {
    const res = await apiFetch('/api/mcp/list', {
      method: 'POST',
      body: JSON.stringify({ server }),
    });
    return (await res.json()) as ListToolsApiResponse;
  },

  sendChat: async (payload: { message: string; maybeTool?: string | null; server: ServerConfigPayload }) => {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return (await res.json()) as ChatResponse;
  },
};
