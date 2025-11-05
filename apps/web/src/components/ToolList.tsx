import { useChatStore } from '../store/chatStore';

interface ToolListProps {
  loading: boolean;
  onLoadTools: () => void;
}

export default function ToolList({ loading, onLoadTools }: ToolListProps) {
  const { selectedServerId, tools, enabledTools, toggleTool, enableAllTools } = useChatStore((state) => ({
    selectedServerId: state.selectedServerId,
    tools: state.toolsByServer[state.selectedServerId] ?? [],
    enabledTools: new Set(state.enabledTools[state.selectedServerId] ?? []),
    toggleTool: state.toggleTool,
    enableAllTools: state.enableAllTools,
  }));

  const hasTools = tools.length > 0;

  return (
    <section className="glass-panel scroll-y" style={{ padding: '1.25rem', flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>Tools</h3>
          <span style={{ fontSize: '0.85rem', opacity: 0.6 }}>Load and enable tools for the selected server.</span>
        </div>
        <button className="secondary-button" type="button" onClick={onLoadTools} disabled={loading}>
          {loading ? 'Loading…' : 'Load tools'}
        </button>
      </div>

      {hasTools ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <button
            className="secondary-button"
            type="button"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => enableAllTools(selectedServerId)}
          >
            Enable all
          </button>
          {tools.map((tool) => {
            const isEnabled = enabledTools.has(tool.name);
            return (
              <label
                key={tool.name}
                className="tool-card"
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  borderColor: isEnabled ? 'rgba(96, 165, 250, 0.6)' : 'rgba(148, 163, 184, 0.15)',
                }}
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleTool(selectedServerId, tool.name)}
                  style={{ marginTop: '0.35rem' }}
                />
                <div>
                  <strong>{tool.name}</strong>
                  {tool.description ? (
                    <div style={{ fontSize: '0.85rem', opacity: 0.75, marginTop: '0.35rem' }}>{tool.description}</div>
                  ) : null}
                </div>
              </label>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            border: '1px dashed rgba(148, 163, 184, 0.2)',
            borderRadius: '12px',
            padding: '1rem',
            textAlign: 'center',
            fontSize: '0.9rem',
            opacity: 0.7,
          }}
        >
          No tools loaded yet. Click “Load tools” to fetch available tools.
        </div>
      )}
    </section>
  );
}
