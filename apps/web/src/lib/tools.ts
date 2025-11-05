import type { ServerConfigPayload } from './api';
import type { ServerOption } from '../types';

export function parseToolCommand(raw: string): { name: string; args: Record<string, unknown> } | null {
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

export function serverToPayload(server: ServerOption): ServerConfigPayload {
  const handshake = server.handshakeUrl?.trim();
  return {
    url: server.url,
    transport: server.transport,
    headers: server.headers,
    handshakeUrl: handshake && handshake.length > 0 ? handshake : undefined,
    timeoutMs: server.timeoutMs,
  };
}

