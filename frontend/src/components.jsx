import { useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth.jsx";

export function Modal({ title, onClose, children }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export const Pill = ({ status }) => <span className={`pill ${status}`}>{status}</span>;

export function TopBar({ tabs, tab, setTab, subtitle }) {
  const { user, logout } = useAuth();
  return (
    <div className="topbar">
      <div className="brand">Iron<b>Gate</b></div>
      {tabs ? (
        <div className="tabs">
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      ) : <div className="grow" />}
      <span className="muted">{subtitle || user?.name}</span>
      <button className="btn ghost sm" onClick={logout}>Log out</button>
    </div>
  );
}

export function ChangePassword({ forced, onDone, onCancel }) {
  const { refresh } = useAuth();
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (pw !== pw2) return setErr("The new passwords do not match.");
    setBusy(true);
    try {
      await api.changePassword(cur, pw);
      await refresh();
      onDone?.();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {forced && <div className="msg warn">You are using a default password. Please choose your own to continue.</div>}
      <label className="field"><span>{forced ? "Default password" : "Current password"}</span>
        <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required autoComplete="current-password" /></label>
      <label className="field"><span>New password (min 6 characters)</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} autoComplete="new-password" /></label>
      <label className="field"><span>Repeat new password</span>
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required minLength={6} autoComplete="new-password" /></label>
      {err && <div className="msg err">{err}</div>}
      <div className="row">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export function ForceChange() {
  const { logout } = useAuth();
  return (
    <div className="center">
      <div className="card" style={{ width: "min(440px,100%)" }}>
        <h2 style={{ marginBottom: 14 }}>Set your password</h2>
        <ChangePassword forced />
        <button className="btn ghost sm" style={{ marginTop: 14 }} onClick={logout}>Log out</button>
      </div>
    </div>
  );
}
