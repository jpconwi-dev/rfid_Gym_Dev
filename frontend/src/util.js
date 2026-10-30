export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";
export const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
export const fmtKB = (kb) => (kb >= 1048576 ? `${(kb / 1048576).toFixed(1)} GB` : kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`);
// Card numbers are never shown in full: only the last 2 bytes.
export const maskUid = (uid) => { const p = (uid || "").split(" "); return p.map((b, i) => (i < p.length - 2 ? "••" : b)).join(" "); };
export const calcAge = (iso) => {
  if (!iso) return null;
  const b = new Date(iso + "T00:00"), t = new Date();
  return t.getFullYear() - b.getFullYear() - (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate()) ? 1 : 0);
};
export const GENDERS = ["Male", "Female", "Other", "Prefer not to say"];
