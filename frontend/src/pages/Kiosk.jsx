import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { SerialLink, serialSupported } from "../serial";
import { fmtKB } from "../util";

const TITLES = {
  checked_in: "Welcome in",
  checked_out: "See you next time",
  expired: "Membership ended",
  banned: "Access denied",
  unregistered: "Card not registered",
};

export default function Kiosk() {
  const [key, setKey] = useState(localStorage.getItem("gym_kiosk_key") || "");
  const [conn, setConn] = useState("disconnected");
  const [shown, setShown] = useState(null);
  const [recent, setRecent] = useState([]);
  const [sd, setSd] = useState(null);
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");
  const keyRef = useRef(key);
  keyRef.current = key;
  const link = useRef(null);
  const timer = useRef(null);
  const busy = useRef(false);

  const handleScan = useCallback(async (uid) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const r = await api.scan(uid, keyRef.current);
      setErr("");
      setShown(r);
      setRecent((p) => [{ ...r, at: new Date() }, ...p].slice(0, 6));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setShown(null), 6000);
      link.current?.send(`LCD:${r.lcd[0]}|${r.lcd[1]}`);
      const name = (r.name || "").replace(/[^\w ]/g, "").slice(0, 16);
      link.current?.send(`LOG:${new Date().toISOString().slice(0, 19)},${uid.replace(/ /g, "")},${r.result},${name}`);
    } catch (e) {
      setErr(e.message);
      link.current?.send("LCD:SERVER ERROR|Try again");
    } finally {
      busy.current = false;
    }
  }, []);

  const onLine = (line) => {
    const u = line.match(/^UID:\s*(.+)$/i);
    if (u) return handleScan(u[1]);
    const s = line.match(/^SD:(\d):(\d+):(\d+)$/);
    if (s) {
      const v = { ok: s[1] === "1", used_kb: +s[2], total_kb: +s[3] };
      setSd(v);
      api.reportStorage(v, keyRef.current).catch(() => {});
    }
  };
  const lineRef = useRef(onLine);
  lineRef.current = onLine;

  const connect = async (existing) => {
    try {
      const l = new SerialLink((x) => lineRef.current(x), setConn);
      link.current = l;
      await l.connect(existing);
      setErr("");
    } catch (e) {
      if (e.name !== "NotFoundError") setErr("Could not open the scanner: " + e.message + " (close the Arduino Serial Monitor if it is open)");
    }
  };

  useEffect(() => {
    if (!serialSupported()) return;
    SerialLink.previousPort().then((p) => p && connect(p));
    const t = setInterval(() => link.current?.send("SDCHECK"), 5 * 60 * 1000);
    return () => { clearInterval(t); link.current?.disconnect(); };
  }, []); // eslint-disable-line

  const saveKey = (v) => {
    setKey(v);
    localStorage.setItem("gym_kiosk_key", v);
  };
  const sdFull = sd && sd.ok && sd.total_kb && sd.used_kb / sd.total_kb >= 0.98;

  return (
    <div className="kiosk">
      <div className={`screen ${shown?.result || ""}`}>
        {shown ? (
          <>
            <h1>{shown.name && shown.result !== "unregistered" ? shown.name : TITLES[shown.result]}</h1>
            {shown.name && shown.result !== "unregistered" && <p>{TITLES[shown.result]}</p>}
            {shown.days_left != null && shown.result !== "banned" && (
              <><div className="days">{shown.days_left}</div><p>days left</p></>
            )}
            <p style={{ color: "var(--text)" }}>{shown.message}</p>
          </>
        ) : (
          <>
            <div className="pulse" />
            <h1>Tap your card</h1>
            <p>Hold your RFID card near the reader to check in or out</p>
          </>
        )}
      </div>

      <div className="kbar">
        <span><span className={`dot ${conn === "connected" ? "on" : ""}`} />{conn === "connected" ? "Scanner connected" : "Scanner offline"}</span>
        {conn === "connected"
          ? <button className="btn ghost sm" onClick={() => link.current?.disconnect()}>Disconnect</button>
          : <button className="btn sm" onClick={() => connect()} disabled={!serialSupported()}>Connect scanner</button>}
        {sd && (
          <span className={sd.ok ? "muted" : ""} style={{ color: !sd.ok || sdFull ? "var(--bad)" : undefined }}>
            {sd.ok ? `SD ${fmtKB(sd.used_kb)} / ${fmtKB(sd.total_kb)}${sdFull ? " — FULL, replace card" : ""}` : "SD card missing"}
          </span>
        )}
        {sd && (!sd.ok || sdFull) && <button className="btn ghost sm" onClick={() => link.current?.send("SDINIT")}>I replaced the SD card</button>}
        <span className="grow" />
        <input style={{ width: 150 }} type="password" placeholder="Kiosk key" value={key} onChange={(e) => saveKey(e.target.value)} />
        <input style={{ width: 150 }} placeholder="Test UID" value={manual} onChange={(e) => setManual(e.target.value)} />
        <button className="btn ghost sm" onClick={() => manual && handleScan(manual)}>Simulate scan</button>
        <Link to="/">Login</Link>
      </div>
      {!serialSupported() && <div className="msg warn" style={{ margin: 12 }}>This browser has no Web Serial support. Use Chrome or Edge on a desktop/laptop.</div>}
      {err && <div className="msg err" style={{ margin: 12 }}>{err}</div>}
      {recent.length > 0 && (
        <div className="kbar" style={{ gap: 18 }}>
          {recent.map((r, i) => (
            <span key={i} className="muted mono">{r.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.name || r.uid} · {r.result}</span>
          ))}
        </div>
      )}
    </div>
  );
}
