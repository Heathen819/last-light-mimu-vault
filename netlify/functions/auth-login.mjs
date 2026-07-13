import { connectLambda, getStore } from "@netlify/blobs";
import { verifyPassword } from "../lib/crypto-auth.mjs";
import { jsonResponse, handleOptions } from "../lib/http.mjs";
import { signToken } from "../lib/jwt.mjs";
import { validateCredentials } from "../lib/validate.mjs";

function getAuthSecret() {
  return process.env.AUTH_SECRET || "mimu-vault-dev-secret-change-me";
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const checked = validateCredentials(body.name, body.password);
  if (!checked.ok) return jsonResponse(400, { error: checked.error });

  connectLambda(event);
  const store = getStore("mimu-vault-profiles");
  const profile = await store.get(`profile:${checked.nameKey}`, { type: "json" });
  if (!profile) {
    return jsonResponse(401, { error: "Name or password is incorrect." });
  }

  const valid = verifyPassword(body.password, profile.salt, profile.hash);
  if (!valid) {
    return jsonResponse(401, { error: "Name or password is incorrect." });
  }

  const token = signToken(
    { name: profile.name, nameKey: profile.nameKey },
    getAuthSecret()
  );

  return jsonResponse(200, {
    ok: true,
    name: profile.name,
    token,
  });
}
