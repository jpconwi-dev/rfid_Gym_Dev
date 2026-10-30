import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function Login() {
  const { user, loading, login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={user.role === "admin" ? "/admin" : "/member"} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const u = await login(username, password);
      nav(u.role === "admin" ? "/admin" : "/member", { replace: true });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card" style={{ width: "min(400px,100%)" }} onSubmit={submit}>
        <div className="brand" style={{ fontSize: 40, marginBottom: 4 }}>Iron<b>Gate</b></div>
        <p className="muted" style={{ marginTop: 0 }}>Log in to see your membership and gym hours.</p>
        <label className="field"><span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required /></label>
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {err && <div className="msg err">{err}</div>}
        <button className="btn" style={{ width: "100%" }} disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>
          No account yet? Ask the front desk — they will give you a username and a default password.
        </p>
        <p style={{ fontSize: 13, marginBottom: 0 }}><Link to="/kiosk">Open scanner kiosk →</Link></p>
      </form>
    </div>
  );
}
