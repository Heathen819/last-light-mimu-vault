const BUTTON_PUSH_SFX =
  "assets/audio/sfx/mixkit-positive-game-alert-3151.wav";
const UI_SFX_VOLUME = 0.9;
const SFX_DEDUPE_MS = 320;

let sfxReady = false;
let audioUnlocked = false;
const audioPool = [];
let poolCursor = 0;
let lastSfxTarget = null;
let lastSfxAt = 0;

function ensureAudioPool() {
  if (audioPool.length) return;
  for (let i = 0; i < 4; i += 1) {
    const audio = new Audio(BUTTON_PUSH_SFX);
    audio.preload = "auto";
    audioPool.push(audio);
  }
}

function unlockAudioOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  ensureAudioPool();
  const warm = audioPool[0];
  const warmPlay = warm.play();
  if (warmPlay && typeof warmPlay.then === "function") {
    warmPlay
      .then(() => {
        warm.pause();
        warm.currentTime = 0;
      })
      .catch(() => {});
  }
}

function shouldDedupe(target) {
  const now = performance.now();
  if (target && target === lastSfxTarget && now - lastSfxAt < SFX_DEDUPE_MS) {
    return true;
  }
  lastSfxTarget = target;
  lastSfxAt = now;
  return false;
}

function playUiSfx(src, dedupeTarget = null) {
  if (dedupeTarget && shouldDedupe(dedupeTarget)) return;
  ensureAudioPool();
  const audio = audioPool[poolCursor % audioPool.length];
  poolCursor += 1;
  audio.muted = false;
  audio.volume = UI_SFX_VOLUME;
  audio.currentTime = 0;
  const play = audio.play();
  if (play && typeof play.catch === "function") {
    play.catch(() => {});
  }
}

export function playButtonPushSfx(dedupeTarget = null) {
  playUiSfx(BUTTON_PUSH_SFX, dedupeTarget);
}

function isUiClickable(target) {
  if (!(target instanceof Element)) return null;
  if (target.closest("#play-btn")) return null;
  if (target.closest("#volume-slider")) return null;

  const clickable = target.closest(
    [
      "button",
      "a[href]",
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="reset"]',
      ".site-page-back",
      ".menu-corner-stack",
    ].join(",")
  );
  if (!clickable) return null;
  if (clickable.id === "play-btn" || clickable.closest("#play-btn")) return null;
  if (clickable.classList.contains("menu-dropdown-item")) return null;
  if (clickable.classList.contains("is-current")) return null;
  return clickable;
}

function handleUiPointer(e) {
  unlockAudioOnce();
  const clickable = isUiClickable(e.target);
  if (!clickable) return;
  playButtonPushSfx(clickable);
}

export function initUiSfx() {
  if (sfxReady) return;
  sfxReady = true;
  ensureAudioPool();

  document.addEventListener("pointerdown", handleUiPointer, true);
  document.addEventListener("click", handleUiPointer, true);
  document.addEventListener("pointerdown", unlockAudioOnce, true);
}

export function wireMenuDropdownSfx(root = document) {
  const links = root.querySelectorAll("a.menu-dropdown-item[href]");
  links.forEach((link) => {
    if (!(link instanceof HTMLAnchorElement)) return;
    if (link.dataset.menuSfxBound === "1") return;
    link.dataset.menuSfxBound = "1";

    link.addEventListener(
      "pointerdown",
      () => {
        unlockAudioOnce();
        playButtonPushSfx(link);
      },
      true
    );

    link.addEventListener("click", (e) => {
      unlockAudioOnce();
      playButtonPushSfx(link);

      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (link.target === "_blank") return;

      const href = link.getAttribute("href");
      if (!href || /^https?:\/\//i.test(href)) return;

      e.preventDefault();
      const destination = link.href;
      window.setTimeout(() => {
        window.location.assign(destination);
      }, 150);
    });
  });
}
