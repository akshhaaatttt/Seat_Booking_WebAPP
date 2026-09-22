import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Banner } from '../components/Feedback';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../services/api';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      await register(name, email, password);
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <h1>Create your account</h1>
        <p>It takes a moment, and lets you hold seats while you decide.</p>
      </div>

      <form className="card card-body stack" onSubmit={submit} noValidate>
        {error && <Banner kind="error">{error}</Banner>}

        <div className="field">
          <label htmlFor="name">Full name</label>
          <input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="password-hint"
          />
          <span id="password-hint" className="faint">
            At least 8 characters.
          </span>
        </div>

        <button type="submit" className="btn btn-block" disabled={submitting}>
          {submitting && <span className="spinner" aria-hidden="true" />}
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="faint" style={{ textAlign: 'center' }}>
          Already have an account? <Link to="/login" style={{ color: 'var(--accent)' }}>Sign in</Link>
        </p>
      </form>
    </main>
  );
}
