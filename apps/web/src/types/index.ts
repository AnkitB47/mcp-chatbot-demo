import type { ToolDefinition as ApiToolDefinition } from '../lib/api';

export type TransportKind = 'http' | 'sse';

export interface ServerOption {
  id: string;
  label: string;
  url: string;
  transport: TransportKind;
  headers?: Record<string, string>;
  handshakeUrl?: string;
  timeoutMs?: number;
  isCustom?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolResult?: unknown;
}

export type ToolDefinition = ApiToolDefinition;
