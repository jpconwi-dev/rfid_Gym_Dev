import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth.jsx";
import { ForceChange } from "./components.jsx";
import Login from "./pages/Login.jsx";
import Kiosk from "./pages/Kiosk.jsx";
import Admin from "./pages/Admin.jsx";
import Member from "./pages/Member.jsx";

const home = (u) => (u.role === "admin" ? "/admin" : "/member");

function Guard({ role, children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to="/" replace />;
  if (user.role !== role) return <Navigate to={home(user)} replace />;
  if (user.must_change_password) return <ForceChange />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/kiosk" element={<Kiosk />} />
      <Route path="/admin" element={<Guard role="admin"><Admin /></Guard>} />
      <Route path="/member" element={<Guard role="member"><Member /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
