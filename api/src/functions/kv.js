const { app } = require("@azure/functions");
const { readText, writeText, canUseDraws, hasPlayersPassword, verifyAuth, wait } = require("./store");

// Only the competitions data can be read or written through the public API.
// (Passwords live in other blobs this function never touches.)
const DATA_KEY = "whbl-tournaments-v1";
const MAX_VALUE_LENGTH = 2000000;

// Whether a request is allowed depends on the password sent with it, so
// answers must never be kept by a browser or a cache in between.
const NO_STORE = { "Cache-Control": "no-store, private", Pragma: "no-cache" };

// Only the admin may change entrants, draws, round dates or reset a competition.
// Anyone else may only enter results: the same competitions, entrants, dates and
// first-round draw, with only scores, winners and who has moved on changed.
function onlyResultsChanged(oldText, newText) {
  let before, after;
  try {
    before = JSON.parse(oldText || "{}");
    after = JSON.parse(newText);
  } catch {
    return false;
  }
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const names = Object.keys(after);
  if (!same(Object.keys(before).sort(), names.slice().sort())) return false;
  for (const name of names) {
    const b = before[name] || {};
    const a = after[name] || {};
    if (!same(b.entrants, a.entrants) || !same(b.roundMeta, a.roundMeta)) return false;
    if (!b.bracket || !a.bracket) {
      if (!same(b.bracket, a.bracket)) return false;
      continue;
    }
    if (b.bracket.length !== a.bracket.length) return false;
    for (let r = 0; r < a.bracket.length; r++) {
      if (!Array.isArray(a.bracket[r]) || b.bracket[r].length !== a.bracket[r].length) return false;
      if (r === 0) {
        for (let m = 0; m < a.bracket[0].length; m++) {
          if (b.bracket[0][m].p1 !== a.bracket[0][m].p1 || b.bracket[0][m].p2 !== a.bracket[0][m].p2) return false;
        }
      }
    }
  }
  return true;
}

// GET requests carry the password in an x-whbl-auth header (base64 JSON), POST requests in the body.
function authFromHeader(request) {
  const raw = request.headers.get("x-whbl-auth");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  } catch {
    return null;
  }
}

async function needPassword() {
  await wait(300);
  return {
    status: 401,
    headers: NO_STORE,
    jsonBody: { error: "Enter the players' password.", needPassword: true, playersPasswordSet: await hasPlayersPassword() },
  };
}

app.http("kv", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "kv",
  handler: async (request, context) => {
    try {
      if (request.method === "GET") {
        if (request.query.get("key") !== DATA_KEY) return { status: 400, jsonBody: { error: "bad key" } };
        if (!(await canUseDraws(authFromHeader(request)))) return needPassword();
        const value = await readText(DATA_KEY);
        if (value === null) return { status: 404, headers: NO_STORE, jsonBody: { error: "not found" } };
        return { status: 200, headers: NO_STORE, jsonBody: { key: DATA_KEY, value } };
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: "invalid JSON body" } };
      }
      const { key, value, auth } = body || {};
      if (key !== DATA_KEY || typeof value !== "string") return { status: 400, jsonBody: { error: "bad key or value" } };
      if (value.length > MAX_VALUE_LENGTH) return { status: 413, jsonBody: { error: "too large" } };
      if (!(await canUseDraws(auth))) return needPassword();
      if ((await verifyAuth(auth)) !== "admin" && !onlyResultsChanged(await readText(DATA_KEY), value)) {
        return { status: 403, jsonBody: { error: "Only the admin can change entrants, draws or dates." } };
      }
      await writeText(DATA_KEY, value);
      return { status: 200, jsonBody: { key, ok: true } };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: "server error" } };
    }
  },
});
