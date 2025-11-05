import { callTool as callMcpTool, listTools as listMcpTools, McpClientError } from '@mcp-chatbot-demo/mcp-client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parse as parseCookie } from 'cookie';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JWT_COOKIE_NAME: string;
  ALLOWED_ORIGIN: string;
}

interface AuthenticatedUser {
  userId: string;
  username: string | null;
}

interface RegisterRequestBody {
  username?: string;
  email?: string;
  password?: string;
}

interface LoginRequestBody {
  usernameOrEmail?: string;
  password?: string;
}

type TransportKind = 'http' | 'sse';

interface ServerPayload {
  url?: string;
  transport?: TransportKind;
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
}

interface ChatRequestBody {
  message?: string;
  maybeTool?: string | null;
  server?: ServerPayload;
}

interface ListToolsRequestBody {
  server?: ServerPayload;
}

interface CallToolRequestBody {
  server?: ServerPayload;
  name?: string;
  args?: Record<string, unknown>;
}

type JsonRecord = Record<string, unknown>;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }

    const url = new URL(request.url);

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return jsonResponse(env, { ok: true });
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/register') {
        return await handleRegister(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/login') {
        return await handleLogin(request, env);
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
        return jsonResponse(env, { ok: true }, 200, {
          'Set-Cookie': clearSessionCookie(env.JWT_COOKIE_NAME ?? 'mcp_demo_session'),
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/me') {
        const user = await requireUser(request, env);
        if (!user) {
          return jsonResponse(env, errorPayload('auth_failed', 'Authentication required'), 401);
        }
        return jsonResponse(env, { userId: user.userId, username: user.username });
      }

      if (request.method === 'POST' && url.pathname === '/api/mcp/list') {
        const user = await requireUser(request, env);
        if (!user) {
          return jsonResponse(env, errorPayload('auth_failed', 'Authentication required'), 401);
        }

        const payload = await safeJson<ListToolsRequestBody>(request);
        if (!payload?.server) {
          return jsonResponse(env, errorPayload('validation_failed', 'Server configuration is required'), 400);
        }

        const server = normaliseServer(payload.server);
        if (!server) {
          return jsonResponse(env, errorPayload('validation_failed', 'Invalid server configuration'), 400);
        }

        try {
          const tools = await listMcpTools(server);
          return jsonResponse(env, tools);
        } catch (error) {
          return jsonResponse(env, errorPayload('mcp_unreachable', asErrorMessage(error, 'Failed to list tools')), 502);
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/mcp/call') {
        const user = await requireUser(request, env);
        if (!user) {
          return jsonResponse(env, errorPayload('auth_failed', 'Authentication required'), 401);
        }

        const payload = await safeJson<CallToolRequestBody>(request);
        if (!payload?.server || !payload.name) {
          return jsonResponse(env, errorPayload('validation_failed', 'Tool name and server are required'), 400);
        }

        const server = normaliseServer(payload.server);
        if (!server) {
          return jsonResponse(env, errorPayload('validation_failed', 'Invalid server configuration'), 400);
        }

        try {
          const result = await callMcpTool({
            ...server,
            name: payload.name,
            args: payload.args ?? {},
          });
          return jsonResponse(env, { result });
        } catch (error) {
          return jsonResponse(env, errorPayload('mcp_unreachable', asErrorMessage(error, 'Failed to call MCP tool')), 502);
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const user = await requireUser(request, env);
        if (!user) {
          return jsonResponse(env, errorPayload('auth_failed', 'Authentication required'), 401);
        }

        const payload = await safeJson<ChatRequestBody>(request);
        if (!payload?.message || !payload.server) {
          return jsonResponse(env, errorPayload('validation_failed', 'Message and server are required'), 400);
        }

        const server = normaliseServer(payload.server);
        if (!server) {
          return jsonResponse(env, errorPayload('validation_failed', 'Invalid server configuration'), 400);
        }

        if (payload.maybeTool) {
          const parsed = parseToolCommand(payload.maybeTool);
          if (!parsed) {
            return jsonResponse(env, errorPayload('validation_failed', 'Unable to parse tool command.'), 400);
          }

          try {
            const toolResult = await callMcpTool({
              ...server,
              name: parsed.name,
              args: parsed.args,
            });

            return jsonResponse(
              env,
              {
                reply: {
                  role: 'assistant',
                  content: `Tool \`${parsed.name}\` executed.`,
                },
                toolResult,
              },
            );
          } catch (error) {
            const code = error instanceof McpClientError ? 'mcp_error' : 'mcp_unreachable';
            const status = code === 'mcp_error' ? 400 : 502;
            return jsonResponse(env, errorPayload(code, asErrorMessage(error, 'Tool execution failed')), status);
          }
        }

        const trimmed = payload.message.trim();
        const responseText = buildTemplateReply(user.username, trimmed);

        return jsonResponse(env, {
          reply: {
            role: 'assistant',
            content: responseText,
          },
        });
      }

      return jsonResponse(env, errorPayload('not_found', 'Route not found'), 404);
    } catch (error) {
      if (error instanceof HttpError) {
        return jsonResponse(env, error.payload, error.status);
      }
      return jsonResponse(env, errorPayload('internal_error', asErrorMessage(error, 'Internal server error')), 500);
    }
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<RegisterRequestBody>(request);
  if (!payload?.username || !payload.email || !payload.password) {
    throw new HttpError(400, errorPayload('validation_failed', 'Username, email, and password are required.'));
  }

  const username = payload.username.trim();
  const email = payload.email.trim().toLowerCase();
  const password = payload.password.trim();

  if (!username || !email || !password) {
    throw new HttpError(400, errorPayload('validation_failed', 'All fields are required.'));
  }

  const supabase = createSupabase(env);

  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('username', username)
    .maybeSingle();

  if (profileError) {
    throw new HttpError(500, errorPayload('supabase_error', 'Failed to validate username uniqueness.'));
  }

  if (existingProfile) {
    throw new HttpError(409, errorPayload('conflict', 'Username already taken.'));
  }

  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !createdUser.user) {
    throw new HttpError(502, errorPayload('supabase_error', createError?.message ?? 'Failed to register user.'));
  }

  const { error: profileInsertError } = await supabase.from('profiles').insert({
    user_id: createdUser.user.id,
    username,
  });

  if (profileInsertError) {
    throw new HttpError(502, errorPayload('supabase_error', 'Failed to create user profile.'));
  }

  const loginResult = await supabase.auth.signInWithPassword({ email, password });
  if (loginResult.error || !loginResult.data.session) {
    throw new HttpError(502, errorPayload('auth_failed', 'Registered but automatic login failed, please login manually.'));
  }

  const cookieName = env.JWT_COOKIE_NAME ?? 'mcp_demo_session';
  return jsonResponse(
    env,
    { ok: true },
    201,
    {
      'Set-Cookie': attachSessionCookie(cookieName, loginResult.data.session.access_token),
    },
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const payload = await safeJson<LoginRequestBody>(request);
  if (!payload?.usernameOrEmail || !payload.password) {
    throw new HttpError(400, errorPayload('validation_failed', 'Username/email and password are required.'));
  }

  const identifier = payload.usernameOrEmail.trim();
  const password = payload.password.trim();

  if (!identifier || !password) {
    throw new HttpError(400, errorPayload('validation_failed', 'Username/email and password are required.'));
  }

  const supabase = createSupabase(env);
  let email = identifier.toLowerCase();
  let username: string | null = null;

  if (!identifier.includes('@')) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, username')
      .eq('username', identifier)
      .maybeSingle();

    if (profileError) {
      throw new HttpError(500, errorPayload('supabase_error', 'Failed to resolve username.'));
    }

    if (!profile?.user_id) {
      throw new HttpError(401, errorPayload('auth_failed', 'Invalid credentials.'));
    }

    username = profile.username ?? identifier;
    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(profile.user_id);
    if (userError || !userData.user?.email) {
      throw new HttpError(500, errorPayload('supabase_error', 'Failed to resolve account email.'));
    }
    email = userData.user.email.toLowerCase();
  } else {
    email = identifier.toLowerCase();
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session || !signInData.user) {
    throw new HttpError(401, errorPayload('auth_failed', 'Invalid credentials.'));
  }

  if (!username) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username')
      .eq('user_id', signInData.user.id)
      .maybeSingle();

    if (!profileError) {
      username = profile?.username ?? null;
    }
  }

  const cookieName = env.JWT_COOKIE_NAME ?? 'mcp_demo_session';
  return jsonResponse(
    env,
    { ok: true },
    200,
    {
      'Set-Cookie': attachSessionCookie(cookieName, signInData.session.access_token),
    },
  );
}

function createSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const cookieName = env.JWT_COOKIE_NAME ?? 'mcp_demo_session';
  const cookies = parseCookie(request.headers.get('Cookie') ?? '');
  const accessToken = cookies[cookieName];

  if (!accessToken) {
    return null;
  }

  const supabase = createSupabase(env);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user?.id) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('username')
    .eq('user_id', data.user.id)
    .maybeSingle();

  if (profileError) {
    return { userId: data.user.id, username: null };
  }

  return { userId: data.user.id, username: profile?.username ?? null };
}

function parseToolCommand(raw: string): { name: string; args: Record<string, unknown> } | null {
  const text = raw.trim();
  if (!text.startsWith('/')) {
    return null;
  }

  const firstSpace = text.indexOf(' ');
  const name = (firstSpace === -1 ? text.slice(1) : text.slice(1, firstSpace)).trim();
  if (!name) {
    return null;
  }

  const argsText = firstSpace === -1 ? '{}' : text.slice(firstSpace + 1).trim();
  try {
    const parsed = argsText ? JSON.parse(argsText) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { name, args: parsed as Record<string, unknown> };
    }
    return null;
  } catch {
    return null;
  }
}

function buildTemplateReply(username: string | null, message: string): string {
  const greeting = username ? `Hi ${username}!` : 'Hi there!';
  return `${greeting} You said: "${message}". Try prefixing a message with /toolName {"foo":"bar"} to run an MCP tool.`;
}

async function safeJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.clone().json()) as T;
  } catch {
    return null;
  }
}

function normaliseServer(payload: ServerPayload): {
  url: string;
  transport: TransportKind;
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
} | null {
  if (!payload?.url || !payload?.transport) {
    return null;
  }

  const url = payload.url.trim();
  let transport: TransportKind;
  if (payload.transport === 'http' || payload.transport === 'sse') {
    transport = payload.transport;
  } else {
    return null;
  }

  try {
    new URL(url);
  } catch {
    return null;
  }

  const headers = payload.headers && typeof payload.headers === 'object' ? payload.headers : undefined;
  const handshakeUrl =
    payload.handshakeUrl && payload.handshakeUrl.trim() ? payload.handshakeUrl.trim() : undefined;

  return {
    url,
    transport,
    headers,
    handshakeUrl,
    timeoutMs: payload.timeoutMs,
  };
}

function attachSessionCookie(name: string, token: string, maxAgeSec = 60 * 60 * 24 * 7): string {
  return `${name}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None`;
}

function clearSessionCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
}

function cors(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    Vary: 'Origin',
  };
}

function jsonResponse(
  env: Env,
  body: JsonRecord,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      ...cors(env),
      ...(extraHeaders ?? {}),
    },
  });
}

function errorPayload(code: string, message: string): JsonRecord {
  return { error: { code, message } };
}

class HttpError extends Error {
  constructor(public readonly status: number, public readonly payload: JsonRecord) {
    super(typeof payload?.error === 'object' ? String(payload.error?.message ?? 'HTTP Error') : 'HTTP Error');
  }
}

function asErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    return typeof error.payload?.error === 'object'
      ? String(error.payload.error?.message ?? fallback)
      : fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}
