// Small client for the /api/kv Azure Function.
// Mirrors the shape the app expects: { key, value } | null

export async function storageGet(key) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET /api/kv failed: ${res.status}`);
    const data = await res.json();
    return { key, value: data.value };
  } catch (err) {
    console.error("storageGet failed", err);
    return null;
  }
}

export async function storageSet(key, value) {
  try {
    const res = await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error(`POST /api/kv failed: ${res.status}`);
    return { key, value };
  } catch (err) {
    console.error("storageSet failed", err);
    return null;
  }
}
