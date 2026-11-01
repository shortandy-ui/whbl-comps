const { BlobServiceClient } = require("@azure/storage-blob");
// Shared helpers for kv.js and auth.js (kept in this folder so it uploads with them; it adds no web address of its own).
const crypto = require("crypto");

const CONTAINER_NAME = "whbl-comps-data";
let containerPromise = null;

function getContainer() {
  if (!containerPromise) {
    const cs = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!cs) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not configured");
    const container = BlobServiceClient.fromConnectionString(cs).getContainerClient(CONTAINER_NAME);
    containerPromise = container.createIfNotExists().then(() => container);
  }
  return containerPromise;
}

// Keys become safe blob names so nothing can escape the container.
function blobNameFor(key) {
  return String(key).replace(/[^a-zA-Z0-9_-]/g, "_") + ".json";
}

async function readText(key) {
  const container = await getContainer();
  try {
    const buf = await container.getBlockBlobClient(blobNameFor(key)).downloadToBuffer();
    return buf.toString("utf-8");
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function writeText(key, text) {
  const container = await getContainer();
  const data = Buffer.from(String(text), "utf-8");
  await container.getBlockBlobClient(blobNameFor(key)).upload(data, data.length, { overwrite: true });
}

async function deleteText(key) {
  const container = await getContainer();
  await container.getBlockBlobClient(blobNameFor(key)).deleteIfExists();
}

// ---- passwords: stored scrambled (scrypt hash), in blobs the public API never hands out ----
//   pw__admin    the admin password
//   pw__players  the players' password (optional: until it is set, the draws are open to everyone)

// The old app kept the admin password as plain text under this key. It is
// still accepted once, then replaced by a scrambled copy and deleted.
const LEGACY_ADMIN_KEY = "whbl-admin-password-v1";

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString("hex");
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function safeEqualText(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function setPassword(scope, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  await writeText("pw__" + scope, JSON.stringify({ salt, hash: hashPassword(password, salt) }));
}

async function checkPassword(scope, password) {
  if (typeof password !== "string" || !password) return false;
  const raw = await readText("pw__" + scope);
  if (raw) {
    const { salt, hash } = JSON.parse(raw);
    return safeEqualHex(hashPassword(password, salt), hash);
  }
  if (scope !== "admin") return false;
  // Admin password not moved over yet: the old plain-text one, else the
  // ADMIN_PASSWORD setting, else the built-in starter password.
  const legacy = await readText(LEGACY_ADMIN_KEY);
  const expected = legacy !== null ? legacy : process.env.ADMIN_PASSWORD || "bowlsadmin";
  if (!safeEqualText(password, expected)) return false;
  await setPassword("admin", password);
  if (legacy !== null) await deleteText(LEGACY_ADMIN_KEY);
  return true;
}

// auth = { role: "admin", password } | { role: "player", password }
async function verifyAuth(auth) {
  if (!auth || typeof auth !== "object") return null;
  if (auth.role === "admin") return (await checkPassword("admin", auth.password)) ? "admin" : null;
  if (auth.role === "player") return (await checkPassword("players", auth.password)) ? "player" : null;
  return null;
}

async function hasPlayersPassword() {
  return (await readText("pw__players")) !== null;
}

// May this person see the draws and enter results? The admin always; players
// with the players' password; everyone while no players' password is set.
async function canUseDraws(auth) {
  if (!(await hasPlayersPassword())) return true;
  return !!(await verifyAuth(auth));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { readText, writeText, setPassword, verifyAuth, hasPlayersPassword, canUseDraws, wait };
