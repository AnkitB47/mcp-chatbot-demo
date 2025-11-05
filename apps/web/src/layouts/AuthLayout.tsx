import type { PropsWithChildren } from 'react';

export default function AuthLayout({ children }: PropsWithChildren) {
  return (
    <div
      className="app-shell"
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div className="glass-panel form-card">{children}</div>
    </div>
  );
}
