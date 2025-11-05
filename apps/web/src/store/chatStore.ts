import { create } from 'zustand';
import type { ChatMessage, ServerOption, ToolDefinition, TransportKind } from '../types';

const RAW_API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
const NORMALIZED_API_BASE = RAW_API_BASE.trim().length > 0 ? RAW_API_BASE.replace(/\/$/, '') : 'http://localhost:8787';
const MOCK_MCP_URL = `${NORMALIZED_API_BASE}/api/mock-mcp`;

const DEFAULT_SERVERS: ServerOption[] = [
  {
    id: 'mock-demo-http',
    name: 'Demo Mock MCP',
    url: MOCK_MCP_URL,
    transport: 'http',
  },
  {
    id: 'deepwiki-http',
    name: 'DeepWiki HTTP',
    url: 'https://mcp.deepwiki.com/mcp',
    transport: 'http',
  },
  {
    id: 'llama-http',
    name: 'Llama HTTP',
    url: 'https://mcp.llamaindex.ai/mcp',
    transport: 'http',
  },
];

interface ChatState {
  servers: ServerOption[];
  selectedServerId: string;
  messages: ChatMessage[];
  toolsByServer: Record<string, ToolDefinition[]>;
  enabledTools: Record<string, string[]>;
  typing: boolean;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setTyping: (value: boolean) => void;
  setToolsForServer: (serverId: string, tools: ToolDefinition[]) => void;
  toggleTool: (serverId: string, toolName: string) => void;
  enableAllTools: (serverId: string) => void;
  addServer: (server: Omit<ServerOption, 'id'> & { id?: string }) => string;
  removeServer: (serverId: string) => void;
  setSelectedServer: (serverId: string) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 11);
}

export const useChatStore = create<ChatState>((set, get) => ({
  servers: DEFAULT_SERVERS,
  selectedServerId: DEFAULT_SERVERS[0].id,
  messages: [],
  toolsByServer: {},
  enabledTools: {},
  typing: false,
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  clearMessages: () => set({ messages: [] }),
  setTyping: (value) => set({ typing: value }),
  setToolsForServer: (serverId, tools) =>
    set((state) => ({
      toolsByServer: {
        ...state.toolsByServer,
        [serverId]: tools,
      },
      enabledTools: {
        ...state.enabledTools,
        [serverId]: tools.map((tool) => tool.name),
      },
    })),
  toggleTool: (serverId, toolName) =>
    set((state) => {
      const current = new Set(state.enabledTools[serverId] ?? []);
      if (current.has(toolName)) {
        current.delete(toolName);
      } else {
        current.add(toolName);
      }

      return {
        enabledTools: {
          ...state.enabledTools,
          [serverId]: Array.from(current),
        },
      };
    }),
  enableAllTools: (serverId) =>
    set((state) => {
      const tools = state.toolsByServer[serverId] ?? [];
      return {
        enabledTools: {
          ...state.enabledTools,
          [serverId]: tools.map((tool) => tool.name),
        },
      };
    }),
  addServer: (server) => {
    const id = server.id ?? generateId();
    const normalised: ServerOption = {
      ...server,
      id,
      isCustom: true,
    };
    set((state) => ({
      servers: [...state.servers, normalised],
      selectedServerId: id,
    }));
    return id;
  },
  removeServer: (serverId) =>
    set((state) => {
      const remaining = state.servers.filter((server) => server.id !== serverId || !server.isCustom);
      const selectedServerId =
        state.selectedServerId === serverId ? remaining[0]?.id ?? DEFAULT_SERVERS[0].id : state.selectedServerId;
      const { [serverId]: _removedTools, ...toolsByServer } = state.toolsByServer;
      const { [serverId]: _removedEnabled, ...enabledTools } = state.enabledTools;
      return {
        servers: remaining,
        selectedServerId,
        toolsByServer,
        enabledTools,
      };
    }),
  setSelectedServer: (serverId) =>
    set((state) => ({
      selectedServerId: state.servers.some((server) => server.id === serverId) ? serverId : state.selectedServerId,
    })),
}));

export const transports: TransportKind[] = ['http', 'sse'];
export const defaultServers = DEFAULT_SERVERS;

