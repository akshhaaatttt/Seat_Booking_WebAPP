import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
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
          {user && (
            <NavLink to="/bookings" className="navlink">
              My bookings
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className="navlink">
              Admin
            </NavLink>
          )}
          {user ? (
            <>
              <span className="faint" style={{ marginInline: 8 }}>
                {user.name}
                {isAdmin && <span className="badge badge-admin" style={{ marginLeft: 6 }}>Admin</span>}
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
