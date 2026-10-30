import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth.jsx";
import { ChangePassword, Modal, Pill, TopBar } from "../components.jsx";
import { fmtDate, fmtDateTime, fmtMin, maskUid } from "../util";

function Ring({ left, total }) {
  const r = 62, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, total ? left / total : 0));
  return (
    <div className="ring">
      <svg width="150" height="150" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--panel2)" strokeWidth="12" />
        <circle cx="75" cy="75" r={r} fill="none" stroke="var(--accent)" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="mid"><b>{left}</b><span>days left</span></div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div><div className="sub">{sub}</div></div>;
}

export default function Member() {
  const { user } = useAuth();
  const [a, setA] = useState(null);
  const [me, setMe] = useState(user);
  const [err, setErr] = useState("");
  const [pwOpen, setPwOpen] = useState(false);
  const [pwDone, setPwDone] = useState(false);

  useEffect(() => {
    const load = () => {
      api.me().then(setMe).catch(() => {});
      api.analytics().then(setA).catch((e) => setErr(e.message));
    };
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const max = a ? Math.max(1, ...a.daily.map((d) => d.hours)) : 1;
  const dayLabel = (iso) => new Date(iso + "T00:00").toLocaleDateString(undefined, { weekday: "narrow" });

  return (
    <>
      <TopBar subtitle={me.name} />
      <div className="page grid">
        <div className="card hero">
          <Ring left={me.days_left} total={me.plan_days} />
          <div className="grow">
            <div className="row"><h2>{me.name}</h2><Pill status={me.status} />{a?.in_gym_since && <span className="pill in">in gym</span>}</div>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              {me.status === "active" && `Your membership is active until ${fmtDate(me.expires_at)}.`}
              {me.status === "expired" && `Your membership ended on ${fmtDate(me.expires_at)}. Please renew at the front desk.`}
              {me.status === "banned" && "Your account is banned. Please see the front desk."}
            </p>
            <p className="muted mono" style={{ margin: "6px 0 0" }}>Card {maskUid(me.uid)} · member since {fmtDate(me.joined_at)}</p>
          </div>
          <button className="btn ghost sm" onClick={() => { setPwDone(false); setPwOpen(true); }}>Change password</button>
        </div>

        {err && <div className="msg err">{err}</div>}
        {a && (
          <>
            <div className="grid stats">
              <Stat label="Age" value={me.age ?? "—"} sub={me.birthday ? `Born ${fmtDate(me.birthday)}` : "not set"} />
              <Stat label="Gender" value={me.gender || "—"} sub="" />
              <Stat label="Weight" value={me.weight_kg ? `${me.weight_kg} kg` : "—"} sub="updated by the front desk" />
            </div>
            <div className="grid stats">
              <Stat label="Hours this week" value={a.hours_week} sub="last 7 days" />
              <Stat label="Hours this month" value={a.hours_month} sub={`${a.visits_month} visits in 30 days`} />
              <Stat label="Average session" value={fmtMin(a.avg_session_min)} sub="per visit" />
              <Stat label="Total hours" value={a.hours_total} sub={`${a.visits_total} visits overall`} />
            </div>

            <div className="card">
              <h2>Hours per day — last 14 days</h2>
              <div className="chart">
                {a.daily.map((d) => (
                  <div className="col" key={d.date} title={`${d.date}: ${d.hours} h`}>
                    <small>{d.hours > 0 ? d.hours : ""}</small>
                    <div className={`b ${d.hours ? "" : "zero"}`} style={{ height: `${(d.hours / max) * 100}%` }} />
                    <small>{dayLabel(d.date)}</small>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h2 style={{ marginBottom: 8 }}>Recent sessions</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Checked in</th><th>Checked out</th><th>Time in gym</th></tr></thead>
                  <tbody>
                    {a.sessions.map((s, i) => (
                      <tr key={i}>
                        <td>{fmtDateTime(s.check_in)}</td>
                        <td>{s.open ? <span className="pill in">inside now</span> : fmtDateTime(s.check_out)}</td>
                        <td>{fmtMin(s.minutes)}</td>
                      </tr>
                    ))}
                    {a.sessions.length === 0 && <tr><td colSpan={3} className="muted">No visits yet — tap your card at the door to start.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
        <p className="muted" style={{ fontSize: 13 }}>This page is read-only. To change your membership or card, please ask the front desk.</p>
      </div>
      {pwOpen && (
        <Modal title="Change password" onClose={() => setPwOpen(false)}>
          {pwDone ? (
            <><div className="msg ok">Password updated.</div><button className="btn" onClick={() => setPwOpen(false)}>Close</button></>
          ) : (
            <ChangePassword onDone={() => setPwDone(true)} onCancel={() => setPwOpen(false)} />
          )}
        </Modal>
      )}
    </>
  );
}
