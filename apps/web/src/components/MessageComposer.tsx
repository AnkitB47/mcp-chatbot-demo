import { useState, KeyboardEvent } from 'react';

interface MessageComposerProps {
  disabled?: boolean;
  onSend: (message: string) => void;
}

export default function MessageComposer({ disabled = false, onSend }: MessageComposerProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    if (!value.trim() || disabled) {
      return;
    }
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="glass-panel" style={{ padding: '1rem', marginTop: '1rem' }}>
      <textarea
        style={{
          minHeight: '120px',
          resize: 'vertical',
          width: '100%',
          background: 'rgba(15, 23, 42, 0.55)',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          borderRadius: '12px',
          padding: '0.75rem 1rem',
          color: 'inherit',
          fontSize: '1rem',
          fontFamily: 'inherit',
          marginBottom: '0.75rem',
        }}
        placeholder='Send a message or run a tool. Example: /read_wiki_structure {"repoName":"facebook/react"}'
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', opacity: 0.6 }}>Enter to send · Shift+Enter for newline</span>
        <button className="primary-button" type="button" onClick={handleSend} disabled={disabled}>
          Send
        </button>
      </div>
    </div>
  );
}
