import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useSessionQuery } from './hooks/useSession';
import AuthLayout from './layouts/AuthLayout';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/Login';
import RegisterPage from './pages/Register';
import ChatPage from './pages/Chat';
import Loader from './components/Loader';

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  const { data, isLoading } = useSessionQuery();

  if (isLoading) {
    return <Loader message="Checking session..." fullscreen />;
  }

  if (!data?.userId) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function RedirectAuthenticated({ children }: { children: JSX.Element }) {
  const { data, isLoading } = useSessionQuery();

  if (isLoading) {
    return <Loader message="Loading..." fullscreen />;
  }

  if (data?.userId) {
    return <Navigate to="/chat" replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RedirectAuthenticated>
            <AuthLayout>
              <LoginPage />
            </AuthLayout>
          </RedirectAuthenticated>
        }
      />
      <Route
        path="/register"
        element={
          <RedirectAuthenticated>
            <AuthLayout>
              <RegisterPage />
            </AuthLayout>
          </RedirectAuthenticated>
        }
      />

      <Route
        path="/"
        element={
          <RequireAuth>
            <AppLayout>
              <Outlet />
            </AppLayout>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/chat" replace />} />
        <Route path="chat" element={<ChatPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
