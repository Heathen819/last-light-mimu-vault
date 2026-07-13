import { connectLambda, getStore } from "@netlify/blobs";
import { hashPassword } from "../lib/crypto-auth.mjs";
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
  const existing = await store.get(`profile:${checked.nameKey}`, {
    type: "json",
    consistency: "strong",
  });
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
    getAuthSecret()
  );

  return jsonResponse(201, {
    ok: true,
    name: checked.displayName,
    token,
  });
}
