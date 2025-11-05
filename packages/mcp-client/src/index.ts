/* eslint-disable @typescript-eslint/no-explicit-any */

export type McpTransportKind = 'http' | 'sse';

export interface McpServerConfig {
  url: string;
  transport: McpTransportKind;
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
}

export interface CallToolArgs extends McpServerConfig {
  name: string;
  args: Record<string, unknown>;
}

export interface CallToolResponse {
  result: unknown;
}

export interface ToolDescriptor {
  name: string;
  description?: string;
}

export interface ListToolsSuccess {
  ok: true;
  tools: ToolDescriptor[];
  warnings?: string[];
}

export interface ListToolsFailure {
  ok: false;
  status?: number;
  message: string;
  warnings?: string[];
}

export type ListToolsResponse = ListToolsSuccess | ListToolsFailure;

class McpClientError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'McpClientError';
  }
}

class HttpStatusError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

type RpcPayload = { jsonrpc: '2.0'; id: string; method: string; params?: any };

interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface RpcOptions {
  warnings?: string[];
}

interface HttpRequestConfig {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  handshakeUrl?: string;
}

interface SseRequestConfig {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const NON_FATAL_HANDSHAKE_STATUSES = new Set([404, 405, 501]);
const POST_FALLBACK_STATUSES = new Set([405, 406]);

export async function listTools(config: McpServerConfig): Promise<ListToolsResponse> {
  const warnings: string[] = [];
  const payload = createRpcPayload('tools/list', {});

  try {
    const response = await sendRpc(config, payload, { warnings });
    const tools = Array.isArray(response.result?.tools) ? response.result.tools : [];
    return {
      ok: true,
      tools: tools.map(normaliseTool),
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tools';
    const status = error instanceof HttpStatusError ? error.status : undefined;
    return {
      ok: false,
      status,
      message,
      warnings: warnings.length ? warnings : undefined,
    };
  }
}

export async function callTool(config: CallToolArgs): Promise<CallToolResponse> {
  const payload = createRpcPayload('tools/call', {
    name: config.name,
    arguments: config.args ?? {},
  });

  const response = await sendRpc(config, payload);
  if (response.error) {
    const message = response.error.message ?? 'MCP tool returned an error';
    throw new McpClientError(message, 'mcp_error');
  }

  return { result: response.result };
}

function normaliseTool(raw: any): ToolDescriptor {
  const name = typeof raw?.name === 'string' ? raw.name : 'unknown_tool';
  const description = typeof raw?.description === 'string' ? raw.description : undefined;
  return { name, description };
}

async function sendRpc(config: McpServerConfig | CallToolArgs, payload: RpcPayload, options?: RpcOptions): Promise<RpcResponse> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = { ...(config.headers ?? {}) };

  if (config.transport === 'http') {
    return sendViaHttp(
      {
        url: config.url,
        headers,
        timeoutMs,
        handshakeUrl: config.handshakeUrl,
      },
      payload,
      options,
    );
  }

  return sendViaSse(
    {
      url: config.url,
      headers,
      timeoutMs,
    },
    payload,
  );
}

async function sendViaHttp(config: HttpRequestConfig, payload: RpcPayload, options?: RpcOptions): Promise<RpcResponse> {
  const warnings = options?.warnings;
  const warn = (message: string) => {
    if (warnings && !warnings.includes(message)) {
      warnings.push(message);
    }
    console.warn(`[mcp-client] ${message}`);
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...config.headers,
  };

  const attemptInitialize = async (targetUrl: string | undefined, label: string) => {
    // Some servers skip initialize/handshake entirely; collect warnings and continue.
    if (!targetUrl) {
      return;
    }

    const initPayload = createRpcPayload('initialize', {});
    try {
      await postJsonRpc(targetUrl, initPayload, headers, config.timeoutMs, true);
    } catch (error) {
      if (error instanceof HttpStatusError && NON_FATAL_HANDSHAKE_STATUSES.has(error.status)) {
        warn(`${label} at ${targetUrl} returned status ${error.status}; continuing without handshake.`);
        return;
      }

      const message = error instanceof Error ? error.message : 'Handshake failed.';
      warn(`${label} at ${targetUrl} failed (${message}); continuing without handshake.`);
    }
  };

  await attemptInitialize(config.handshakeUrl, 'Handshake endpoint');
  await attemptInitialize(config.url, 'Initialize endpoint');

  const response = await postJsonRpc(config.url, payload, headers, config.timeoutMs, true);
  validateRpcResponse(response);
  return response;
}

async function postJsonRpc(
  url: string,
  payload: RpcPayload,
  headers: Record<string, string>,
  timeoutMs: number,
  allowFallback = false,
): Promise<RpcResponse> {
  try {
    return await corePost(url, payload, headers, timeoutMs);
  } catch (error) {
    if (allowFallback && error instanceof HttpStatusError && POST_FALLBACK_STATUSES.has(error.status)) {
      // Retry without the Accept header for servers that only accept bare JSON POSTs.
      const fallbackHeaders: Record<string, string> = { ...headers };
      delete fallbackHeaders.Accept;
      return corePost(url, payload, fallbackHeaders, timeoutMs);
    }
    throw error;
  }
}

async function corePost(
  url: string,
  payload: RpcPayload,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RpcResponse> {
  let response: Response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      }),
      timeoutMs,
      'http_timeout',
    );
  } catch (error) {
    if (error instanceof McpClientError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new McpClientError(message, 'network_error');
  }

  if (!response.ok) {
    let body = '';
    try {
      body = await response.text();
    } catch {
      body = '';
    }
    throw new HttpStatusError(`HTTP ${response.status} at ${url}`, response.status, body);
  }

  const raw = await response.text();
  if (!raw.trim()) {
    return { jsonrpc: '2.0', id: payload.id };
  }

  try {
    return JSON.parse(raw) as RpcResponse;
  } catch {
    throw new McpClientError('Failed to parse JSON-RPC response', 'invalid_json');
  }
}

async function sendViaSse(config: SseRequestConfig, payload: RpcPayload): Promise<RpcResponse> {
  const controller = new AbortController();
  const response = await withTimeout(
    fetch(config.url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...config.headers,
      },
      signal: controller.signal,
    }),
    config.timeoutMs,
    'sse_connection_timeout',
  );

  if (!response.ok || !response.body) {
    controller.abort();
    throw new McpClientError(
      `SSE connection failed with status ${response.status}. Try switching to the HTTP transport.`,
      'sse_connection_failed',
    );
  }

  const stream = new SseStream(response.body.getReader());

  try {
    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    };

    await corePost(config.url, payload, postHeaders, config.timeoutMs);
    const messageEvent = await stream.waitForMessage(payload.id, config.timeoutMs);

    if (!messageEvent) {
      throw new McpClientError('No SSE message received in time.', 'no_response');
    }

    const parsed = safelyParseJson(messageEvent.data);
    if (!parsed) {
      throw new McpClientError('Failed to parse SSE payload.', 'invalid_json');
    }

    if (parsed.error) {
      const message = parsed.error?.message ?? 'MCP error response';
      throw new McpClientError(message, 'mcp_error');
    }

    const rpc = parsed as RpcResponse;
    validateRpcResponse(rpc);
    return rpc;
  } finally {
    await stream.close().catch(() => undefined);
    controller.abort();
  }
}

function validateRpcResponse(response: RpcResponse): void {
  if (response.jsonrpc !== '2.0') {
    throw new McpClientError('Invalid JSON-RPC version', 'invalid_json');
  }
  if (response.error) {
    const message = response.error.message ?? 'JSON-RPC error';
    throw new McpClientError(message, 'mcp_error');
  }
}

class SseStream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  async waitForMessage(id: string, timeoutMs: number): Promise<SseEvent | null> {
    return this.waitFor((event) => {
      if (event.event !== 'message') {
        return false;
      }
      const payload = safelyParseJson(event.data);
      return payload?.id === id;
    }, timeoutMs);
  }

  async close(): Promise<void> {
    await this.reader.cancel();
  }

  private async waitFor(predicate: (event: SseEvent) => boolean, timeoutMs: number): Promise<SseEvent | null> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return null;
      }

      let next: SseEvent | null = null;
      try {
        next = await withTimeout(this.nextEvent(), remaining, 'sse_timeout');
      } catch {
        return null;
      }

      if (!next) {
        return null;
      }

      if (predicate(next)) {
        return next;
      }
    }
  }

  private async nextEvent(): Promise<SseEvent | null> {
    while (true) {
      const separatorIndex = this.buffer.indexOf('\n\n');
      if (separatorIndex !== -1) {
        const chunk = this.buffer.slice(0, separatorIndex);
        this.buffer = this.buffer.slice(separatorIndex + 2);
        const event = parseSseChunk(chunk);
        if (event) {
          return event;
        }
        continue;
      }

      const { value, done } = await this.reader.read();
      if (done) {
        if (!this.buffer) {
          return null;
        }
        const event = parseSseChunk(this.buffer);
        this.buffer = '';
        return event;
      }

      this.buffer += this.decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    }
  }
}

interface SseEvent {
  event: string;
  data: string;
}

function parseSseChunk(chunk: string): SseEvent | null {
  const lines = chunk.split('\n').map((line) => line.trimEnd());
  let event = 'message';
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      data.push(line.slice(5).trim());
    }
  }

  if (!data.length && !event) {
    return null;
  }

  return { event, data: data.join('\n') };
}

function safelyParseJson(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new McpClientError('Operation timed out', code)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (handle) {
      clearTimeout(handle);
    }
  }
}

function createRpcPayload(method: string, params: any): RpcPayload {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const id =
    cryptoRef && typeof cryptoRef.randomUUID === 'function'
      ? cryptoRef.randomUUID()
      : Math.random().toString(36).slice(2);

  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

export { McpClientError };
