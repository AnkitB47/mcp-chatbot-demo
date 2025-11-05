import { useEffect, useMemo, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api';
import { useChatStore } from '../store/chatStore';
import { parseToolCommand, serverToPayload } from '../lib/tools';
import ServerSidebar from '../components/ServerSidebar';
import ToolList from '../components/ToolList';
import ChatMessage from '../components/ChatMessage';
import MessageComposer from '../components/MessageComposer';
import TypingIndicator from '../components/TypingIndicator';
import type { ServerOption } from '../types';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

export default function ChatPage() {
  const {
    messages,
    typing,
    addMessage,
    setTyping,
    servers,
    selectedServerId,
    enabledToolsMap,
    setToolsForServer,
  } = useChatStore((state) => ({
    messages: state.messages,
    typing: state.typing,
    addMessage: state.addMessage,
    setTyping: state.setTyping,
    servers: state.servers,
    selectedServerId: state.selectedServerId,
    enabledToolsMap: state.enabledTools,
    setToolsForServer: state.setToolsForServer,
  }));

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId),
    [servers, selectedServerId],
  );

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typing]);

  const loadToolsMutation = useMutation({
    mutationFn: (server: ServerOption) => api.listTools(serverToPayload(server)),
    onSuccess: (data, server) => {
      setToolsForServer(server.id, data.tools);
      toast.success(`Loaded ${data.tools.length} tool${data.tools.length === 1 ? '' : 's'}.`);
    },
    onError: (error: unknown) => {
      const message =
        error instanceof ApiError || error instanceof Error ? error.message : 'Unable to load tools.';
      toast.error(message);
    },
  });

  const chatMutation = useMutation({
    mutationFn: api.sendChat,
  });

  const handleSend = async (message: string) => {
    if (!selectedServer) {
      toast.error('Select a server before chatting.');
      return;
    }

    const trimmed = message.trim();
    const maybeTool = trimmed.startsWith('/') ? trimmed : null;
    if (maybeTool) {
      const parsed = parseToolCommand(maybeTool);
      if (!parsed) {
        toast.error('Invalid tool command format.');
        return;
      }
      const enabled = new Set(enabledToolsMap[selectedServerId] ?? []);
      if (!enabled.has(parsed.name)) {
        toast.error(`Enable the tool "${parsed.name}" before running it.`);
        return;
      }
    }

    const timestamp = new Date().toISOString();
    addMessage({
      id: generateId(),
      role: 'user',
      content: trimmed,
      timestamp,
    });
    setTyping(true);

    try {
      const response = await chatMutation.mutateAsync({
        message: trimmed,
        maybeTool,
        server: serverToPayload(selectedServer),
      });

      addMessage({
        id: generateId(),
        role: 'assistant',
        content: response.reply?.content ?? 'No response content.',
        timestamp: new Date().toISOString(),
        toolResult: response.toolResult?.result,
      });
    } catch (error) {
      const messageText =
        error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Request failed.';
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `⚠️ ${messageText}`,
        timestamp: new Date().toISOString(),
      });
      toast.error(messageText);
    } finally {
      setTyping(false);
    }
  };

  const handleLoadTools = () => {
    if (!selectedServer) {
      toast.error('Select a server first.');
      return;
    }
    loadToolsMutation.mutate(selectedServer);
  };

  return (
    <div className="chat-layout">
      <ServerSidebar>
        <ToolList loading={loadToolsMutation.isPending} onLoadTools={handleLoadTools} />
      </ServerSidebar>

      <div className="chat-main glass-panel">
        <div className="chat-scroll scroll-y">
          {selectedServer ? (
            <div style={{ opacity: 0.65, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Connected to <strong>{selectedServer.name}</strong>
            </div>
          ) : null}
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {typing ? (
            <div style={{ alignSelf: 'flex-start' }}>
              <TypingIndicator />
            </div>
          ) : null}
          <div ref={chatEndRef} />
        </div>

        <MessageComposer disabled={chatMutation.isPending} onSend={handleSend} />
      </div>
    </div>
  );
}
