import { connectLambda, getStore } from "@netlify/blobs";
import { hashPassword } from "../lib/crypto-auth.mjs";
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
  const existing = await store.get(`profile:${checked.nameKey}`, { type: "json" });
  if (existing) {
    return jsonResponse(409, { error: "That name is already taken." });
  }

  const { salt, hash } = hashPassword(body.password);
  const profile = {
    name: checked.displayName,
    nameKey: checked.nameKey,
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  await store.setJSON(`profile:${checked.nameKey}`, profile);

  const token = signToken(
    { name: checked.displayName, nameKey: checked.nameKey },
    secret
  );

  return jsonResponse(201, {
    ok: true,
    name: checked.displayName,
    token,
  });
}
