import { getStore } from "@netlify/blobs";
import { jsonResponse, handleOptions } from "../lib/http.mjs";

const MAX_GLOBAL = 50;

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return handleOptions();
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const store = getStore("mimu-vault-leaderboard");
  const entries = (await store.get("global", { type: "json" })) || [];

  const sorted = entries
    .filter((entry) => typeof entry?.seconds === "number")
    .sort((a, b) => a.seconds - b.seconds)
    .slice(0, MAX_GLOBAL);

  return jsonResponse(200, { ok: true, entries: sorted });
}
