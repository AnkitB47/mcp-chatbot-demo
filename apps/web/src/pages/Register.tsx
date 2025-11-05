import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api';

export default function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const registerMutation = useMutation({
    mutationFn: () => api.register({ username, email, password }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session'] });
      toast.success('Account ready!');
      navigate('/chat', { replace: true });
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        toast.error(error.message);
        return;
      }
      toast.error('Registration failed.');
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !email.trim() || !password.trim()) {
      toast.error('Please complete all fields.');
      return;
    }
    registerMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit}>
      <h1>Create account</h1>
      <p style={{ opacity: 0.7, marginTop: 0, marginBottom: '1.5rem' }}>
        Choose a username. Email confirmation is skipped for this demo.
      </p>

      <div className="form-field">
        <label htmlFor="register-username">Username</label>
        <input
          id="register-username"
          value={username}
          autoComplete="username"
          onChange={(event) => setUsername(event.target.value)}
          disabled={registerMutation.isPending}
        />
      </div>

      <div className="form-field">
        <label htmlFor="register-email">Email</label>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={registerMutation.isPending}
        />
      </div>

      <div className="form-field">
        <label htmlFor="register-password">Password</label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={registerMutation.isPending}
        />
      </div>

      <button className="primary-button" type="submit" disabled={registerMutation.isPending}>
        {registerMutation.isPending ? 'Registering…' : 'Register'}
      </button>

      <div style={{ marginTop: '1.5rem', fontSize: '0.9rem', textAlign: 'center' }}>
        Already have an account? <Link to="/login">Sign in</Link>.
      </div>
    </form>
  );
}
