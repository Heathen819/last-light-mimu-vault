import { connectLambda, getStore } from "@netlify/blobs";
import { verifyPassword } from "../lib/crypto-auth.mjs";
import { jsonResponse, handleOptions } from "../lib/http.mjs";
import { getAuthSecret, signToken } from "../lib/jwt.mjs";
import { validateCredentials } from "../lib/validate.mjs";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const secret = getAuthSecret();
  if (!secret) {
    console.error("AUTH_SECRET is not set; refusing to handle auth requests.");
    return jsonResponse(500, { error: "Server is not configured for sign-in." });
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
    secret
  );

  return jsonResponse(200, {
    ok: true,
    name: profile.name,
    token,
  });
}
