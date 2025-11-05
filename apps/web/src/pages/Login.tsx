import { FormEvent, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [usernameOrEmail, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useMutation({
    mutationFn: async () => {
      const identifier = usernameOrEmail.trim();
      await api.login({ usernameOrEmail: identifier, password });
      return api.getSession();
    },
    onSuccess: (session) => {
      queryClient.setQueryData(['session'], session);
      toast.success('Welcome back!');
      const next = (location.state as { from?: string } | null)?.from ?? '/chat';
      navigate(next, { replace: true });
    },
    onError: (error: unknown) => {
      queryClient.removeQueries({ queryKey: ['session'] });
      queryClient.setQueryData(['session'], undefined);
      if (error instanceof ApiError) {
        toast.error(error.message);
        return;
      }
      toast.error(error instanceof Error ? error.message : 'Unable to sign in.');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!usernameOrEmail.trim() || !password.trim()) {
      toast.error('Please enter your credentials.');
      return;
    }
    loginMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign in</h1>
      <p style={{ opacity: 0.7, marginTop: 0, marginBottom: '1.5rem' }}>
        Use your Supabase credentials to access the MCP workspace.
      </p>

      <div className="form-field">
        <label htmlFor="login-identifier">Username or email</label>
        <input
          id="login-identifier"
          value={usernameOrEmail}
          autoComplete="username"
          disabled={loginMutation.isPending}
          onChange={(event) => setIdentifier(event.target.value)}
        />
      </div>

      <div className="form-field">
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          disabled={loginMutation.isPending}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      <button className="primary-button" type="submit" disabled={loginMutation.isPending}>
        {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
      </button>

      <div style={{ marginTop: '1.5rem', fontSize: '0.9rem', textAlign: 'center' }}>
        No account? <Link to="/register">Register here</Link>.
      </div>
    </form>
  );
}
