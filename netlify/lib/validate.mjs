const NAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function normalizeName(name) {
  return String(name || "").trim();
}

export function validateCredentials(name, password) {
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
