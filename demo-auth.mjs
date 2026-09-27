// Opt-in localhost password mode. This is not a multi-host security boundary.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const lockWindowMs = 15 * 60 * 1000;
const maxFailures = 5;
const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function passwordText(value) {
  if (typeof value !== "string" || value.length < 14 || value.length > 128 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error("Use a unique password of 14-128 characters without control characters");
  }
  return value;
}

function hashPassword(password, saltHex) {
  return scryptSync(password, Buffer.from(saltHex, "hex"), 32, scryptOptions);
}

function credentialMatches(credential, password) {
  const salt = credential?.salt || "00000000000000000000000000000000";
  const expected = credential?.passwordHash || "0000000000000000000000000000000000000000000000000000000000000000";
  const actual = hashPassword(typeof password === "string" && password.length <= 128 ? password : "", salt);
  const stored = Buffer.from(expected, "hex");
  return stored.length === actual.length && timingSafeEqual(actual, stored) && Boolean(credential);
}

export function createDemoAuth({ store, users, adminUserId }) {
  const sessions = new Map();
  const failures = new Map();
  const visible = () => users().filter((user) => user && !user.hidden && user.active !== false);
  const findUser = (id) => visible().find((user) => user.id === id);
  const passwordSet = () => store.credentialCount() > 0;

  function publicUsers() {
    return visible().filter((user) => store.credentialFor(user.id)).map((user) => ({ ...user,
      passwordUpdatedAt: store.credentialFor(user.id)?.updatedAt || "" }));
  }

  function session(req) {
    const token = /(?:^|;\s*)demo_session=([0-9a-f]{64})(?:;|$)/.exec(String(req.headers.cookie || ""))?.[1];
    if (!token) return null;
    const found = sessions.get(token);
    if (!found) return null;
    if (found.expires <= Date.now()) { sessions.delete(token); return null; }
    const user = findUser(found.userId);
    if (!user || !store.credentialFor(user.id)) { sessions.delete(token); return null; }
    return { ...found, token, user };
  }

  function startSession(res, userId) {
    for (const [token, item] of sessions) if (item.expires <= Date.now()) sessions.delete(token);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString("hex");
    const csrf = randomBytes(32).toString("hex");
    sessions.set(token, { userId, csrf, expires: Date.now() + sessionLifetimeMs });
    res.setHeader("Set-Cookie", `demo_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    return { user: findUser(userId), csrf };
  }

  function setup(res, userId, password) {
    if (passwordSet()) throw new Error("Admin setup is already complete");
    const admin = findUser(adminUserId);
    if (!admin || admin.id !== userId || Number(admin.clearanceLevel) < 2) {
      throw new Error("The configured first administrator must be a visible level-2 user");
    }
    const salt = randomBytes(16).toString("hex");
    const hash = hashPassword(passwordText(password), salt).toString("hex");
    if (!store.createFirstCredential(admin.id, salt, hash)) throw new Error("Admin setup was already completed");
    admin.passwordUpdatedAt = new Date().toISOString();
    return startSession(res, admin.id);
  }

  function login(res, userId, password) {
    const key = String(userId || "");
    const recent = (failures.get(key) || []).filter((at) => Date.now() - at < lockWindowMs);
    if (recent.length >= maxFailures) throw new Error("Too many login attempts; retry in 15 minutes");
    const user = findUser(key);
    const credential = user ? store.credentialFor(user.id) : null;
    if (!credentialMatches(credential, password)) {
      recent.push(Date.now()); failures.set(key, recent);
      return null;
    }
    failures.delete(key);
    return startSession(res, user.id);
  }

  function csrfAllowed(found, value) {
    if (!found || !/^[0-9a-f]{64}$/.test(String(value || ""))) return false;
    return timingSafeEqual(Buffer.from(found.csrf, "hex"), Buffer.from(value, "hex"));
  }

  function logout(req, res) {
    const found = session(req);
    if (found) sessions.delete(found.token);
    res.setHeader("Set-Cookie", "demo_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  }

  function changePassword(found, currentPassword, newPassword) {
    const credential = store.credentialFor(found.user.id);
    if (!credentialMatches(credential, currentPassword)) throw new Error("Current password is incorrect");
    const salt = randomBytes(16).toString("hex");
    store.setCredential(found.user.id, salt, hashPassword(passwordText(newPassword), salt).toString("hex"));
    found.user.passwordUpdatedAt = new Date().toISOString();
    for (const [token, item] of sessions) if (item.userId === found.user.id && token !== found.token) sessions.delete(token);
  }

  function setUserPassword(actor, userId, password) {
    if (Number(actor.clearanceLevel) < 2) throw new Error("Level-2 permission required");
    const user = findUser(userId);
    if (!user) throw new Error("Visible demo user not found");
    if (actor.id === user.id) throw new Error("Change your own password through the personal password form");
    const salt = randomBytes(16).toString("hex");
    store.setCredential(user.id, salt, hashPassword(passwordText(password), salt).toString("hex"));
    user.passwordUpdatedAt = new Date().toISOString();
    for (const [token, item] of sessions) if (item.userId === user.id) sessions.delete(token);
  }

  if (passwordSet() && !visible().some((user) => store.credentialFor(user.id))) {
    throw new Error("No configured visible demo user has a password; refusing secure-local startup");
  }

  return { passwordSet, publicUsers, session, startSession, setup, login, csrfAllowed,
    logout, changePassword, setUserPassword };
}
