import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../lib/api';

interface TopBarProps {
  username: string | null;
}

export default function TopBar({ username }: TopBarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['session'] });
      toast.success('Signed out');
      navigate('/login', { replace: true });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unable to sign out';
      toast.error(message);
    },
  });

  return (
    <header
      className="glass-panel"
      style={{
        margin: '1rem',
        padding: '0.85rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div>
        <strong style={{ fontSize: '1.15rem', letterSpacing: '0.02em' }}>Natura MCP Chatbot</strong>
        <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>Cloudflare Worker · Supabase · DeepWiki MCP</div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.35rem 0.75rem',
            borderRadius: '999px',
            background: 'rgba(30, 41, 59, 0.6)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: 'rgba(74, 222, 128, 0.85)',
            }}
          />
          <span style={{ fontWeight: 500, fontSize: '0.95rem' }}>{username ?? 'Anonymous'}</span>
        </div>

        <button
          className="secondary-button"
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  );
}
