const { app } = require("@azure/functions");
const { verifyAuth, setPassword, hasPlayersPassword, wait } = require("./store");

// POST /api/auth
//   { action: "login", auth }                          → { ok, role }
//   { action: "info", auth }                           → { playersPasswordSet }   (admin only)
//   { action: "setPassword", auth, target, newPassword }  target "admin" | "players" (admin only)
app.http("auth", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth",
  handler: async (request, context) => {
    try {
      let body;
      try {
        body = await request.json();
      } catch {
        return { status: 400, jsonBody: { error: "invalid JSON body" } };
      }
      const { action, auth, target, newPassword } = body || {};
      const role = await verifyAuth(auth);

      if (action === "login") {
        if (!role) {
          await wait(600); // slows down password guessing
          return { status: 401, jsonBody: { ok: false } };
        }
        return { status: 200, jsonBody: { ok: true, role } };
      }

      if (role !== "admin") {
        await wait(600);
        return { status: 401, jsonBody: { error: "admin only" } };
      }

      if (action === "info") {
        return { status: 200, jsonBody: { playersPasswordSet: await hasPlayersPassword() } };
      }

      if (action === "setPassword") {
        if (typeof newPassword !== "string" || newPassword.trim().length < 4) {
          return { status: 400, jsonBody: { error: "password must be at least 4 characters" } };
        }
        if (target !== "admin" && target !== "players") return { status: 400, jsonBody: { error: "bad target" } };
        await setPassword(target, newPassword.trim());
        return { status: 200, jsonBody: { ok: true } };
      }

      return { status: 400, jsonBody: { error: "unknown action" } };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: "server error" } };
    }
  },
});
