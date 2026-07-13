const SESSION_KEY = "mimuVaultSession";
const PROFILES_KEY = "mimuVaultProfiles";
const GLOBAL_LEADERBOARD_KEY = "mimuVaultGlobalLeaderboard";
const API_BASE = "/.netlify/functions";
const NAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function normalizeName(name) {
  return String(name || "").trim();
}

function validateCredentials(name, password) {
  const displayName = normalizeName(name);
  if (!NAME_RE.test(displayName)) {
    return {
      ok: false,
      error: "Name must be 3–20 characters (letters, numbers, underscore).",
    };
  }
  if (!password || password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  return { ok: true, displayName, nameKey: displayName.toLowerCase() };
}

function bytesToB64(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function b64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomSaltB64() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return bytesToB64(bytes);
}

// Pure-JS salted hash (cyrb53 with rounds). Works in every context, including
// file:// where SubtleCrypto is unavailable. Local-device use only — the live
// site uses proper server-side scrypt via Netlify Functions.
function simpleHash(password, saltB64) {
  const str = `${saltB64}:${password}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let round = 0; round < 3000; round += 1) {
    for (let i = 0; i < str.length; i += 1) {
      const ch = str.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  }
  const out = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return out.toString(16).padStart(14, "0");
}

async function pbkdf2Verify(password, saltB64, hash) {
  if (!globalThis.crypto?.subtle) return false;
  try {
    const salt = b64ToBytes(saltB64);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return bytesToB64(new Uint8Array(bits)) === hash;
  } catch {
    return false;
  }
}

function hashPasswordLocal(password, saltB64 = randomSaltB64()) {
  return { salt: saltB64, hash: simpleHash(password, saltB64), algo: "s1" };
}

async function verifyPasswordLocal(password, profile) {
  if (profile.algo === "s1") {
    return simpleHash(password, profile.salt) === profile.hash;
  }
  // Legacy profiles created with the old PBKDF2 path.
  return pbkdf2Verify(password, profile.salt, profile.hash);
}

function loadProfiles() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveProfiles(profiles) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
}

function loadGlobalLeaderboardLocal() {
  try {
    const raw = localStorage.getItem(GLOBAL_LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveGlobalLeaderboardLocal(entries) {
  localStorage.setItem(GLOBAL_LEADERBOARD_KEY, JSON.stringify(entries));
}

function formatRunTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.name) return null;
    if (parsed.mode === "online" && !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function isSignedIn() {
  return !!getSession();
}

export function isLocalAuthMode() {
  return getSession()?.mode === "local";
}

export function getAuthHeaders() {
  const session = getSession();
  if (!session?.token) return {};
  return { Authorization: `Bearer ${session.token}` };
}

async function parseApiResponse(res) {
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

async function apiFetch(path, options) {
  try {
    return await fetch(`${API_BASE}${path}`, options);
  } catch {
    return null;
  }
}

function shouldUseLocalFallback(res) {
  // No response at all (network/CORS) OR the backend is missing/broken.
  // 400/401/409 are legit auth answers and must NOT trigger the fallback.
  if (!res) return true;
  return res.status === 404 || res.status >= 500;
}

async function signUpLocal(name, password) {
  const checked = validateCredentials(name, password);
  if (!checked.ok) throw new Error(checked.error);

  const profiles = loadProfiles();
  if (profiles[checked.nameKey]) {
    throw new Error("That name is already taken on this device.");
  }

  const { salt, hash, algo } = hashPasswordLocal(password);
  profiles[checked.nameKey] = {
    name: checked.displayName,
    nameKey: checked.nameKey,
    salt,
    hash,
    algo,
    createdAt: new Date().toISOString(),
  };
  saveProfiles(profiles);

  const session = {
    name: checked.displayName,
    nameKey: checked.nameKey,
    mode: "local",
  };
  saveSession(session);
  return session;
}

async function signInLocal(name, password) {
  const checked = validateCredentials(name, password);
  if (!checked.ok) throw new Error(checked.error);

  const profile = loadProfiles()[checked.nameKey];
  if (!profile) {
    throw new Error("Name or password is incorrect on this device.");
  }

  const valid = await verifyPasswordLocal(password, profile);
  if (!valid) {
    throw new Error("Name or password is incorrect on this device.");
  }

  const session = {
    name: profile.name,
    nameKey: profile.nameKey,
    mode: "local",
  };
  saveSession(session);
  return session;
}

export async function signUp(name, password) {
  const res = await apiFetch("/auth-signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });

  if (res && !shouldUseLocalFallback(res)) {
    const data = await parseApiResponse(res);
    const session = { name: data.name, token: data.token, mode: "online" };
    saveSession(session);
    return session;
  }

  return signUpLocal(name, password);
}

export async function signIn(name, password) {
  const res = await apiFetch("/auth-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });

  if (res && !shouldUseLocalFallback(res)) {
    const data = await parseApiResponse(res);
    const session = { name: data.name, token: data.token, mode: "online" };
    saveSession(session);
    return session;
  }

  return signInLocal(name, password);
}

export function signOut() {
  clearSession();
}

export function signOutToSignInPage() {
  clearSession();
  window.location.replace("sign-in.html");
}

/**
 * Gate for the game page: if there is no session, send the visitor to the
 * sign-in landing page. Returns true when signed in.
 */
export function requireSignedIn(redirectTo = "sign-in.html") {
  if (isSignedIn()) return true;
  window.location.replace(redirectTo);
  return false;
}

export async function fetchGlobalLeaderboard() {
  const res = await apiFetch("/leaderboard-get");
  if (res && !shouldUseLocalFallback(res)) {
    const data = await parseApiResponse(res);
    return Array.isArray(data.entries) ? data.entries : [];
  }

  return loadGlobalLeaderboardLocal()
    .filter((entry) => typeof entry?.seconds === "number")
    .sort((a, b) => a.seconds - b.seconds);
}

export async function submitGlobalScore(seconds) {
  const session = getSession();
  if (!session?.name) return { ok: false };

  if (session.mode === "local") {
    const entries = loadGlobalLeaderboardLocal();
    const nextEntry = {
      name: session.name,
      nameKey: session.nameKey || session.name.toLowerCase(),
      seconds,
      time: formatRunTime(seconds),
      date: new Date().toISOString(),
    };
    const existingIndex = entries.findIndex(
      (entry) => entry.nameKey === nextEntry.nameKey
    );
    if (existingIndex >= 0) {
      if (seconds >= entries[existingIndex].seconds) {
        return { ok: true, updated: false, mode: "local" };
      }
      entries[existingIndex] = nextEntry;
    } else {
      entries.push(nextEntry);
    }
    entries.sort((a, b) => a.seconds - b.seconds);
    saveGlobalLeaderboardLocal(entries.slice(0, 50));
    return { ok: true, updated: true, mode: "local" };
  }

  const res = await apiFetch("/leaderboard-submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders(),
    },
    body: JSON.stringify({ seconds }),
  });

  if (!res || shouldUseLocalFallback(res)) {
    session.mode = "local";
    saveSession(session);
    return submitGlobalScore(seconds);
  }

  return parseApiResponse(res);
}
