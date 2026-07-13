/* ============================================
   Shared music player
   - Cycles through the full menu playlist (auto-advances on track end).
   - Persists track + position + play state across page navigation so the
     music keeps playing site-wide (menu, leaderboard, lore, sign-in, profile).
   - Wires the volume / mute / seek controls when they exist on the page.
   ============================================ */

export const MENU_TRACKS = [
  "assets/audio/deus-avarus-menu.mp3",
  "assets/audio/music/Something Down Here (Dark Male Version).mp3",
  "assets/audio/music/mixkit-ritual-synth-suspense-683.wav",
  "assets/audio/music/They Will Destroy instrumental.mp3",
  "assets/audio/music/Me-Moo Vault (1).mp3",
  "assets/audio/music/Greed.mp3",
];

// Tunable constants
const VOLUME_STORAGE_KEY = "mimuVaultMusicVolume";
const MUTE_STORAGE_KEY = "mimuVaultMusicMuted";
const IDX_KEY = "mimuVaultMusicIndex";
const TIME_KEY = "mimuVaultMusicTime";
const PLAYING_KEY = "mimuVaultMusicPlaying";
const SEEK_STEP = 10; // seconds
const SAVE_THROTTLE_MS = 900;
const DEFAULT_VOLUME = 0.7;

function readNum(store, key, fallback) {
  try {
    const v = store.getItem(key);
    if (v === null) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  } catch (e) {
    return fallback;
  }
}

// Module-scoped state
let initialized = false;
let el = null;
let currentSrc = "";
let index = 0;
let volume = DEFAULT_VOLUME;
let muted = false;
let wantPlaying = true;
let exclusive = false; // playing a one-off track (e.g. in-game theme), not the playlist
let lastSaveT = 0;
const volumeListeners = [];

// Optional controls (present only where the markup exists)
let volumeSlider = null;
let volumeLabel = null;
let volumeMuteBtn = null;
let rewindBtn = null;
let forwardBtn = null;
let sfx = null; // optional click-sfx callback

function effectiveVolume() {
  return muted ? 0 : volume;
}

function notifyVolume() {
  for (const cb of volumeListeners) {
    try {
      cb();
    } catch (e) {
      /* ignore listener errors */
    }
  }
}

function syncUI() {
  const pct = Math.round(volume * 100);
  if (volumeSlider) volumeSlider.value = String(pct);
  if (volumeLabel) volumeLabel.textContent = muted || pct === 0 ? "Off" : `${pct}%`;
  if (volumeMuteBtn) {
    volumeMuteBtn.classList.toggle("is-muted", muted || pct === 0);
    volumeMuteBtn.setAttribute(
      "aria-label",
      muted || pct === 0 ? "Unmute music" : "Mute music"
    );
  }
}

function applyVolume() {
  if (el) {
    el.volume = effectiveVolume();
    el.muted = muted || volume <= 0;
  }
  syncUI();
  notifyVolume();
}

function persistVolumeSettings() {
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch (e) {
    /* ignore storage errors */
  }
}

function persistPlayback(force = false) {
  if (exclusive || !el) return; // don't persist one-off tracks
  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  if (!force && now - lastSaveT < SAVE_THROTTLE_MS) return;
  lastSaveT = now;
  try {
    sessionStorage.setItem(IDX_KEY, String(index));
    sessionStorage.setItem(TIME_KEY, String(el.currentTime || 0));
    sessionStorage.setItem(PLAYING_KEY, wantPlaying ? "1" : "0");
  } catch (e) {
    /* ignore storage errors */
  }
}

function attemptPlay() {
  if (!el) return;
  if (muted || volume <= 0) {
    el.pause();
    return;
  }
  const p = el.play();
  if (p && typeof p.then === "function") {
    // Browsers block autoplay until a user gesture — resumes on unlock.
    p.catch(() => {});
  }
}

function loadTrack(path, { loop = false, time = 0, play = true } = {}) {
  if (!el) return;
  el.loop = loop;
  if (currentSrc !== path) {
    currentSrc = path;
    el.pause();
    el.src = path;
    el.load();
  }
  const applyTime = () => {
    if (time > 0) {
      const dur = el.duration;
      el.currentTime =
        Number.isFinite(dur) && dur > 0 ? Math.min(time, Math.max(0, dur - 0.3)) : time;
    }
    if (play && wantPlaying) attemptPlay();
  };
  if (time > 0 && !(Number.isFinite(el.duration) && el.duration > 0)) {
    el.addEventListener("loadedmetadata", applyTime, { once: true });
  } else {
    applyTime();
  }
}

function playIndex(i, time = 0) {
  exclusive = false;
  const len = MENU_TRACKS.length;
  index = ((i % len) + len) % len;
  loadTrack(MENU_TRACKS[index], { loop: false, time, play: true });
  persistPlayback(true);
}

function nextTrack() {
  playIndex(index + 1, 0);
}

function prevTrack() {
  playIndex(index - 1, 0);
}

function bindControls(opts = {}) {
  if (opts.sfx) sfx = opts.sfx;
  volumeSlider = document.getElementById("volume-slider");
  volumeLabel = document.getElementById("volume-label");
  volumeMuteBtn = document.getElementById("volume-mute-btn");
  rewindBtn = document.getElementById("music-rewind-btn");
  forwardBtn = document.getElementById("music-forward-btn");
  syncUI();

  if (volumeSlider && !volumeSlider.dataset.mpBound) {
    volumeSlider.dataset.mpBound = "1";
    volumeSlider.addEventListener("input", () =>
      musicPlayer.setVolume(Number(volumeSlider.value))
    );
  }
  if (volumeMuteBtn && !volumeMuteBtn.dataset.mpBound) {
    volumeMuteBtn.dataset.mpBound = "1";
    volumeMuteBtn.addEventListener("click", () => {
      if (sfx) sfx(volumeMuteBtn);
      musicPlayer.toggleMute();
    });
  }
  if (rewindBtn && !rewindBtn.dataset.mpBound) {
    rewindBtn.dataset.mpBound = "1";
    rewindBtn.addEventListener("click", () => {
      if (sfx) sfx(rewindBtn);
      musicPlayer.seek(-SEEK_STEP);
    });
  }
  if (forwardBtn && !forwardBtn.dataset.mpBound) {
    forwardBtn.dataset.mpBound = "1";
    forwardBtn.addEventListener("click", () => {
      if (sfx) sfx(forwardBtn);
      musicPlayer.seek(SEEK_STEP);
    });
  }
}

export const musicPlayer = {
  init(opts = {}) {
    if (initialized) {
      bindControls(opts);
      return this;
    }
    initialized = true;
    sfx = opts.sfx || null;

    volume = Math.min(1, Math.max(0, readNum(localStorage, VOLUME_STORAGE_KEY, DEFAULT_VOLUME)));
    try {
      muted = localStorage.getItem(MUTE_STORAGE_KEY) === "1";
    } catch (e) {
      muted = false;
    }
    index = Math.floor(readNum(sessionStorage, IDX_KEY, 0)) || 0;
    const time = Math.max(0, readNum(sessionStorage, TIME_KEY, 0));
    let playingStored = null;
    try {
      playingStored = sessionStorage.getItem(PLAYING_KEY);
    } catch (e) {
      playingStored = null;
    }
    wantPlaying = playingStored === null ? true : playingStored === "1";

    el = new Audio();
    el.preload = "auto";
    el.loop = false;
    applyVolume();

    el.addEventListener("ended", () => {
      if (!exclusive) nextTrack();
    });
    el.addEventListener("timeupdate", () => persistPlayback(false));
    window.addEventListener("pagehide", () => persistPlayback(true));
    window.addEventListener("beforeunload", () => persistPlayback(true));
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) persistPlayback(true);
    });

    bindControls(opts);

    // Restore the playlist track + position and try to resume.
    playIndex(index, time);

    const unlock = () => {
      if (wantPlaying) attemptPlay();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return this;
  },

  bindControls,

  setVolume(pct) {
    volume = Math.min(1, Math.max(0, pct / 100));
    if (volume > 0) muted = false;
    persistVolumeSettings();
    applyVolume();
    if (wantPlaying) attemptPlay();
  },

  toggleMute() {
    if (muted || volume <= 0) {
      muted = false;
      if (volume <= 0) volume = DEFAULT_VOLUME;
    } else {
      muted = true;
    }
    persistVolumeSettings();
    applyVolume();
    if (muted || volume <= 0) {
      if (el) el.pause();
    } else if (wantPlaying) {
      attemptPlay();
    }
  },

  seek(seconds) {
    if (!el) return;
    wantPlaying = true;
    const apply = () => {
      const dur = el.duration;
      let t = (el.currentTime || 0) + seconds;
      if (Number.isFinite(dur) && dur > 0) t = ((t % dur) + dur) % dur;
      else t = Math.max(0, t);
      el.currentTime = t;
      if (!muted && volume > 0) attemptPlay();
      persistPlayback(true);
    };
    if (Number.isFinite(el.duration) && el.duration > 0) {
      apply();
    } else {
      el.addEventListener("loadedmetadata", apply, { once: true });
      if (el.src) el.load();
    }
  },

  next: nextTrack,
  previous: prevTrack,

  /** Return to (or continue) the cycling menu playlist. */
  resumePlaylist() {
    wantPlaying = true;
    if (exclusive) {
      playIndex(index, 0);
    } else {
      attemptPlay();
    }
    persistPlayback(true);
  },

  /** Play a single track outside the playlist (e.g. the in-game theme). */
  playExclusive(path, { loop = true } = {}) {
    wantPlaying = true;
    exclusive = true;
    loadTrack(path, { loop, time: 0, play: true });
  },

  pause() {
    wantPlaying = false;
    if (el) el.pause();
    persistPlayback(true);
  },

  getVolume() {
    return volume;
  },
  isMuted() {
    return muted;
  },
  getEffectiveVolume() {
    return effectiveVolume();
  },
  onVolumeChange(cb) {
    if (typeof cb === "function") volumeListeners.push(cb);
  },
  get element() {
    return el;
  },
};

export default musicPlayer;
