import type { PropsWithChildren } from 'react';
import { useSessionQuery } from '../hooks/useSession';
import TopBar from '../components/TopBar';

export default function AppLayout({ children }: PropsWithChildren) {
  const { data } = useSessionQuery();

  return (
    <div className="app-shell">
      <TopBar username={data?.username ?? null} />
      <main className="app-main">{children}</main>
    </div>
  );
}
