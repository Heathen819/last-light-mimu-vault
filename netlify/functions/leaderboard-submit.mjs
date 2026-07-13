import { connectLambda, getStore } from "@netlify/blobs";
import { jsonResponse, handleOptions } from "../lib/http.mjs";
import { verifyToken } from "../lib/jwt.mjs";

const MAX_GLOBAL = 50;

function getAuthSecret() {
  return process.env.AUTH_SECRET || "mimu-vault-dev-secret-change-me";
}

function formatRunTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getBearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const token = getBearerToken(event);
  const session = verifyToken(token, getAuthSecret());
  if (!session?.name || !session?.nameKey) {
    return jsonResponse(401, { error: "Sign in to submit a global score." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body." });
  }

  const seconds = Number(body.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return jsonResponse(400, { error: "Invalid run time." });
  }

  connectLambda(event);
  const store = getStore("mimu-vault-leaderboard");
  const entries = (await store.get("global", { type: "json" })) || [];
  const now = new Date().toISOString();
  const nextEntry = {
    name: session.name,
    nameKey: session.nameKey,
    seconds,
    time: formatRunTime(seconds),
    date: now,
  };

  const existingIndex = entries.findIndex((entry) => entry.nameKey === session.nameKey);
  if (existingIndex >= 0) {
    if (seconds >= entries[existingIndex].seconds) {
      return jsonResponse(200, {
        ok: true,
        updated: false,
        best: entries[existingIndex],
      });
    }
    entries[existingIndex] = nextEntry;
  } else {
    entries.push(nextEntry);
  }

  entries.sort((a, b) => a.seconds - b.seconds);
  await store.setJSON("global", entries.slice(0, MAX_GLOBAL));

  return jsonResponse(200, { ok: true, updated: true, entry: nextEntry });
}
