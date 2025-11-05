import type { PropsWithChildren } from 'react';
import { useSessionQuery } from '../hooks/useSession';
import TopBar from '../components/TopBar';

export default function AppLayout({ children }: PropsWithChildren) {
  const { data } = useSessionQuery();
  const displayName = data?.username ?? data?.email ?? null;

  return (
    <div className="app-shell">
      <TopBar username={displayName} />
      <main className="app-main">{children}</main>
    </div>
  );
}
