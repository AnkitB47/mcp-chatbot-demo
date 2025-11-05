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
  warnings?: string[];
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

class HttpStatusError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: string) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

const DEFAULT_TIMEOUT_MS = 20_000;

export async function listTools(config: McpServerConfig): Promise<ListToolsResponse> {
  const payload = createRpcPayload('tools/list', {});
  const warnings: string[] = [];
  const response = await sendRpc(config, payload, { warnings });
  const tools = Array.isArray(response.result?.tools) ? response.result.tools : [];

  return {
    tools: tools.map((tool: any) => ({
      name: typeof tool?.name === 'string' ? tool.name : 'unknown',
      description: typeof tool?.description === 'string' ? tool.description : undefined,
    })),
    warnings: warnings.length ? warnings : undefined,
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

interface RpcRequestOptions {
  warnings?: string[];
}

async function sendRpc(config: McpServerConfig, payload: RpcPayload, options?: RpcRequestOptions): Promise<RpcResponse>;
async function sendRpc(config: CallToolArgs, payload: RpcPayload, options?: RpcRequestOptions): Promise<RpcResponse>;
async function sendRpc(
  config: McpServerConfig | CallToolArgs,
  payload: RpcPayload,
  options?: RpcRequestOptions,
): Promise<RpcResponse> {
  const transport = config.transport;

  if (transport === 'http') {
    return sendViaHttp(
      {
        url: config.url,
        headers: config.headers ?? {},
        timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      },
      payload,
      config.handshakeUrl,
      options?.warnings,
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

interface HttpRequestConfig {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

interface SseRequestConfig {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

async function sendViaHttp(
  config: HttpRequestConfig,
  payload: RpcPayload,
  handshakeUrl?: string,
  warnings?: string[],
): Promise<RpcResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...config.headers,
  };

  const ignoredStatuses = new Set([404, 405, 501]);

  const pushWarning = (message: string) => {
    if (warnings && !warnings.includes(message)) {
      warnings.push(message);
    }
    // eslint-disable-next-line no-console
    console.warn(`[mcp-client] ${message}`);
  };

  const attemptInitialize = async (targetUrl: string, label: string): Promise<boolean> => {
    if (!targetUrl) {
      return false;
    }

    const initPayload = createRpcPayload('initialize', {});

    try {
      await postJsonRpc(targetUrl, initPayload, headers, config.timeoutMs);
      return true;
    } catch (error) {
      if (error instanceof HttpStatusError) {
        if (ignoredStatuses.has(error.status)) {
          pushWarning(`${label} endpoint ${targetUrl} responded with status ${error.status}; continuing without handshake.`);
          return false;
        }

        pushWarning(`${label} endpoint ${targetUrl} returned status ${error.status}; continuing without handshake.`);
        return false;
      }

      if (error instanceof McpClientError) {
        pushWarning(`${label} endpoint ${targetUrl} failed: ${error.message}; continuing without handshake.`);
        return false;
      }

      pushWarning(`${label} endpoint ${targetUrl} failed; continuing without handshake.`);
      return false;
    }
  };

  if (handshakeUrl) {
    const handshakeSucceeded = await attemptInitialize(handshakeUrl, 'Handshake');
    if (!handshakeSucceeded) {
      await attemptInitialize(config.url, 'Initialize');
    }
  } else {
    await attemptInitialize(config.url, 'Initialize');
  }

  const executePost = () => postJsonRpc(config.url, payload, headers, config.timeoutMs);
  const executeGetFallback = async () => {
    pushWarning(`POST ${config.url} was rejected; retrying with GET jsonrpc query parameter.`);
    return getJsonRpc(config.url, payload, headers, config.timeoutMs);
  };

  let attempt = 0;
  const maxAttempts = 2;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await executePost();
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 405 || error.status === 403)) {
        try {
          return await executeGetFallback();
        } catch (getError) {
          error = getError;
        }
      } else if (error instanceof HttpStatusError && error.status === 404) {
        pushWarning(`POST ${config.url} returned 404; continuing without handshake.`);
        try {
          return await executeGetFallback();
        } catch (getError) {
          error = getError;
        }
      }

      if (error instanceof HttpStatusError && payload.method === 'tools/list') {
        throw new McpClientError(
          `Couldn't list tools at ${config.url} (status ${error.status}). This server may not implement JSON-RPC at this path.`,
          'http_error',
        );
      }

      if (error instanceof HttpStatusError) {
        throw new McpClientError(`Request failed at ${config.url} (status ${error.status}).`, 'http_error');
      }

      if (error instanceof McpClientError) {
        if (attempt + 1 < maxAttempts && isRetryableError(error)) {
          attempt += 1;
          continue;
        }
        throw error;
      }

      throw new McpClientError('HTTP transport failed', 'http_error');
    }
  }
}
async function postJsonRpc(
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
    throw new HttpStatusError(`HTTP error ${response.status} at ${url}`, response.status, body);
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    throw new McpClientError('Failed to read response body', 'invalid_response');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { jsonrpc: '2.0', id: payload.id ?? null, result: undefined };
  }

  try {
    return JSON.parse(trimmed) as RpcResponse;
  } catch {
    throw new McpClientError('Failed to parse JSON-RPC response', 'invalid_json');
  }
}

async function getJsonRpc(
  url: string,
  payload: RpcPayload,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RpcResponse> {
  const target = new URL(url);
  target.searchParams.set('jsonrpc', JSON.stringify(payload));

  const requestHeaders: Record<string, string> = { Accept: 'application/json', ...headers };
  delete requestHeaders['Content-Type'];
  delete requestHeaders['content-type'];

  let response: Response;
  try {
    response = await withTimeout(
      fetch(target.toString(), {
        method: 'GET',
        headers: requestHeaders,
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
    throw new HttpStatusError(`HTTP error ${response.status} at ${target.toString()}`, response.status, body);
  }

  let raw = '';
  try {
    raw = await response.text();
  } catch {
    throw new McpClientError('Failed to read response body', 'invalid_response');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { jsonrpc: '2.0', id: payload.id ?? null, result: undefined };
  }

  try {
    return JSON.parse(trimmed) as RpcResponse;
  } catch {
    throw new McpClientError('Failed to parse JSON-RPC response', 'invalid_json');
  }
}
async function sendViaSse(
  config: SseRequestConfig,
  payload: RpcPayload,
  _unusedHandshakeUrl?: string,
): Promise<RpcResponse> {
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
    throw new McpClientError(`SSE connection failed with status ${response.status}`, 'sse_connection_failed');
  }

  const stream = new SseStream(response.body.getReader());

  try {
    const postHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...config.headers,
    };

    await postJsonRpc(config.url, payload, postHeaders, config.timeoutMs);

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

    return parsed as RpcResponse;
  } finally {
    await stream.close().catch(() => undefined);
    controller.abort();
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

function isRetryableError(error: McpClientError): boolean {\n  return error.code === 'http_timeout' || error.code === 'network_error';\n}\n\nexport { McpClientError };




