// Talks to the Azure Functions in /api.

function authHeader(auth) {
  if (!auth) return {};
  return { "x-whbl-auth": btoa(unescape(encodeURIComponent(JSON.stringify(auth)))) };
}

// Returns { key, value }, or null if nothing has been saved yet.
// Throws if it can't load; the error has needPassword = true when the
// players' password is needed (or the one given is wrong).
export async function storageGet(key, auth) {
  // no-store: whether it's allowed depends on the password sent, so never reuse an earlier answer
  const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`, { headers: authHeader(auth), cache: "no-store" });
  if (res.status === 404) return null;
  if (res.status === 401) {
    const err = new Error("Enter the players' password.");
    err.needPassword = true;
    throw err;
  }
  if (!res.ok) throw new Error(`Could not load (${res.status})`);
  const data = await res.json();
  return { key, value: data.value };
}

// Returns { ok, status }.
export async function storageSet(key, value, auth) {
  try {
    const res = await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, auth }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function authCall(body) {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch {
    return { ok: false };
  }
}

// auth = { role: "admin" | "player", password }
export async function login(auth) {
  return (await authCall({ action: "login", auth })).ok;
}

// Admin only: { ok, playersPasswordSet }
export function adminInfo(auth) {
  return authCall({ action: "info", auth });
}

// Admin only. target = "admin" | "players"
export async function setPassword(auth, target, newPassword) {
  return (await authCall({ action: "setPassword", auth, target, newPassword })).ok;
}
