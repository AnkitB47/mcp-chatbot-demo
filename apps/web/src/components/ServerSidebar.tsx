import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useChatStore, transports } from '../store/chatStore';

interface ServerSidebarProps {
  children?: ReactNode;
}

export default function ServerSidebar({ children }: ServerSidebarProps) {
  const { servers, selectedServerId, setSelectedServer, addServer, removeServer } = useChatStore((state) => ({
    servers: state.servers,
    selectedServerId: state.selectedServerId,
    setSelectedServer: state.setSelectedServer,
    addServer: state.addServer,
    removeServer: state.removeServer,
  }));

  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [transport, setTransport] = useState<'http' | 'sse'>('http');
  const [handshakeUrl, setHandshakeUrl] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !url.trim()) {
      toast.error('Name and URL are required.');
      return;
    }

    try {
      new URL(url.trim());
      if (handshakeUrl.trim()) {
        new URL(handshakeUrl.trim());
      }
    } catch {
      toast.error('Please provide valid URLs.');
      return;
    }

    const id = addServer({
      name: name.trim(),
      url: url.trim(),
      transport,
      handshakeUrl: handshakeUrl.trim() || undefined,
      headers: undefined,
      timeoutMs: undefined,
    });

    toast.success(`Server "${name.trim()}" added.`);
    setName('');
    setUrl('');
    setHandshakeUrl('');
    setTransport('http');
    setIsAdding(false);
    setSelectedServer(id);
  };

  return (
    <aside className="chat-sidebar">
      <section className="glass-panel scroll-y" style={{ padding: '1.25rem', maxHeight: '50vh' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ margin: 0 }}>MCP Servers</h3>
            <span style={{ fontSize: '0.85rem', opacity: 0.65 }}>Choose or add a compatible MCP endpoint.</span>
          </div>
          <button className="secondary-button" type="button" onClick={() => setIsAdding((prev) => !prev)}>
            {isAdding ? 'Cancel' : 'Add'}
          </button>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {servers.map((server) => (
            <label
              key={server.id}
              className="tool-card"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                borderColor: server.id === selectedServerId ? 'rgba(96, 165, 250, 0.6)' : 'rgba(148, 163, 184, 0.1)',
              }}
            >
              <input
                type="radio"
                name="server"
                checked={server.id === selectedServerId}
                onChange={() => setSelectedServer(server.id)}
                style={{ marginTop: '0.35rem' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong>{server.name}</strong>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      background: 'rgba(37, 99, 235, 0.2)',
                      borderRadius: '6px',
                      padding: '0.15rem 0.5rem',
                    }}
                  >
                    {server.transport}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', opacity: 0.7, wordBreak: 'break-all' }}>{server.url}</div>
                {server.handshakeUrl ? (
                  <div style={{ fontSize: '0.75rem', opacity: 0.6, marginTop: '0.25rem' }}>
                    Handshake: {server.handshakeUrl}
                  </div>
                ) : null}
              </div>
              {server.isCustom ? (
                <button
                  className="secondary-button"
                  type="button"
                  style={{ padding: '0.25rem 0.75rem' }}
                  onClick={() => {
                    removeServer(server.id);
                    toast.success('Server removed');
                  }}
                >
                  Remove
                </button>
              ) : null}
            </label>
          ))}
        </div>

        {isAdding ? (
          <div
            className="tool-card"
            style={{
              marginTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="server-label">Name</label>
              <input
                id="server-label"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="My MCP Server"
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="server-url">JSON-RPC URL</label>
              <input
                id="server-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/mcp"
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="server-transport">Transport</label>
              <select
                id="server-transport"
                value={transport}
                onChange={(event) => setTransport(event.target.value as 'http' | 'sse')}
                className="secondary-button"
                style={{ padding: '0.5rem 0.75rem' }}
              >
                {transports.map((item) => (
                  <option key={item} value={item}>
                    {item.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="server-handshake">Handshake URL (optional)</label>
              <input
                id="server-handshake"
                value={handshakeUrl}
                onChange={(event) => setHandshakeUrl(event.target.value)}
                placeholder="https://example.com/sse"
              />
            </div>

            <button className="primary-button" type="button" onClick={handleSubmit}>
              Save server
            </button>
          </div>
        ) : null}
      </section>

      {children}
    </aside>
  );
}
