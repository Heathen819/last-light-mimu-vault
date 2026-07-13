import { initUiSfx, wireMenuDropdownSfx } from "./ui-sfx.js?v=3";
import {
  fetchGlobalLeaderboard,
  getSession,
  isSignedIn,
  signOut,
  submitGlobalScore,
} from "./auth.js?v=5";

export const LEADERBOARD_KEY = "mimuVaultLeaderboard";
const MAX_LEADERBOARD = 10;
const MAX_GLOBAL_LEADERBOARD = 50;

export function loadLeaderboard() {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function formatRunTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function recordLeaderboardRun(totalSeconds) {
  const entries = loadLeaderboard();
  entries.push({
    label: "Vault Escape",
    seconds: totalSeconds,
    time: formatRunTime(totalSeconds),
    date: new Date().toISOString(),
  });
  entries.sort((a, b) => a.seconds - b.seconds);
  localStorage.setItem(
    LEADERBOARD_KEY,
    JSON.stringify(entries.slice(0, MAX_LEADERBOARD))
  );

  if (isSignedIn()) {
    submitGlobalScore(totalSeconds).catch(() => {});
  }
}

function renderLeaderboardRows(entries, labelKey = "label") {
  if (!entries.length) return "";
  return entries
    .map(
      (entry, i) =>
        `<li><span class="rank">#${i + 1}</span><span>${entry[labelKey] || entry.name || "Runner"}</span><span>${entry.time}</span></li>`
    )
    .join("");
}

export function renderLeaderboard(container) {
  if (!container) return;
  const entries = loadLeaderboard();
  if (!entries.length) {
    container.innerHTML =
      '<p class="site-menu-leaderboard-empty">No escapes recorded yet. Beat the vault to claim the first spot.</p>';
    return;
  }

  const rows = renderLeaderboardRows(entries);
  container.innerHTML = `<ol class="site-menu-leaderboard-list">${rows}</ol>`;
}

export async function renderGlobalLeaderboard(container, statusEl) {
  if (!container) return;

  if (statusEl) {
    const session = getSession();
    if (session?.name && session.mode === "local") {
      statusEl.textContent =
        `Signed in as ${session.name} (device-only mode). Redeploy with Netlify Functions for a shared global board.`;
    } else if (session?.name) {
      statusEl.textContent =
        `Signed in as ${session.name}. Your best escape posts here automatically.`;
    } else {
      statusEl.textContent =
        "Sign in to post your escape times on the global board.";
    }
  }

  container.innerHTML =
    '<p class="site-menu-leaderboard-empty">Loading global scores…</p>';

  try {
    const entries = await fetchGlobalLeaderboard();
    if (!entries.length) {
      container.innerHTML =
        '<p class="site-menu-leaderboard-empty">No global escapes yet. Be the first to beat the vault.</p>';
      return;
    }

    const rows = renderLeaderboardRows(
      entries.slice(0, MAX_GLOBAL_LEADERBOARD),
      "name"
    );
    container.innerHTML = `<ol class="site-menu-leaderboard-list">${rows}</ol>`;
  } catch {
    container.innerHTML =
      '<p class="site-menu-leaderboard-empty">Global leaderboard unavailable. Deploy with Netlify Functions enabled, or try again later.</p>';
  }
}

/* ---------- Avatars (4 preset marks + custom upload) ---------- */

export const AVATARS = [
  { id: "basic", label: "Basic", img: "assets/avatars/basic.png?v=1" },
  { id: "monster", label: "Monster", img: "assets/avatars/monster.png?v=1" },
  { id: "silver", label: "Silver", img: "assets/avatars/silver.png?v=1" },
  { id: "wood", label: "Wood", img: "assets/avatars/wood.png?v=1" },
  { id: "gold", label: "Gold", img: "assets/avatars/gold.png?v=1" },
];

function avatarUserKey(session) {
  return (session?.nameKey || session?.name || "").toLowerCase();
}
function avatarPrefKey(session) {
  return `mimuVaultAvatar:${avatarUserKey(session)}`;
}
function avatarImgKey(session) {
  return `mimuVaultAvatarImg:${avatarUserKey(session)}`;
}

/** Returns { type: "preset"|"custom", preset, imageUrl }. */
export function getAvatarState(session) {
  try {
    const id = localStorage.getItem(avatarPrefKey(session));
    if (id === "custom") {
      const imageUrl = localStorage.getItem(avatarImgKey(session));
      if (imageUrl) return { type: "custom", preset: AVATARS[0], imageUrl };
    }
    const preset = AVATARS.find((a) => a.id === id) || AVATARS[0];
    return { type: "preset", preset, imageUrl: null };
  } catch {
    return { type: "preset", preset: AVATARS[0], imageUrl: null };
  }
}

export function savePresetAvatar(session, id) {
  try {
    localStorage.setItem(avatarPrefKey(session), id);
  } catch {
    /* ignore storage errors */
  }
}

export function saveCustomAvatar(session, dataUrl) {
  try {
    localStorage.setItem(avatarImgKey(session), dataUrl);
    localStorage.setItem(avatarPrefKey(session), "custom");
  } catch {
    /* ignore storage errors (quota) */
  }
}

/** Paint an avatar (custom upload or preset character art) into an element. */
export function applyAvatarTo(el, state) {
  if (!el) return;
  const url =
    state?.type === "custom" && state.imageUrl
      ? state.imageUrl
      : (state?.preset || AVATARS[0]).img;
  el.textContent = "";
  el.style.background = "#0a0714";
  el.style.backgroundImage = `url("${url}")`;
  el.style.backgroundSize = "cover";
  el.style.backgroundPosition = "center";
  el.classList.add("has-image");
}

/**
 * Glow-style account chip (pfp + name + best time) that links to the profile
 * page. Renders a "Sign In" pill when signed out. No-ops when the slot is
 * absent, so it is safe to call on every page.
 */
export async function renderAccountChip(slot) {
  const chipEl =
    typeof slot === "string" ? document.getElementById(slot) : slot;
  if (!chipEl) return;

  const session = getSession();
  if (!session?.name) {
    chipEl.innerHTML =
      '<a class="account-chip account-chip--signin" href="sign-in.html">' +
      '<span class="account-chip-pfp account-chip-pfp--add" aria-hidden="true">+</span>' +
      '<span class="account-chip-text"><span class="account-chip-name">Sign In</span>' +
      '<span class="account-chip-score">Create a profile</span></span></a>';
    return;
  }

  chipEl.innerHTML =
    '<a class="account-chip" href="profile.html" aria-label="View and edit your profile">' +
    '<span class="account-chip-pfp" id="account-chip-pfp" aria-hidden="true"></span>' +
    `<span class="account-chip-text"><span class="account-chip-name">${session.name}</span>` +
    '<span class="account-chip-score" id="account-chip-score">Best —</span></span></a>';

  applyAvatarTo(document.getElementById("account-chip-pfp"), getAvatarState(session));

  try {
    const entries = await fetchGlobalLeaderboard();
    const key = avatarUserKey(session);
    const entry = entries.find(
      (e) => (e.nameKey || e.name || "").toLowerCase() === key
    );
    const scoreEl = document.getElementById("account-chip-score");
    if (scoreEl) {
      scoreEl.textContent = entry?.time ? `Best ${entry.time}` : "No time yet";
    }
  } catch {
    /* leave "Best —" if the board is unavailable */
  }
}

export function updateAuthNav() {
  const slot = document.getElementById("nav-account-slot");
  const signOutBtn = document.getElementById("nav-sign-out-btn");
  const session = getSession();

  // Top of the drawer: signed in shows the player's pfp (+ name) linking to
  // their profile; signed out shows a "Sign In" entry.
  if (slot) {
    if (session?.name) {
      slot.innerHTML =
        '<a class="menu-account" href="profile.html" aria-label="View your profile">' +
        '<span class="menu-account-pfp" id="nav-account-pfp" aria-hidden="true"></span>' +
        `<span class="menu-account-name">${session.name}</span></a>`;
      applyAvatarTo(
        document.getElementById("nav-account-pfp"),
        getAvatarState(session)
      );
    } else {
      slot.innerHTML =
        '<a class="menu-dropdown-item" href="sign-in.html">Sign In</a>';
    }
  }

  if (signOutBtn) {
    signOutBtn.hidden = !session?.name;
  }
}

export function initMenuDrawer() {
  initUiSfx();
  wireMenuDropdownSfx();

  const dropdown = document.querySelector(".menu-dropdown");
  const toggle = document.getElementById("site-menu-toggle");
  const drawer = document.getElementById("site-menu-drawer");
  if (!dropdown || !toggle || !drawer) return;

  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
    dropdown.classList.toggle("is-open", open);
  };

  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(toggle.getAttribute("aria-expanded") !== "true");
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.classList.contains("is-open")) return;
    if (e.target.closest(".menu-dropdown")) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  const signOutBtn = document.getElementById("nav-sign-out-btn");
  if (signOutBtn && signOutBtn.dataset.wired !== "1") {
    signOutBtn.dataset.wired = "1";
    signOutBtn.addEventListener("click", () => {
      // Guest play is allowed, so signing out just drops the account and keeps
      // you where you are — the menu updates in place to show "Sign In".
      signOut();
      updateAuthNav();
      renderAccountChip("account-chip-slot");
      setOpen(false);
    });
  }

  updateAuthNav();
  renderAccountChip("account-chip-slot");
}
