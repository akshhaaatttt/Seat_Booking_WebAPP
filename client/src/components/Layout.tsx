import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = async (): Promise<void> => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app">
      <header className="masthead">
        <NavLink to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SeatBox
        </NavLink>

        <nav aria-label="Main">
          <NavLink to="/" className="navlink" end>
            Events
          </NavLink>
          {user ? (
            <>
              <span className="faint" style={{ marginInline: 8 }}>
                {user.name}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="navlink">
                Sign in
              </NavLink>
              <NavLink to="/register" className="btn btn-sm" style={{ marginLeft: 6 }}>
                Create account
              </NavLink>
            </>
          )}
        </nav>
      </header>

      <Outlet />
    </div>
  );
}
