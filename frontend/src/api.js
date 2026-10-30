const BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
export const tz = () => -new Date().getTimezoneOffset(); // minutes east of UTC

async function req(path, { method = "GET", body, kioskKey } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("gym_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (kioskKey) headers["X-Kiosk-Key"] = kioskKey;
  let res;
  try {
    res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error("Cannot reach the server. If it was idle, wait about a minute and try again.");
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token && !kioskKey && !path.startsWith("/api/auth")) {
    localStorage.removeItem("gym_token");
    window.location.href = "/";
  }
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join(", ") : "Request failed");
  }
  return data;
}

export const api = {
  login: (username, password) => req("/api/auth/login", { method: "POST", body: { username, password } }),
  me: () => req("/api/me"),
  changePassword: (current_password, new_password) =>
    req("/api/me/password", { method: "POST", body: { current_password, new_password } }),
  analytics: () => req(`/api/me/analytics?tz=${tz()}`),
  scan: (uid, token, kioskKey) => req("/api/scan", { method: "POST", body: { uid, token }, kioskKey }),
  cardSecured: (uid, kioskKey) => req("/api/kiosk/secured", { method: "POST", body: { uid }, kioskKey }),
  reportStorage: (b, kioskKey) => req("/api/kiosk/storage", { method: "POST", body: b, kioskKey }),
  overview: () => req(`/api/admin/overview?tz=${tz()}`),
  members: () => req("/api/admin/members"),
  register: (b) => req("/api/admin/members", { method: "POST", body: b }),
  renew: (id, months) => req(`/api/admin/members/${id}/renew`, { method: "POST", body: { months } }),
  ban: (id, banned) => req(`/api/admin/members/${id}/ban`, { method: "POST", body: { banned } }),
  resetPassword: (id) => req(`/api/admin/members/${id}/reset-password`, { method: "POST" }),
  remove: (id) => req(`/api/admin/members/${id}`, { method: "DELETE" }),
  attendance: () => req("/api/admin/attendance?limit=200"),
  unregistered: () => req("/api/admin/unregistered"),
};
