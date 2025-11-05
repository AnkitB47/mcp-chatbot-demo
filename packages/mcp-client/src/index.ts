/* eslint-disable @typescript-eslint/no-explicit-any */

export type McpTransportKind = 'http' | 'sse';

export interface McpServerConfig {
  url: string;
  transport: McpTransportKind;
  headers?: Record<string, string>;
  /**
   * Optional explicit SSE endpoint used for session negotiation.
   * When omitted for HTTP transports, a best-effort derivation will be used.
   */
  handshakeUrl?: string;
  /**
   * Optional per-request timeout.
   */
  timeoutMs?: number;
}

export interface ListToolsResponse {
  tools: Array<{ name: string; description?: string }>;
}

export interface CallToolArgs {
  url: string;
  transport: McpTransportKind;
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
  name: string;
  args: Record<string, unknown>;
}

export interface CallToolResponse {
  result: unknown;
}

class McpClientError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'McpClientError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function listTools(config: McpServerConfig): Promise<ListToolsResponse> {
  const payload = createRpcPayload('tools/list', {});
  const response = await sendRpc(config, payload);
  const tools = Array.isArray(response.result?.tools) ? response.result.tools : [];

  return {
    tools: tools.map((tool: any) => ({
      name: typeof tool?.name === 'string' ? tool.name : 'unknown',
      description: typeof tool?.description === 'string' ? tool.description : undefined,
    })),
  };
}

export async function callTool(config: CallToolArgs): Promise<CallToolResponse> {
  const payload = createRpcPayload('tools/call', {
    name: config.name,
    arguments: config.args ?? {},
  });
  const response = await sendRpc(config, payload);
  return { result: response.result };
}

type RpcPayload = { jsonrpc: '2.0'; id: string; method: string; params: any };

interface RpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

async function sendRpc(config: McpServerConfig, payload: RpcPayload): Promise<RpcResponse>;
async function sendRpc(config: CallToolArgs, payload: RpcPayload): Promise<RpcResponse>;
async function sendRpc(config: McpServerConfig | CallToolArgs, payload: RpcPayload): Promise<RpcResponse> {
  const transport = config.transport;

  if (transport === 'http') {
    // Many public MCP servers rely on SSE-backed sessions even when using HTTP JSON-RPC.
    // We fall back to the SSE transport flow to maximise compatibility.
    return sendViaSse(
      {
        url: deriveSseUrl(config),
        headers: config.headers ?? {},
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      payload,
      config.handshakeUrl,
    );
  }

  return sendViaSse(
    {
      url: config.url,
      headers: config.headers ?? {},
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    payload,
    config.handshakeUrl,
  );
}

interface SseRequestConfig {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

async function sendViaSse(config: SseRequestConfig, payload: RpcPayload, explicitHandshakeUrl?: string): Promise<RpcResponse> {
  const handshakeUrl = explicitHandshakeUrl ?? config.url;
  const controller = new AbortController();

  const handshakeResponse = await withTimeout(
    fetch(handshakeUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Mcp-Handshake': '1',
        ...config.headers,
      },
      signal: controller.signal,
    }),
    config.timeoutMs,
    'Handshake timed out',
  );

  if (!handshakeResponse.ok || !handshakeResponse.body) {
    controller.abort();
    throw new McpClientError(`Handshake failed with status ${handshakeResponse.status}`, 'handshake_failed');
  }

  const stream = new SseStream(handshakeResponse.body.getReader());

  try {
    const endpointEvent = await stream.waitForEvent('endpoint', config.timeoutMs);
    if (!endpointEvent?.data) {
      throw new McpClientError('Handshake did not return a post endpoint', 'handshake_failed');
    }

    const postUrl = buildPostUrl(handshakeUrl, endpointEvent.data);
    const sessionId = extractSessionId(endpointEvent.data);

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...config.headers,
    };
    if (sessionId) {
      postHeaders['Mcp-Session-Id'] = sessionId;
    }

    const rpcResponse = await withTimeout(
      fetch(postUrl, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify(payload),
      }),
      config.timeoutMs,
      'RPC request timed out',
    );

    if (!rpcResponse.ok && rpcResponse.status !== 202) {
      throw new McpClientError(`RPC request failed with status ${rpcResponse.status}`, 'rpc_failed');
    }

    const messageEvent = await stream.waitForMessage(payload.id, config.timeoutMs);
    if (!messageEvent) {
      throw new McpClientError('No response message received', 'no_response');
    }

    const parsed = safelyParseJson(messageEvent.data);
    if (!parsed) {
      throw new McpClientError('Failed to parse response payload', 'invalid_json');
    }

    if (parsed.error) {
      throw new McpClientError(parsed.error?.message ?? 'MCP error response', 'mcp_error');
    }

    return parsed;
  } finally {
    await stream.close().catch(() => undefined);
    controller.abort();
  }
}

function deriveSseUrl(config: McpServerConfig | CallToolArgs): string {
  if ('handshakeUrl' in config && config.handshakeUrl) {
    return config.handshakeUrl;
  }

  try {
    const parsed = new URL(config.url);
    if (parsed.pathname.endsWith('/mcp')) {
      parsed.pathname = parsed.pathname.replace(/\/mcp$/, '/sse');
    } else if (!parsed.pathname.endsWith('/sse')) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/sse`;
    }
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    throw new McpClientError('Invalid MCP server URL', 'invalid_url');
  }
}

function createRpcPayload(method: string, params: Record<string, unknown>): RpcPayload {
  return {
    jsonrpc: '2.0',
    id: generateRequestId(),
    method,
    params,
  };
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(16).slice(2);
}

function buildPostUrl(handshakeUrl: string, endpointPath: string): string {
  try {
    const base = new URL(handshakeUrl);
    return new URL(endpointPath, base).toString();
  } catch (error) {
    throw new McpClientError('Invalid post endpoint returned by server', 'invalid_endpoint');
  }
}

function extractSessionId(path: string): string | undefined {
  try {
    const url = new URL(path, 'https://dummy-base');
    return url.searchParams.get('sessionId') ?? undefined;
  } catch {
    return undefined;
  }
}

class SseStream {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  async waitForEvent(eventName: string, timeoutMs: number): Promise<SseEvent | null> {
    return this.waitFor((evt) => evt.event === eventName, timeoutMs);
  }

  async waitForMessage(id: string, timeoutMs: number): Promise<SseEvent | null> {
    return this.waitFor((evt) => {
      if (evt.event !== 'message') {
        return false;
      }

      const payload = safelyParseJson(evt.data);
      return payload?.id === id;
    }, timeoutMs);
  }

  async close(): Promise<void> {
    await this.reader.cancel();
  }

  private async waitFor(predicate: (event: SseEvent) => boolean, timeoutMs: number): Promise<SseEvent | null> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) {
        return null;
      }

      let event: SseEvent | null = null;
      try {
        event = await withTimeout(this.nextEvent(), timeLeft, 'sse_timeout');
      } catch {
        return null;
      }

      if (!event) {
        return null;
      }

      if (predicate(event)) {
        return event;
      }
    }
  }

  private async nextEvent(): Promise<SseEvent | null> {
    while (true) {
      const chunkIndex = this.buffer.indexOf('\n\n');
      if (chunkIndex !== -1) {
        const chunk = this.buffer.slice(0, chunkIndex);
        this.buffer = this.buffer.slice(chunkIndex + 2);
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
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (!dataLines.length && !event) {
    return null;
  }

  return { event, data: dataLines.join('\n') };
}

function safelyParseJson(data: string): any | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new McpClientError(message, 'timeout')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export { McpClientError };
