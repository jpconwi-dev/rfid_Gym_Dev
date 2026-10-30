import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Modal, Pill, TopBar } from "../components.jsx";
import { fmtDate, fmtDateTime, fmtKB, fmtMin, maskUid } from "../util";

const MONTH_CHOICES = [1, 2, 3, 6, 12];

function MonthPicker({ value, onChange }) {
  return (
    <>
      <div className="chips">
        {MONTH_CHOICES.map((m) => (
          <button type="button" key={m} className={`chip ${Number(value) === m ? "on" : ""}`} onClick={() => onChange(m)}>
            {m} {m === 1 ? "month" : "months"}
          </button>
        ))}
      </div>
      <label className="field"><span>Months paid</span>
        <input type="number" min="1" max="36" value={value} onChange={(e) => onChange(e.target.value)} required /></label>
    </>
  );
}

function RegisterModal({ onClose, onCreated }) {
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [mode, setMode] = useState("tap");
  const [months, setMonths] = useState(1);
  const [scans, setScans] = useState([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useRef(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    const load = () => api.unregistered().then((list) => {
      setScans(list);
      if (base.current === null) { base.current = new Map(list.map((s) => [s.uid, s.last_seen])); return; }
      const fresh = list.find((s) => base.current.get(s.uid) !== s.last_seen);
      if (fresh) {
        base.current.set(fresh.uid, fresh.last_seen);
        if (modeRef.current === "tap") setUid(fresh.uid);
      }
    }).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (!uid) return setErr(mode === "tap" ? "Tap the new card on the scanner first." : "Type the card UID first.");
    setBusy(true);
    try {
      onCreated(await api.register({ name, uid, months: Number(months) }));
    } catch (ex) {
      setErr(ex.message);
      setBusy(false);
    }
  };

  const pickMode = (m) => { setMode(m); setUid(""); };

  return (
    <Modal title="Register new member" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span>Full name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus /></label>

        <div className="field"><span>RFID card</span>
          <div className="seg">
            <button type="button" className={`chip ${mode === "tap" ? "on" : ""}`} onClick={() => pickMode("tap")}>Tap card on scanner</button>
            <button type="button" className={`chip ${mode === "type" ? "on" : ""}`} onClick={() => pickMode("type")}>Type card number</button>
          </div>
          {mode === "tap" ? (
            <>
              <div className={`tapbox ${uid ? "got" : ""}`}>
                {uid ? (
                  <><b style={{ color: "var(--ok)" }}>Card detected ✓</b><div className="mono muted">{maskUid(uid)}</div>
                    <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setUid("")}>Use a different card</button></>
                ) : (
                  <><div className="pulse" style={{ width: 40, height: 40, marginBottom: 10 }} />
                    <div>Waiting for a card… tap the new card on the kiosk scanner.</div></>
                )}
              </div>
              {scans.length > 0 && (
                <><div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Or pick a card scanned in the last 24 hours:</div>
                  <div className="chips">
                    {scans.map((s) => (
                      <button type="button" key={s.uid} className={`chip mono ${uid === s.uid ? "on" : ""}`} onClick={() => setUid(s.uid)}>{maskUid(s.uid)}</button>
                    ))}
                  </div></>
              )}
            </>
          ) : (
            <input className="mono" placeholder="e.g. A1 B2 C3 D4" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" />
          )}
        </div>

        <MonthPicker value={months} onChange={setMonths} />
        <div className="msg warn" style={{ fontSize: 13 }}>After creating the account, tap the card once on the kiosk: the scanner writes a secret code onto it ("card secured"). Until then it is not protected.</div>
        {err && <div className="msg err">{err}</div>}
        <div className="row">
          <button className="btn" disabled={busy || !uid}>{busy ? "Creating…" : "Create account"}</button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function Credentials({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const m = data.member;
  const text = `IronGate Gym login\nWebsite: ${window.location.origin}\nUsername: ${m.username}\nPassword: ${data.default_password}\n(You will be asked to change this password on first login.)`;
  return (
    <Modal title="Account ready" onClose={onClose}>
      <p style={{ marginTop: 0 }}>Give these login details to <b>{m.name}</b>. The password is shown <b>only now</b>; the member must change it on first login.</p>
      <div className="cred">
        <div><span className="muted">Username</span><strong>{m.username}</strong></div>
        <div><span className="muted">Default password</span><strong>{data.default_password}</strong></div>
        <div><span className="muted">Membership until</span><strong>{fmtDate(m.expires_at)}</strong></div>
      </div>
      <div className="row">
        <button className="btn" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>{copied ? "Copied ✓" : "Copy details"}</button>
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function RenewModal({ member, onClose, onDone }) {
  const [months, setMonths] = useState(1);
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try { await api.renew(member.id, Number(months)); onDone(); } catch (ex) { setErr(ex.message); }
  };
  return (
    <Modal title={`Renew — ${member.name}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted" style={{ marginTop: 0 }}>{member.status === "active" ? `Adds time after the current expiry (${fmtDate(member.expires_at)}).` : "Membership restarts from today."}</p>
        <MonthPicker value={months} onChange={setMonths} />
        {err && <div className="msg err">{err}</div>}
        <div className="row"><button className="btn">Renew</button><button type="button" className="btn ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function Overview() {
  const [o, setO] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    const load = () => api.overview().then(setO).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (err) return <div className="msg err">{err}</div>;
  if (!o) return <p className="muted">Loading…</p>;
  const sd = o.sd;
  const text = {
    ok: "SD card healthy.",
    warn: "SD card is almost full — get a replacement card ready.",
    full: "SD card is FULL. Swap it for a new card, then press “I replaced the SD card” on the kiosk page.",
    missing: "No SD card detected by the scanner.",
    unknown: "No SD report yet. Open the kiosk page with the scanner connected.",
  }[sd.state];
  const stats = [
    ["Active members", o.active, `${o.total} total`],
    ["In the gym now", o.in_gym, `${o.visits_today} visits today`],
    ["Expiring in 7 days", o.expiring_soon, "renew soon"],
    ["Expired", o.expired, "need renewal"],
    ["Banned", o.banned, "blocked from entry"],
  ];
  return (
    <div className="grid">
      <div className="grid stats">
        {stats.map(([l, v, s]) => (
          <div key={l} className="card stat"><div className="label">{l}</div><div className="value">{v}</div><div className="sub">{s}</div></div>
        ))}
      </div>
      <div className="card">
        <div className="row"><h2 className="grow">Storage</h2><span className="muted">{sd.updated_at ? `Last report ${fmtDateTime(sd.updated_at)}` : ""}</span></div>
        <div className={`bar ${sd.state === "full" ? "full" : sd.state === "warn" ? "warn" : ""}`}><i style={{ width: `${Math.min(100, sd.percent)}%` }} /></div>
        <div className="row">
          <b>{fmtKB(sd.used_kb)} used</b><span className="muted">of {sd.total_kb ? fmtKB(sd.total_kb) : "—"} ({sd.percent}%)</span>
        </div>
        <div className={`msg ${sd.state === "ok" ? "ok" : sd.state === "unknown" ? "warn" : sd.state === "warn" ? "warn" : "err"}`}>{text}</div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 13 }}>
          The SD card keeps an offline backup log of every scan. The main database lives on the server ({o.attendance_rows} attendance records).
        </p>
      </div>
    </div>
  );
}

function Members() {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [note, setNote] = useState(null);
  const [modal, setModal] = useState(null);

  const load = useCallback(() => api.members().then(setList).catch((e) => setNote({ t: "err", m: e.message })), []);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  const shown = useMemo(() => list.filter((m) =>
    (filter === "all" || m.status === filter) &&
    (`${m.name} ${m.username} ${m.uid}`.toLowerCase().includes(q.toLowerCase()))), [list, q, filter]);

  const act = async (fn, ok) => {
    try { const r = await fn(); await load(); if (ok) setNote({ t: "ok", m: ok }); return r; }
    catch (e) { setNote({ t: "err", m: e.message }); }
  };

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ maxWidth: 260 }} placeholder="Search name, username or card…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={{ width: 140 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option><option value="active">Active</option><option value="expired">Expired</option><option value="banned">Banned</option>
        </select>
        <span className="grow" />
        <button className="btn" onClick={() => setModal({ type: "register" })}>+ Register member</button>
      </div>
      {note && <div className={`msg ${note.t}`} onClick={() => setNote(null)}>{note.m}</div>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Member</th><th>Card</th><th>Status</th><th>Days left</th><th>Expires</th><th>Actions</th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.id}>
                <td><b>{m.name}</b> {m.in_gym && <span className="pill in">in gym</span>}<div className="muted mono">{m.username}</div></td>
                <td><span className="mono">{maskUid(m.uid)}</span><div>{m.card_secured ? <span className="pill active">secured</span> : <span className="pill expired">not secured</span>}</div></td>
                <td><Pill status={m.status} /></td>
                <td>{m.days_left}</td>
                <td>{fmtDate(m.expires_at)}</td>
                <td><div className="actions">
                  <button className="btn ghost sm" onClick={() => setModal({ type: "renew", m })}>Renew</button>
                  <button className="btn ghost sm" onClick={() => act(() => api.ban(m.id, !m.banned), m.banned ? "Member unbanned." : "Member banned.")}>{m.banned ? "Unban" : "Ban"}</button>
                  <button className="btn ghost sm" onClick={async () => {
                    if (!confirm(`Reset password for ${m.name}? A new default password will be generated.`)) return;
                    const r = await act(() => api.resetPassword(m.id));
                    if (r) setModal({ type: "creds", data: r });
                  }}>Reset pw</button>
                  <button className="btn danger sm" onClick={() => confirm(`Delete ${m.name} and all of their attendance history? This cannot be undone.`) && act(() => api.remove(m.id), "Member deleted.")}>Delete</button>
                </div></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6} className="muted">No members found.</td></tr>}
          </tbody>
        </table>
      </div>
      {modal?.type === "register" && <RegisterModal onClose={() => setModal(null)} onCreated={(d) => { load(); setModal({ type: "creds", data: d }); }} />}
      {modal?.type === "creds" && <Credentials data={modal.data} onClose={() => setModal(null)} />}
      {modal?.type === "renew" && <RenewModal member={modal.m} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); setNote({ t: "ok", m: "Membership renewed." }); }} />}
    </div>
  );
}

function Attendance() {
  const [rows, setRows] = useState([]);
  const load = () => api.attendance().then(setRows).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}><h2 className="grow">Check-in log</h2><button className="btn ghost sm" onClick={load}>Refresh</button></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Member</th><th>In</th><th>Out</th><th>Time in gym</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td><td>{fmtDateTime(r.check_in)}</td>
                <td>{r.check_out ? fmtDateTime(r.check_out) : <span className="pill in">inside</span>}</td>
                <td>{r.auto_closed ? <span className="muted">forgot to tap out</span> : fmtMin(r.minutes)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="muted">No check-ins yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Admin() {
  const [tab, setTab] = useState("overview");
  return (
    <>
      <TopBar tabs={[["overview", "Overview"], ["members", "Members"], ["attendance", "Attendance"]]} tab={tab} setTab={setTab} subtitle="Admin" />
      <div className="page">
        {tab === "overview" && <Overview />}
        {tab === "members" && <Members />}
        {tab === "attendance" && <Attendance />}
      </div>
    </>
  );
}
