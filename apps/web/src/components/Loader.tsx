interface LoaderProps {
  message?: string;
  fullscreen?: boolean;
}

export default function Loader({ message = 'Loading...', fullscreen = false }: LoaderProps) {
  return (
    <div
      className="glass-panel"
      style={
        fullscreen
          ? {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100vh',
            }
          : { padding: '1rem' }
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'center' }}>
        <div className="spinner" />
        <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{message}</span>
      </div>
    </div>
  );
}
