import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { format } from 'date-fns';
import type { ChatMessage as ChatMessageModel } from '../types';

interface ChatMessageProps {
  message: ChatMessageModel;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const timestamp = format(new Date(message.timestamp), 'HH:mm');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div className={`chat-bubble ${isUser ? 'user' : 'assistant'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {message.content}
        </ReactMarkdown>
        {message.toolResult !== undefined ? (
          <pre className="tool-result">
            <code>{JSON.stringify(message.toolResult, null, 2)}</code>
          </pre>
        ) : null}
      </div>
      <span style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.3rem' }}>{timestamp}</span>
    </div>
  );
}
