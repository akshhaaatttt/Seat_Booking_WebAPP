import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmptyState } from './components/Feedback';
import { EventsPage } from './pages/EventsPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { SeatSelectionPage } from './pages/SeatSelectionPage';
import { ShowSelectionPage } from './pages/ShowSelectionPage';
import { useAuth } from './hooks/useAuth';

function GuestOnly({ children }: { children: React.ReactElement }) {
  const { user } = useAuth();
  return user ? <Navigate to="/" replace /> : children;
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<EventsPage />} />
        <Route path="/events/:eventId" element={<ShowSelectionPage />} />
        <Route path="/shows/:showId" element={<SeatSelectionPage />} />
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <RegisterPage />
            </GuestOnly>
          }
        />
        <Route
          path="*"
          element={
            <main className="page">
              <EmptyState title="Page not found" description="That page does not exist." />
            </main>
          }
        />
      </Route>
    </Routes>
  );
}
