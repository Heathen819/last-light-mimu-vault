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

export function updateAuthNav() {
  const link = document.getElementById("nav-auth-link");
  const signOutBtn = document.getElementById("nav-sign-out-btn");
  const session = getSession();

  if (link && link.tagName === "A") {
    link.textContent = session?.name ? session.name : "Sign In";
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
      setOpen(false);
    });
  }

  updateAuthNav();
}
