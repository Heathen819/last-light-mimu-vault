/* ============================================
   Last Light: Mimu Vault
   First-person cozy-horror prototype
   Canvas raycaster + optional Three.js player
   ============================================ */

import { createEnemySprite } from "./enemysprite.js?v=null3";
import { initMenuDrawer, recordLeaderboardRun } from "./site-nav.js?v=auth_9";
import { initUiSfx, playButtonPushSfx } from "./ui-sfx.js?v=4";
import { musicPlayer } from "./music-player.js?v=2";
import { createProximityMap } from "./proximity-map.js?v=2";
import {
  createPlacementEditor,
  shouldAutoOpenPlacementEditor,
} from "./placement-editor.js?v=11";

(() => {
  "use strict";

  // ============================================
  // CONSTANTS
  // ============================================

  /** false = 2D PNG avatar. true = 3D banker + torch */
  const USE_3D_PLAYER = true;
  /** true = Three.js maze world on #game; false = canvas raycaster walls */
  const USE_3D_WORLD = true;

  const CANVAS_W = 960;
  const CANVAS_H = 540;

  // Movement (map units = one tile)
  const MOVE_SPEED = 3.2;
  const STRAFE_SPEED = 2.6;
  const TURN_SPEED = 2.4; // radians per second
  const MOUSE_LOOK_SENS = 0.0022;
  const PITCH_MIN = -0.55;
  const PITCH_MAX = 1.15;
  const PITCH_DEFAULT = -0.04;
  const PLAYER_RADIUS = 0.22;

  // Light / flame
  const LIGHT_MAX = 100;
  const LIGHT_RECHARGE_PER_SEC = 16;
  const CARRY_FLAME_FACTOR = 0.65;
  const CARRY_FLAME_MIN = 30;
  const VIEW_DIST_MIN = 5.8;
  const VIEW_DIST_MAX = 8.8;

  /** World stays steadier; torch sprite carries blue / orange / red cues. */
  const LIGHTING = {
    viewDistCurve: 0.5,
    wallFogStrength: 0.76,
    warmWallStrength: 0.32,
    vignetteInner: 0.14,
    vignetteOuter: 0.52,
    vignetteDarken: 0.07,
    flameSmoothRate: 5.5,
    cueDotThreshold: 0.22,
    cueFadeMin: 0.08,
    avatarFilter: "brightness(0.74) contrast(1.1) saturate(0.95)",
  };

  // Interactions (map units)
  const LANTERN_INTERACT_RANGE = 1.15;
  const LANTERN_RECHARGE_RANGE = 2.1;
  const EXIT_INTERACT_RANGE = 1.2;

  // Nulls (variant GLBs loaded by world3d.js)
  const NULL_GLB = "assets/enemies/purple_Null_decimated_small.glb";
  const SHADOW_RADIUS = 0.35;
  const SHADOW_DEAGGRO_RANGE = 5.2;
  const SHADOW_CHASE_COOLDOWN = 2.4;
  const SHADOW_FLOAT_AMP = 0.14;
  const SHADOW_TOUCH_RANGE = 0.42;
  /** Nulls refuse to enter this radius around a lit lantern. */
  const NULL_LANTERN_AVOID_RANGE = 2.75;
  /** Start steering away from lit lanterns within this radius. */
  const NULL_LANTERN_FLEE_RANGE = 4.0;

  // Raycaster
  const FOV = Math.PI / 3; // 60 degrees
  const NUM_RAYS = CANVAS_W; // one ray per column (can lower for speed)
  const MAX_DEPTH = 16;

  // Colors
  const GOLD = "#ffc857";
  const GOLD_SOFT = "#ffe8a3";
  const CEILING = "#0a0614";
  const FLOOR_NEAR = "#1a1430";
  const FLOOR_FAR = "#08060f";

  // ============================================
  // DOM / CANVAS
  // ============================================

  const canvas = document.getElementById("game");
  let ctx = null;
  if (!USE_3D_WORLD) {
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
  }

  // Three.js player — only loaded when USE_3D_PLAYER is true
  const player3dCanvas = document.getElementById("player3d");
  if (player3dCanvas) {
    const showPlayerLayer = USE_3D_PLAYER || USE_3D_WORLD;
    player3dCanvas.style.display = showPlayerLayer ? "block" : "none";
    player3dCanvas.style.visibility = USE_3D_PLAYER ? "hidden" : "visible";
  }
  const flameBloomCanvas = document.getElementById("flameBloom");
  const flameBloomCtx = flameBloomCanvas
    ? flameBloomCanvas.getContext("2d")
    : null;
  let player3d = null;
  let world3d = null;
  let avatarCtx = null;
  let placementEditor = null;

  async function initPlayer3D() {
    if (!USE_3D_PLAYER || !player3dCanvas) return;
    const { createPlayer3D } = await import("./player3d.js?v=avatar19");
    player3d = createPlayer3D(player3dCanvas);
    window.__player3d = player3d;
    syncViewportSize();
  }

  // The baked 2D sprite is only drawn by the legacy 2D renderer. In 3D mode
  // world3d.js loads the Null GLBs itself, so skip the extra download + bake.
  const enemySprite = USE_3D_WORLD ? null : createEnemySprite();
  window.__enemySprite = enemySprite;

  // PNG fallback
  const playerSprite = new Image();
  playerSprite.src = "assets/player/mimu-fp.png?v=banker2d1";
  let playerSpriteReady = false;
  let playerSpriteCanvas = null;

  playerSprite.onload = () => {
    const w = playerSprite.naturalWidth;
    const h = playerSprite.naturalHeight;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const octx = off.getContext("2d");
    octx.clearRect(0, 0, w, h);
    octx.drawImage(playerSprite, 0, 0);
    playerSpriteCanvas = off;
    playerSpriteReady = true;
  };

  function overlaySize() {
    const w = flameBloomCanvas ? flameBloomCanvas.width : CANVAS_W;
    const h = flameBloomCanvas ? flameBloomCanvas.height : CANVAS_H;
    return { w, h };
  }

  function syncViewportSize() {
    const rect = canvas.getBoundingClientRect();
    let w = Math.round(rect.width);
    let h = Math.round(rect.height);
    // Hidden menu layout reports 0×0 — don't shrink the buffer to 2×2 or the
    // CSS height:auto canvas locks into a tiny/square intrinsic ratio.
    if (w < 4) return;
    if (h < 4) h = Math.round(w * (CANVAS_H / CANVAS_W));
    if (world3d) world3d.resize(w, h);
    if (player3d) player3d.resize(w, h);
    if (flameBloomCanvas) {
      flameBloomCanvas.width = w;
      flameBloomCanvas.height = h;
    }
    if (USE_3D_WORLD && player3dCanvas && !USE_3D_PLAYER) {
      player3dCanvas.width = w;
      player3dCanvas.height = h;
    }
  }
  window.addEventListener("resize", syncViewportSize);
  requestAnimationFrame(syncViewportSize);

  const lightFillEl = document.getElementById("light-meter-fill");
  const lightPercentEl = document.getElementById("light-percent");
  const lanternCountEl = document.getElementById("lantern-count");
  const lanternRemainingEl = document.getElementById("lantern-remaining");
  const lanternHudCountEl = document.getElementById("lantern-hud-count");
  const lanternHudRemainingEl = document.getElementById("lantern-hud-remaining");
  const overlayEl = document.getElementById("overlay");
  const overlayCardEl = document.getElementById("overlay-card");
  const overlayTitleEl = document.getElementById("overlay-title");
  const overlayMessageEl = document.getElementById("overlay-message");
  const restartBtn = document.getElementById("restart-btn");
  const continueBtn = document.getElementById("continue-btn");
  const promptEl = document.getElementById("world-prompt");
  const proxMapWrapEl = document.getElementById("proximity-map-wrap");
  const proxMapCanvas = document.getElementById("proximity-map");
  const levelIndicatorEl = document.getElementById("level-indicator");
  const levelTimerEl = document.getElementById("level-timer");
  const levelTransitionEl = document.getElementById("level-transition");
  const levelTransitionTitleEl = document.getElementById("level-transition-title");

  const mainMenuEl = document.getElementById("main-menu");
  const menuLogoVideoEl = document.getElementById("menu-logo-video");
  const gameUiEl = document.getElementById("game-ui");
  const playBtn = document.getElementById("play-btn");
  const menuBtn = document.getElementById("menu-btn");
  const runeBorderEl = document.querySelector(".mimu-rune-border");

  // Depth buffer: closest wall distance per screen column (for sprite occlusion)
  const zBuffer = new Float32Array(NUM_RAYS);

  // ============================================
  // AUDIO — shared menu playlist (music-player.js) + in-game theme & ambience
  // ============================================

  const GAME_TRACK = "assets/audio/music/Vault of Echoes in-game.mp3";
  const LEVEL_AMBIENCE =
    "assets/audio/sfx/mixkit-creepy-cavern-ambience-loop-2492.wav";
  const ENTER_VAULT_SFX =
    "assets/audio/sfx/mixkit-heavy-sword-hit-2794.wav";
  const LANTERN_LIGHT_SFX =
    "assets/audio/mixkit-fire-swoosh-burning-1328.wav";
  const NULL_BREATH_SFX =
    "assets/audio/mixkit-single-zombie-breath-2233.wav";
  const UI_SFX_VOLUME = 0.9;
  const LANTERN_SFX_VOLUME = 0.85;
  const AMBIENT_MIX = 0.52;
  /** Null breath: full volume inside this distance, silent beyond hear range. */
  const NULL_BREATH_FULL_RANGE = 0.85;
  const NULL_BREATH_HEAR_RANGE = 5.0;
  const NULL_BREATH_MIX = 0.7;

  const ambient = {
    el: new Audio(LEVEL_AMBIENCE),
    wantPlaying: false,
  };
  ambient.el.loop = true;
  ambient.el.preload = "auto";

  const nullBreath = {
    el: new Audio(NULL_BREATH_SFX),
  };
  nullBreath.el.loop = true;
  nullBreath.el.preload = "auto";
  nullBreath.el.volume = 0;

  // Enter Vault / lantern light use their own SFX; clicks are in ui-sfx.js.
  const uiSfx = {
    enterVault: new Audio(ENTER_VAULT_SFX),
    lanternLight: new Audio(LANTERN_LIGHT_SFX),
  };
  uiSfx.enterVault.preload = "auto";
  uiSfx.lanternLight.preload = "auto";

  function playEnterVaultSfx() {
    if (!uiSfx.enterVault) return;
    uiSfx.enterVault.currentTime = 0;
    uiSfx.enterVault.muted = false;
    uiSfx.enterVault.volume = UI_SFX_VOLUME;
    uiSfx.enterVault.play().catch(() => {});
  }

  function playLanternLightSfx() {
    if (!uiSfx.lanternLight || musicPlayer.isMuted()) return;
    uiSfx.lanternLight.currentTime = 0;
    uiSfx.lanternLight.muted = false;
    uiSfx.lanternLight.volume =
      musicPlayer.getEffectiveVolume() * LANTERN_SFX_VOLUME;
    uiSfx.lanternLight.play().catch(() => {});
  }

  function applyAmbientVolume() {
    if (!ambient.el) return;
    const vol = musicPlayer.getEffectiveVolume() * AMBIENT_MIX;
    ambient.el.volume = vol;
    ambient.el.muted = musicPlayer.isMuted() || vol <= 0;
  }

  function startAmbient() {
    if (!ambient.el) return;
    ambient.wantPlaying = true;
    applyAmbientVolume();
    if (musicPlayer.isMuted() || musicPlayer.getVolume() <= 0) {
      ambient.el.pause();
      return;
    }
    const play = ambient.el.play();
    if (play && typeof play.then === "function") {
      play.catch(() => {});
    }
  }

  function stopAmbient() {
    ambient.wantPlaying = false;
    if (!ambient.el) return;
    ambient.el.pause();
    ambient.el.currentTime = 0;
  }

  function stopNullBreath() {
    if (!nullBreath.el) return;
    nullBreath.el.pause();
    nullBreath.el.currentTime = 0;
    nullBreath.el.volume = 0;
  }

  /** Looping Null breath — louder the closer the nearest Null is. */
  function updateNullBreathAudio() {
    const el = nullBreath.el;
    if (!el) return;

    if (state.status !== "playing" || musicPlayer.isMuted()) {
      if (!el.paused) el.pause();
      el.volume = 0;
      return;
    }

    let nearest = Infinity;
    for (const shadow of state.shadows) {
      const d = dist(state.player.x, state.player.y, shadow.x, shadow.y);
      if (d < nearest) nearest = d;
    }

    if (!Number.isFinite(nearest) || nearest >= NULL_BREATH_HEAR_RANGE) {
      if (!el.paused) el.pause();
      el.volume = 0;
      return;
    }

    const span = Math.max(0.001, NULL_BREATH_HEAR_RANGE - NULL_BREATH_FULL_RANGE);
    const t = Math.max(
      0,
      Math.min(1, (NULL_BREATH_HEAR_RANGE - nearest) / span)
    );
    const vol = t * t * musicPlayer.getEffectiveVolume() * NULL_BREATH_MIX;
    el.volume = vol;
    el.muted = false;

    if (vol > 0.01 && el.paused) {
      el.play().catch(() => {});
    } else if (vol <= 0.01 && !el.paused) {
      el.pause();
    }
  }

  initUiSfx();
  musicPlayer.init({ sfx: playButtonPushSfx });
  // Keep cavern ambience volume/mute in sync with the music controls.
  musicPlayer.onVolumeChange(applyAmbientVolume);

  initMenuDrawer();

  // ============================================
  // LEVEL DATA — N-level vault floors
  // 0 = floor, 1 = wall
  // ============================================

  // Disc maze: 2-tile passages, 1-tile walls. Append LEVELS entries for new floors.
  const MAZE_PASSAGE = 2;
  const MAZE_WALL = 1;
  const MAZE_PERIOD = MAZE_PASSAGE + MAZE_WALL;
  const LANTERN_MIN_FROM_SPAWN = 3;
  const LANTERN_MIN_FROM_EXIT = 2;
  const LANTERN_MIN_PAIRWISE = 3;
  const NULL_MIN_FROM_SPAWN = 3;
  const NULL_MIN_FROM_LANTERN = 2;
  const NULL_MIN_PAIRWISE = 2;

  const LEVELS = [
    {
      id: 1,
      label: "Level 1 · Outer Vault",
      clearTitle: "Outer Vault Cleared",
      clearMessage:
        "The outer chamber yields. Deeper halls wait beyond the sealed door.",
      transitionTitle: "Descending into the Deep Vault…",
      mazeCells: 9,
      spawnCell: [4, 8],
      exitCell: [4, 0],
      lanternCount: 5,
      nullCount: 5,
      lightDrainPerSec: 1.0,
      shadowChaseSpeed: 1.0,
      shadowWanderSpeed: 0.5,
      shadowDamagePerSec: 11,
      shadowAggroRange: 2.9,
    },
    {
      id: 2,
      label: "Level 2 · Deep Vault",
      clearTitle: "Deep Vault Cleared",
      clearMessage:
        "The deep vault falls quiet. The Heart of the Vault waits below.",
      transitionTitle: "Descending into the Heart of the Vault…",
      mazeCells: 11,
      spawnCell: [5, 10],
      exitCell: [5, 0],
      lanternCount: 7,
      nullCount: 7,
      lightDrainPerSec: 1.35,
      shadowChaseSpeed: 1.25,
      shadowWanderSpeed: 0.58,
      shadowDamagePerSec: 14,
      shadowAggroRange: 3.1,
    },
    {
      id: 3,
      label: "Level 3 · Heart of the Vault",
      clearTitle: "Heart of the Vault Cleared",
      clearMessage: "The last chamber yields. The door waits with your flame.",
      transitionTitle: "The Heart consumes the light…",
      mazeCells: 13,
      spawnCell: [6, 12],
      exitCell: [6, 0],
      lanternCount: 8,
      nullCount: 9,
      // Softer than first pass — still harder than L2, but enough runway to a lantern.
      lightDrainPerSec: 1.48,
      shadowChaseSpeed: 1.45,
      shadowWanderSpeed: 0.65,
      shadowDamagePerSec: 16,
      shadowAggroRange: 3.4,
      /** Arrive from L2 thinner than L1→L2, but not starving. */
      carryFlameFactor: 0.55,
      carryFlameMin: 40,
      /** Slightly shorter torch than L1/L2. */
      torchReachScale: 0.9,
    },
  ];

  let currentLevelIndex = 0;
  const levelTimesSec = [];
  let levelStartedAt = 0;
  /** Accumulated ms the level timer spent paused (edit mode). */
  let levelTimerPausedMs = 0;
  /** performance.now() when the current edit-pause started, or 0. */
  let levelTimerPauseStartedAt = 0;
  let transitionTimerIds = [];

  /**
   * Local-only level skip for development. Never enabled on Netlify / public hosts.
   * Use menu picker or ?level=1|2|3 on localhost / 127.0.0.1.
   */
  function isLocalDevHost() {
    const h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  let debugStartLevelIndex = 0;

  function readDebugLevelFromUrl() {
    if (!isLocalDevHost()) return 0;
    const n = parseInt(new URLSearchParams(location.search).get("level"), 10);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(LEVELS.length - 1, n - 1));
  }

  function mountDevLevelPicker() {
    if (!isLocalDevHost() || !mainMenuEl) return;
    if (document.getElementById("dev-level-picker")) return;

    debugStartLevelIndex = readDebugLevelFromUrl();

    const wrap = document.createElement("div");
    wrap.id = "dev-level-picker";
    wrap.className = "dev-level-picker";
    wrap.setAttribute("aria-label", "Developer level select");

    const label = document.createElement("span");
    label.className = "dev-level-picker-label";
    label.textContent = "Dev · start level";
    wrap.appendChild(label);

    const row = document.createElement("div");
    row.className = "dev-level-picker-row";

    LEVELS.forEach((L, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dev-level-picker-btn";
      btn.dataset.levelIndex = String(i);
      btn.textContent = String(L.id);
      btn.title = L.label;
      btn.setAttribute("aria-pressed", i === debugStartLevelIndex ? "true" : "false");
      if (i === debugStartLevelIndex) btn.classList.add("is-selected");
      btn.addEventListener("click", () => {
        debugStartLevelIndex = i;
        row.querySelectorAll(".dev-level-picker-btn").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-selected", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
        const url = new URL(location.href);
        url.searchParams.set("level", String(L.id));
        history.replaceState(null, "", url);
      });
      row.appendChild(btn);
    });

    wrap.appendChild(row);
    const playBtn = mainMenuEl.querySelector("#play-btn");
    if (playBtn && playBtn.parentElement) {
      playBtn.parentElement.insertBefore(wrap, playBtn);
    } else {
      mainMenuEl.appendChild(wrap);
    }
  }

  const levelRuntime = {
    lightDrainPerSec: 1.0,
    shadowChaseSpeed: 1.0,
    shadowWanderSpeed: 0.5,
    shadowDamagePerSec: 11,
    shadowAggroRange: 2.9,
    torchReachScale: 1,
  };

  function activeLevel() {
    return LEVELS[currentLevelIndex];
  }

  function nextLevel() {
    return LEVELS[currentLevelIndex + 1] || null;
  }

  function isLastLevel() {
    return currentLevelIndex >= LEVELS.length - 1;
  }

  function syncLevelRuntime() {
    const L = activeLevel();
    levelRuntime.lightDrainPerSec = L.lightDrainPerSec;
    levelRuntime.shadowChaseSpeed = L.shadowChaseSpeed;
    levelRuntime.shadowWanderSpeed = L.shadowWanderSpeed;
    levelRuntime.shadowDamagePerSec = L.shadowDamagePerSec;
    levelRuntime.shadowAggroRange = L.shadowAggroRange;
    levelRuntime.torchReachScale =
      L.torchReachScale != null ? L.torchReachScale : 1;
  }

  function mazeGeom(level = activeLevel()) {
    const cells = level.mazeCells;
    const grid = MAZE_WALL + cells * MAZE_PERIOD;
    const center = (grid - 1) / 2;
    return { cells, grid, center, maskRadius: center };
  }

  function randomMazeSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  function cellIncluded(cx, cy, geom = mazeGeom()) {
    if (cx < 0 || cy < 0 || cx >= geom.cells || cy >= geom.cells) return false;
    const bx = (MAZE_PASSAGE - 1) / 2 + MAZE_WALL + cx * MAZE_PERIOD;
    const by = (MAZE_PASSAGE - 1) / 2 + MAZE_WALL + cy * MAZE_PERIOD;
    return Math.hypot(bx - geom.center, by - geom.center) <= geom.maskRadius;
  }

  let includedCells = [];

  function rebuildIncludedCells() {
    const geom = mazeGeom();
    const cells = [];
    for (let cy = 0; cy < geom.cells; cy++) {
      for (let cx = 0; cx < geom.cells; cx++) {
        if (cellIncluded(cx, cy, geom)) cells.push([cx, cy]);
      }
    }
    includedCells = cells;
  }

  const cellDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function shuffledCells(pool) {
    const arr = pool.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickSpreadCells(count, avoid, minPairwise, pool = includedCells) {
    const source = pool.length ? pool : includedCells;
    for (let relax = 0; relax <= 6; relax++) {
      const mp = Math.max(0, minPairwise - relax);
      for (let attempt = 0; attempt < 200; attempt++) {
        const chosen = [];
        for (const cell of shuffledCells(source)) {
          if (chosen.length >= count) break;
          const okAvoid = avoid.every(
            (a) => cellDist(a.cell, cell) >= Math.max(0, a.min - relax)
          );
          if (!okAvoid) continue;
          if (chosen.some((c) => cellDist(c, cell) < mp)) continue;
          chosen.push(cell);
        }
        if (chosen.length >= count) return chosen;
      }
    }
    return shuffledCells(source).slice(0, count);
  }

  function openFloorCells() {
    // Only place entities on maze cells whose passage tile is actually carved.
    return includedCells.filter(([cx, cy]) => {
      const t = cellFloorTile(cx, cy);
      return (
        t.row >= 0 &&
        t.col >= 0 &&
        t.row < MAP_ROWS &&
        t.col < MAP_COLS &&
        LEVEL_MAP[t.row][t.col] === 0
      );
    });
  }

  function pickEntityCells() {
    const L = activeLevel();
    const pool = openFloorCells();
    const lanterns = pickSpreadCells(
      L.lanternCount,
      [
        { cell: L.spawnCell, min: LANTERN_MIN_FROM_SPAWN },
        { cell: L.exitCell, min: LANTERN_MIN_FROM_EXIT },
      ],
      LANTERN_MIN_PAIRWISE,
      pool
    );
    const nulls = pickSpreadCells(
      L.nullCount,
      [
        { cell: L.spawnCell, min: NULL_MIN_FROM_SPAWN },
        ...lanterns.map((cell) => ({ cell, min: NULL_MIN_FROM_LANTERN })),
      ],
      NULL_MIN_PAIRWISE,
      pool.filter(
        (cell) =>
          !lanterns.some(
            (l) => l[0] === cell[0] && l[1] === cell[1]
          )
      )
    );
    return { lanterns, nulls };
  }

  let activeLanternCells = [];
  let activeNullCells = [];

  function mazeRng(seed) {
    let a = seed;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cellFloorTile(cellX, cellY) {
    return {
      col: MAZE_WALL + cellX * MAZE_PERIOD,
      row: MAZE_WALL + cellY * MAZE_PERIOD,
    };
  }

  function generateVaultMaze(seed) {
    const L = activeLevel();
    const geom = mazeGeom(L);
    const map = Array.from({ length: geom.grid }, () =>
      new Array(geom.grid).fill(1)
    );

    const carveBlock = (cx, cy) => {
      const x0 = MAZE_WALL + cx * MAZE_PERIOD;
      const y0 = MAZE_WALL + cy * MAZE_PERIOD;
      for (let y = 0; y < MAZE_PASSAGE; y++)
        for (let x = 0; x < MAZE_PASSAGE; x++) map[y0 + y][x0 + x] = 0;
    };

    const carveWall = (cx, cy, dx, dy) => {
      const x0 = MAZE_WALL + cx * MAZE_PERIOD;
      const y0 = MAZE_WALL + cy * MAZE_PERIOD;
      if (dx === 1)
        for (let y = 0; y < MAZE_PASSAGE; y++) map[y0 + y][x0 + MAZE_PASSAGE] = 0;
      if (dx === -1)
        for (let y = 0; y < MAZE_PASSAGE; y++) map[y0 + y][x0 - 1] = 0;
      if (dy === 1)
        for (let x = 0; x < MAZE_PASSAGE; x++) map[y0 + MAZE_PASSAGE][x0 + x] = 0;
      if (dy === -1)
        for (let x = 0; x < MAZE_PASSAGE; x++) map[y0 - 1][x0 + x] = 0;
    };

    const rng = mazeRng(seed);
    const visited = Array.from({ length: geom.cells }, () =>
      new Array(geom.cells).fill(false)
    );
    const [startX, startY] = L.spawnCell;
    const stack = [[startX, startY]];
    visited[startY][startX] = true;
    carveBlock(startX, startY);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (cellIncluded(nx, ny, geom) && !visited[ny][nx]) {
          opts.push([dx, dy, nx, ny]);
        }
      }
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const [dx, dy, nx, ny] = opts[Math.floor(rng() * opts.length)];
      visited[ny][nx] = true;
      carveBlock(nx, ny);
      carveWall(cx, cy, dx, dy);
      stack.push([nx, ny]);
    }
    return map;
  }

  syncLevelRuntime();
  rebuildIncludedCells();

  let LEVEL_MAP = generateVaultMaze(randomMazeSeed());
  let MAP_ROWS = LEVEL_MAP.length;
  let MAP_COLS = LEVEL_MAP[0].length;

  const proximityMap = proxMapCanvas
    ? createProximityMap(proxMapCanvas, {
        levelMap: LEVEL_MAP,
        mapRows: MAP_ROWS,
        mapCols: MAP_COLS,
      })
    : null;

  ({ lanterns: activeLanternCells, nulls: activeNullCells } = pickEntityCells());

  function regenerateMaze() {
    rebuildIncludedCells();
    const fresh = generateVaultMaze(randomMazeSeed());
    const sameSize =
      fresh.length === MAP_ROWS &&
      fresh[0] &&
      fresh[0].length === MAP_COLS &&
      LEVEL_MAP.length === MAP_ROWS;

    if (sameSize) {
      for (let r = 0; r < fresh.length; r++) {
        for (let c = 0; c < fresh[r].length; c++) {
          LEVEL_MAP[r][c] = fresh[r][c];
        }
      }
    } else {
      LEVEL_MAP = fresh;
      MAP_ROWS = fresh.length;
      MAP_COLS = fresh[0].length;
    }

    ({ lanterns: activeLanternCells, nulls: activeNullCells } = pickEntityCells());

    if (world3d && typeof world3d.rebuildLevel === "function") {
      world3d.rebuildLevel({
        levelMap: LEVEL_MAP,
        mapRows: MAP_ROWS,
        mapCols: MAP_COLS,
      });
    }
    if (proximityMap && typeof proximityMap.setMap === "function") {
      proximityMap.setMap(LEVEL_MAP, MAP_ROWS, MAP_COLS);
    }
  }

  async function initWorld3D() {
    if (!USE_3D_WORLD) return;
    try {
      const { createWorld3D } = await import("./world3d.js?v=null5");
      world3d = createWorld3D(canvas, {
        levelMap: LEVEL_MAP,
        mapRows: MAP_ROWS,
        mapCols: MAP_COLS,
        fov: FOV,
      });
      window.__world3d = world3d;
      if (player3dCanvas && !USE_3D_PLAYER) {
        player3dCanvas.style.display = "block";
        player3dCanvas.style.visibility = "visible";
        avatarCtx = player3dCanvas.getContext("2d");
        avatarCtx.imageSmoothingEnabled = true;
      }
      syncViewportSize();
    } catch (err) {
      console.error("[game] 3D world failed to load", err);
      world3d = null;
    }
  }

  function tileCenter(col, row) {
    return { x: col + 0.5, y: row + 0.5 };
  }

  /** Center of a carved maze passage block (MAZE_PASSAGE × MAZE_PASSAGE). */
  function passageCenter(col, row) {
    return {
      x: col + MAZE_PASSAGE * 0.5,
      y: row + MAZE_PASSAGE * 0.5,
    };
  }

  function isWall(mx, my) {
    const col = Math.floor(mx);
    const row = Math.floor(my);
    if (row < 0 || col < 0 || row >= MAP_ROWS || col >= MAP_COLS) return true;
    return LEVEL_MAP[row][col] === 1;
  }

  /**
   * Face an open corridor from spawn, preferring the direction toward the exit.
   * Hard-coding -PI/2 often stares into the wall immediately north of the
   * spawn block when the maze carved a different first opening.
   */
  function spawnFacingAngle(x, y, exitX, exitY) {
    const dirs = [
      { angle: 0, dx: 1, dy: 0 },
      { angle: Math.PI, dx: -1, dy: 0 },
      { angle: Math.PI / 2, dx: 0, dy: 1 },
      { angle: -Math.PI / 2, dx: 0, dy: -1 },
    ];
    const toExitX = exitX - x;
    const toExitY = exitY - y;
    const exitLen = Math.hypot(toExitX, toExitY) || 1;
    const ex = toExitX / exitLen;
    const ey = toExitY / exitLen;

    let best = null;
    let bestScore = -Infinity;
    for (const d of dirs) {
      // Probe past the current passage block into the next tile.
      if (isWall(x + d.dx * 1.1, y + d.dy * 1.1)) continue;
      const towardExit = d.dx * ex + d.dy * ey;
      const score = towardExit + 0.15; // slight bias so ties prefer openness
      if (score > bestScore) {
        bestScore = score;
        best = d.angle;
      }
    }
    return best == null ? -Math.PI / 2 : best;
  }

  // ============================================
  // GAME STATE
  // ============================================

  const NULL_SEEDS = [
    { wanderAngle: 0.6, wanderTimer: 0.0, floatPhase: 0.0, faceAngle: 0 },
    { wanderAngle: 2.4, wanderTimer: 1.2, floatPhase: 2.1, faceAngle: Math.PI },
    { wanderAngle: 1.1, wanderTimer: 0.5, floatPhase: 3.4, faceAngle: Math.PI / 2 },
    { wanderAngle: 4.0, wanderTimer: 2.0, floatPhase: 1.0, faceAngle: -Math.PI / 2 },
    { wanderAngle: 5.3, wanderTimer: 0.9, floatPhase: 4.7, faceAngle: 0 },
    { wanderAngle: 3.2, wanderTimer: 1.5, floatPhase: 5.2, faceAngle: Math.PI * 0.75 },
    { wanderAngle: 0.2, wanderTimer: 0.7, floatPhase: 2.8, faceAngle: -Math.PI * 0.25 },
  ];

  let state = createInitialState();
  let lastTime = 0;
  let animTime = 0;
  let bobPhase = 0;
  let frameDt = 1 / 60;
  const flameSigSmooth = { r: 255, g: 160, b: 40, cue: "neutral", power: 0 };

  function createInitialState(opts = {}) {
    const L = activeLevel();
    const s = cellFloorTile(L.spawnCell[0], L.spawnCell[1]);
    const e = cellFloorTile(L.exitCell[0], L.exitCell[1]);
    const start = passageCenter(s.col, s.row);
    const exitPos = tileCenter(e.col, e.row);
    const startLight =
      opts.light != null ? Math.max(0, Math.min(LIGHT_MAX, opts.light)) : LIGHT_MAX;
    const startAngle = spawnFacingAngle(start.x, start.y, exitPos.x, exitPos.y);

    const lanterns = activeLanternCells.map((cell, i) => {
      const t = cellFloorTile(cell[0], cell[1]);
      return { ...tileCenter(t.col, t.row), lit: false, id: i };
    });

    const shadows = activeNullCells.map((cell, i) => {
      const t = cellFloorTile(cell[0], cell[1]);
      const seed = NULL_SEEDS[i % NULL_SEEDS.length];
      return {
        id: i,
        ...tileCenter(t.col, t.row),
        chasing: false,
        chaseCooldown: 0,
        wanderAngle: seed.wanderAngle,
        wanderTimer: seed.wanderTimer,
        floatPhase: seed.floatPhase,
        faceAngle: seed.faceAngle,
      };
    });

    return {
      status: "menu", // menu | playing | levelClear | transitioning | won | lost

      player: {
        x: start.x,
        y: start.y,
        angle: startAngle,
        pitch: PITCH_DEFAULT,
        light: startLight,
      },

      lanterns,

      exit: {
        x: exitPos.x,
        y: exitPos.y,
        unlocked: false,
      },

      shadows,

      prompt: "",
    };
  }

  // ============================================
  // INPUT
  // ============================================

  const keys = {
    forward: false,
    back: false,
    strafeLeft: false,
    strafeRight: false,
    turnLeft: false,
    turnRight: false,
    interact: false,
    interactPressed: false,
    restartPressed: false,
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "F2") {
      e.preventDefault();
      if (
        placementEditor &&
        (state.status === "playing" || placementEditor.active)
      ) {
        placementEditor.toggle();
      }
      return;
    }

    // While editing: still move/look, but block interact + restart (R is easy to hit).
    if (placementEditor?.active) {
      if (e.code === "KeyE" || e.code === "KeyR") {
        e.preventDefault();
        return;
      }
    }

    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        keys.forward = true;
        e.preventDefault();
        break;
      case "KeyS":
      case "ArrowDown":
        keys.back = true;
        e.preventDefault();
        break;
      case "KeyA":
        keys.strafeLeft = true;
        e.preventDefault();
        break;
      case "KeyD":
        keys.strafeRight = true;
        e.preventDefault();
        break;
      case "ArrowLeft":
      case "KeyQ":
        keys.turnLeft = true;
        e.preventDefault();
        break;
      case "ArrowRight":
        keys.turnRight = true;
        e.preventDefault();
        break;
      case "KeyE":
        if (!keys.interact) keys.interactPressed = true;
        keys.interact = true;
        e.preventDefault();
        break;
      case "KeyR":
        keys.restartPressed = true;
        e.preventDefault();
        break;
      case "Escape":
        if (
          state.status === "playing" ||
          state.status === "levelClear" ||
          state.status === "transitioning" ||
          state.status === "won" ||
          state.status === "lost"
        ) {
          showMainMenu();
          e.preventDefault();
        }
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    switch (e.code) {
      case "KeyW":
      case "ArrowUp":
        keys.forward = false;
        break;
      case "KeyS":
      case "ArrowDown":
        keys.back = false;
        break;
      case "KeyA":
        keys.strafeLeft = false;
        break;
      case "KeyD":
        keys.strafeRight = false;
        break;
      case "ArrowLeft":
      case "KeyQ":
        keys.turnLeft = false;
        break;
      case "ArrowRight":
        keys.turnRight = false;
        break;
      case "KeyE":
        keys.interact = false;
        break;
    }
  });

  // Optional mouse look when canvas is clicked
  let pointerLocked = false;
  let editLookDragging = false;
  let editLookLastX = 0;
  let editLookLastY = 0;

  canvas.addEventListener("click", () => {
    if (placementEditor?.active) return;
    if (state.status === "playing") {
      canvas.requestPointerLock?.();
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (!placementEditor?.active || state.status !== "playing") return;
    if (e.button !== 2) return;
    editLookDragging = true;
    editLookLastX = e.clientX;
    editLookLastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  canvas.addEventListener("pointerup", (e) => {
    if (e.button === 2) editLookDragging = false;
  });

  canvas.addEventListener("pointercancel", () => {
    editLookDragging = false;
  });

  canvas.addEventListener("contextmenu", (e) => {
    if (placementEditor?.active) e.preventDefault();
  });

  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === canvas;
  });

  document.addEventListener("mousemove", (e) => {
    if (state.status !== "playing") return;

    if (placementEditor?.active) {
      if (!editLookDragging) return;
      const dx = e.clientX - editLookLastX;
      const dy = e.clientY - editLookLastY;
      editLookLastX = e.clientX;
      editLookLastY = e.clientY;
      state.player.angle += dx * MOUSE_LOOK_SENS;
      state.player.pitch = Math.max(
        PITCH_MIN,
        Math.min(PITCH_MAX, state.player.pitch - dy * MOUSE_LOOK_SENS)
      );
      return;
    }

    if (!pointerLocked) return;
    state.player.angle += e.movementX * MOUSE_LOOK_SENS;
    state.player.pitch = Math.max(
      PITCH_MIN,
      Math.min(PITCH_MAX, state.player.pitch - e.movementY * MOUSE_LOOK_SENS)
    );
  });

  restartBtn.addEventListener("click", () => {
    playButtonPushSfx(restartBtn);
    startGame();
  });

  if (continueBtn) {
    continueBtn.addEventListener("click", () => {
      playButtonPushSfx(continueBtn);
      beginLevelTransition();
    });
  }

  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playEnterVaultSfx();
      startGame();
    });
  }

  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      playButtonPushSfx(menuBtn);
      showMainMenu();
    });
  }

  // ============================================
  // COLLISION / MOVEMENT HELPERS
  // ============================================

  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function tryMove(nx, ny) {
    const p = state.player;
    // Axis-separated slide
    if (!isWall(nx, p.y) && !circleHitsWall(nx, p.y)) p.x = nx;
    if (!isWall(p.x, ny) && !circleHitsWall(p.x, ny)) p.y = ny;
  }

  function circleHitsWall(x, y, radius = PLAYER_RADIUS) {
    const r = radius;
    // Check the four corners of the bounding circle against walls
    const samples = [
      [x - r, y - r],
      [x + r, y - r],
      [x - r, y + r],
      [x + r, y + r],
      [x, y],
    ];
    for (const [sx, sy] of samples) {
      if (isWall(sx, sy)) return true;
    }
    return false;
  }

  function tryMoveShadow(shadow, nx, ny) {
    const ox = shadow.x;
    const oy = shadow.y;
    if (!isWall(nx, oy) && !circleHitsWall(nx, oy, SHADOW_RADIUS)) shadow.x = nx;
    if (!isWall(shadow.x, ny) && !circleHitsWall(shadow.x, ny, SHADOW_RADIUS)) shadow.y = ny;
    const dx = shadow.x - ox;
    const dy = shadow.y - oy;
    if (Math.hypot(dx, dy) > 0.0005) {
      shadow.faceAngle = Math.atan2(dy, dx);
    }
    return Math.hypot(dx, dy);
  }

  function pickShadowWanderAngle(shadow, towardPlayer = false) {
    const p = state.player;
    if (towardPlayer) {
      return Math.atan2(p.y - shadow.y, p.x - shadow.x);
    }
    const rep = nullLanternRepulsion(shadow.x, shadow.y);
    if (rep.mag > 0.08) {
      return Math.atan2(rep.ay, rep.ax);
    }
    return Math.random() * Math.PI * 2;
  }

  function litLanterns() {
    return state.lanterns.filter((l) => l.lit);
  }

  function isInsideLitLanternZone(x, y, range = NULL_LANTERN_AVOID_RANGE) {
    for (const lantern of litLanterns()) {
      if (dist(x, y, lantern.x, lantern.y) < range) return true;
    }
    return false;
  }

  function playerInLitLanternHaven() {
    const p = state.player;
    for (const lantern of litLanterns()) {
      if (dist(p.x, p.y, lantern.x, lantern.y) <= LANTERN_RECHARGE_RANGE) return true;
    }
    return false;
  }

  function nullLanternRepulsion(x, y) {
    let ax = 0;
    let ay = 0;
    let inside = false;
    for (const lantern of litLanterns()) {
      const dx = x - lantern.x;
      const dy = y - lantern.y;
      const d = Math.hypot(dx, dy);
      if (d < NULL_LANTERN_AVOID_RANGE) inside = true;
      if (d < NULL_LANTERN_FLEE_RANGE && d > 0.001) {
        const falloff = 1 - d / NULL_LANTERN_FLEE_RANGE;
        const push = falloff * falloff * 3.2;
        ax += (dx / d) * push;
        ay += (dy / d) * push;
      }
    }
    const mag = Math.hypot(ax, ay);
    return { ax, ay, mag, inside };
  }

  function blendNullMove(mx, my, rep, chasing, dt) {
    if (rep.mag < 0.05) return { mx, my };
    const moveLen = Math.hypot(mx, my);
    if (moveLen < 1e-6) {
      const fleeSpeed = chasing
        ? levelRuntime.shadowChaseSpeed
        : levelRuntime.shadowWanderSpeed;
      return {
        mx: (rep.ax / rep.mag) * fleeSpeed * dt,
        my: (rep.ay / rep.mag) * fleeSpeed * dt,
      };
    }
    const fleeMx = (rep.ax / rep.mag) * moveLen * (rep.inside ? 1.35 : 0.9);
    const fleeMy = (rep.ay / rep.mag) * moveLen * (rep.inside ? 1.35 : 0.9);
    if (rep.inside) return { mx: fleeMx, my: fleeMy };
    const chaseBlend = chasing ? 0.2 : 0.35;
    const fleeBlend = 1 - chaseBlend;
    return {
      mx: mx * chaseBlend + fleeMx * fleeBlend,
      my: my * chaseBlend + fleeMy * fleeBlend,
    };
  }

  function applyNullMovement(shadow, mx, my, rep, dt) {
    let tx = shadow.x + mx;
    let ty = shadow.y + my;
    if (isInsideLitLanternZone(tx, ty)) {
      if (rep.mag < 0.05) return 0;
      const escape = Math.hypot(mx, my) || levelRuntime.shadowWanderSpeed * dt;
      tx = shadow.x + (rep.ax / rep.mag) * escape;
      ty = shadow.y + (rep.ay / rep.mag) * escape;
    }
    if (isInsideLitLanternZone(tx, ty)) return 0;
    return tryMoveShadow(shadow, tx, ty);
  }

  function getViewDistance() {
    const t = Math.pow(state.player.light / LIGHT_MAX, LIGHTING.viewDistCurve);
    const base = VIEW_DIST_MIN + (VIEW_DIST_MAX - VIEW_DIST_MIN) * t;
    return base * (levelRuntime.torchReachScale || 1);
  }

  function smoothFlameSig(raw, dt) {
    const k = 1 - Math.exp(-LIGHTING.flameSmoothRate * dt);
    flameSigSmooth.r += (raw.r - flameSigSmooth.r) * k;
    flameSigSmooth.g += (raw.g - flameSigSmooth.g) * k;
    flameSigSmooth.b += (raw.b - flameSigSmooth.b) * k;
    flameSigSmooth.power += (raw.power - flameSigSmooth.power) * k;
    if (raw.power < LIGHTING.cueFadeMin) {
      flameSigSmooth.cue = "neutral";
    } else if (raw.cue !== "neutral") {
      flameSigSmooth.cue = raw.cue;
    }
    return flameSigSmooth;
  }

  // ============================================
  // PLAYER UPDATE
  // ============================================

  function updatePlayer(dt, { freezeThreats = false } = {}) {
    const p = state.player;

    if (keys.turnLeft) p.angle -= TURN_SPEED * dt;
    if (keys.turnRight) p.angle += TURN_SPEED * dt;

    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);

    let mx = 0;
    let my = 0;

    if (keys.forward) {
      mx += cos * MOVE_SPEED;
      my += sin * MOVE_SPEED;
    }
    if (keys.back) {
      mx -= cos * MOVE_SPEED;
      my -= sin * MOVE_SPEED;
    }
    if (keys.strafeLeft) {
      mx += sin * STRAFE_SPEED;
      my -= cos * STRAFE_SPEED;
    }
    if (keys.strafeRight) {
      mx -= sin * STRAFE_SPEED;
      my += cos * STRAFE_SPEED;
    }

    if (mx !== 0 || my !== 0) {
      tryMove(p.x + mx * dt, p.y + my * dt);
      bobPhase += dt * 12;
    }

    // Edit mode: navigate freely with no flame drain / death.
    if (freezeThreats) return;

    // Light drain / recharge near lit lanterns
    let recharging = false;
    for (const lantern of state.lanterns) {
      if (!lantern.lit) continue;
      if (dist(p.x, p.y, lantern.x, lantern.y) <= LANTERN_RECHARGE_RANGE) {
        recharging = true;
        break;
      }
    }

    if (recharging) {
      p.light = Math.min(LIGHT_MAX, p.light + LIGHT_RECHARGE_PER_SEC * dt);
    } else {
      p.light = Math.max(0, p.light - levelRuntime.lightDrainPerSec * dt);
    }

    if (p.light <= 0) {
      loseGame("The flame went out. Darkness claimed the vault.");
    }
  }

  // ============================================
  // LANTERN / EXIT UPDATE
  // ============================================

  function updateLanterns() {
    const p = state.player;
    state.prompt = "";

    let nearestUnlit = null;
    let nearestDist = Infinity;

    for (const lantern of state.lanterns) {
      const d = dist(p.x, p.y, lantern.x, lantern.y);
      if (!lantern.lit && d < nearestDist) {
        nearestDist = d;
        nearestUnlit = lantern;
      }
    }

    if (nearestUnlit && nearestDist <= LANTERN_INTERACT_RANGE) {
      state.prompt = "Press E to light the lantern";
      if (keys.interactPressed) {
        nearestUnlit.lit = true;
        playLanternLightSfx();
      }
    }

    const litCount = state.lanterns.filter((l) => l.lit).length;
    state.exit.unlocked = litCount === state.lanterns.length;

    if (state.exit.unlocked) {
      const dExit = dist(p.x, p.y, state.exit.x, state.exit.y);
      if (dExit <= EXIT_INTERACT_RANGE) {
        state.prompt = isLastLevel()
          ? "Press E to leave the vault"
          : "Press E to descend deeper";
        if (keys.interactPressed) winGame();
      }
    }

    if (promptEl) {
      if (state.prompt && state.status === "playing") {
        promptEl.innerHTML = state.prompt.replace(/\bE\b/g, '<span class="prompt-key">E</span>');
        promptEl.classList.remove("hidden");
      } else {
        promptEl.textContent = "";
        promptEl.classList.add("hidden");
      }
    }

    updateLanternUI();
  }

  // ============================================
  // NULL UPDATE
  // ============================================

  function updateShadows(dt) {
    const p = state.player;
    const playerHaven = playerInLitLanternHaven();

    for (const shadow of state.shadows) {
      shadow.floatPhase += dt * (1.6 + shadow.id * 0.15);
      shadow.bob = Math.sin(shadow.floatPhase) * SHADOW_FLOAT_AMP;

      if (shadow.chaseCooldown > 0) {
        shadow.chaseCooldown = Math.max(0, shadow.chaseCooldown - dt);
      }

      const playerDist = dist(p.x, p.y, shadow.x, shadow.y);
      const rep = nullLanternRepulsion(shadow.x, shadow.y);

      if (shadow.chasing) {
        if (playerDist > SHADOW_DEAGGRO_RANGE || playerHaven || rep.inside) {
          shadow.chasing = false;
          shadow.chaseCooldown = SHADOW_CHASE_COOLDOWN;
        }
      } else if (
        playerDist < levelRuntime.shadowAggroRange &&
        !playerHaven &&
        !rep.inside &&
        shadow.chaseCooldown <= 0
      ) {
        shadow.chasing = true;
      }

      let mx = 0;
      let my = 0;

      if (shadow.chasing) {
        const dx = p.x - shadow.x;
        const dy = p.y - shadow.y;
        const len = Math.hypot(dx, dy) || 1;
        const closeBoost = Math.min(1, playerDist / 1.6);
        const speed =
          levelRuntime.shadowChaseSpeed *
          (0.72 + 0.28 * closeBoost) *
          (1 + 0.05 * Math.sin(shadow.floatPhase * 1.4));
        mx = (dx / len) * speed * dt;
        my = (dy / len) * speed * dt;
      } else {
        shadow.wanderTimer -= dt;
        if (shadow.wanderTimer <= 0) {
          shadow.wanderTimer = 1.2 + Math.random() * 2.8;
          shadow.wanderAngle = pickShadowWanderAngle(shadow);
        }
        const drift = Math.sin(shadow.floatPhase * 0.55 + shadow.id) * 0.08;
        const angle = shadow.wanderAngle + drift;
        const speed =
          levelRuntime.shadowWanderSpeed *
          (0.85 + 0.15 * Math.sin(shadow.floatPhase * 0.9));
        mx = Math.cos(angle) * speed * dt;
        my = Math.sin(angle) * speed * dt;
      }

      const blended = blendNullMove(mx, my, rep, shadow.chasing, dt);
      const moved = applyNullMovement(shadow, blended.mx, blended.my, rep, dt);

      if (rep.inside) {
        shadow.chasing = false;
        pushNullOutOfLanterns(shadow, dt);
      }

      if (!shadow.chasing && moved < 0.001) {
        shadow.wanderAngle = pickShadowWanderAngle(shadow);
        shadow.wanderTimer = 0.35 + Math.random() * 0.8;
      }

      if (playerDist < SHADOW_TOUCH_RANGE && !playerHaven) {
        p.light = Math.max(0, p.light - levelRuntime.shadowDamagePerSec * dt);
        if (p.light <= 0) {
          loseGame("A Null swallowed the last flame.");
        }
      }
    }
  }

  function pushNullOutOfLanterns(shadow, dt) {
    const rep = nullLanternRepulsion(shadow.x, shadow.y);
    if (!rep.inside || rep.mag < 0.05) return;
    const step = NULL_LANTERN_AVOID_RANGE * 0.22;
    applyNullMovement(
      shadow,
      (rep.ax / rep.mag) * step,
      (rep.ay / rep.mag) * step,
      rep,
      dt
    );
  }

  // ============================================
  // WIN / LOSE / LEVEL TRANSITION
  // ============================================

  function getLevelElapsedSec() {
    if (levelStartedAt <= 0) {
      return levelTimesSec[currentLevelIndex] != null
        ? levelTimesSec[currentLevelIndex]
        : 0;
    }
    const now = performance.now();
    let paused = levelTimerPausedMs;
    if (levelTimerPauseStartedAt > 0) {
      paused += now - levelTimerPauseStartedAt;
    }
    return Math.max(0, (now - levelStartedAt - paused) / 1000);
  }

  function setEditGameplayPaused(paused) {
    if (paused) {
      if (levelTimerPauseStartedAt <= 0 && levelStartedAt > 0) {
        levelTimerPauseStartedAt = performance.now();
      }
      stopNullBreath();
      if (document.pointerLockElement) document.exitPointerLock?.();
    } else if (levelTimerPauseStartedAt > 0) {
      levelTimerPausedMs += performance.now() - levelTimerPauseStartedAt;
      levelTimerPauseStartedAt = 0;
    }
  }

  function recordCurrentLevelTime() {
    if (levelStartedAt <= 0) return;
    levelTimesSec[currentLevelIndex] = getLevelElapsedSec();
    levelStartedAt = 0;
    levelTimerPausedMs = 0;
    levelTimerPauseStartedAt = 0;
  }

  function totalRunTimeSec() {
    let total = 0;
    for (let i = 0; i < levelTimesSec.length; i++) {
      total += levelTimesSec[i] || 0;
    }
    return total;
  }

  function formatLevelTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function clearTransitionTimers() {
    for (const id of transitionTimerIds) window.clearTimeout(id);
    transitionTimerIds = [];
  }

  function showLevelTransition(title) {
    if (!levelTransitionEl) return;
    if (levelTransitionTitleEl) levelTransitionTitleEl.textContent = title;
    levelTransitionEl.classList.remove("hidden");
    // Reflow so the opacity transition runs after display flips on.
    void levelTransitionEl.offsetWidth;
    levelTransitionEl.classList.add("is-visible");
  }

  function hideLevelTransition() {
    if (!levelTransitionEl) return;
    levelTransitionEl.classList.remove("is-visible");
    window.setTimeout(() => {
      if (
        levelTransitionEl &&
        !levelTransitionEl.classList.contains("is-visible")
      ) {
        levelTransitionEl.classList.add("hidden");
      }
    }, 450);
  }

  function winGame() {
    if (state.status !== "playing") return;
    if (!isLastLevel()) {
      clearLevel();
      return;
    }
    state.status = "won";
    if (document.pointerLockElement) document.exitPointerLock?.();
    stopNullBreath();
    recordCurrentLevelTime();
    recordLeaderboardRun(totalRunTimeSec());
    showOverlay(
      "You Escaped",
      "Mimu carried the last light through every chamber. The door sealed the dark behind you.",
      false,
      { mode: "restart" }
    );
  }

  function clearLevel() {
    if (state.status !== "playing") return;
    state.status = "levelClear";
    if (document.pointerLockElement) document.exitPointerLock?.();
    stopNullBreath();
    recordCurrentLevelTime();
    const L = activeLevel();
    showOverlay(
      L.clearTitle,
      L.clearMessage || "A deeper chamber waits beyond.",
      false,
      { mode: "continue" }
    );
  }

  function beginLevelTransition() {
    const next = nextLevel();
    if (!next || state.status === "transitioning") return;

    const carryFactor =
      next.carryFlameFactor != null ? next.carryFlameFactor : CARRY_FLAME_FACTOR;
    const carryMin =
      next.carryFlameMin != null ? next.carryFlameMin : CARRY_FLAME_MIN;
    const carried = Math.max(carryMin, state.player.light * carryFactor);
    const fromLevel = activeLevel();
    state.status = "transitioning";
    stopNullBreath();
    hideOverlay();
    showLevelTransition(
      fromLevel.transitionTitle || `Entering ${next.label}…`
    );

    clearTransitionTimers();
    transitionTimerIds.push(
      window.setTimeout(() => {
        loadLevel(currentLevelIndex + 1, { carriedLight: carried });
        state.status = "transitioning";
      }, 500)
    );
    transitionTimerIds.push(
      window.setTimeout(() => {
        hideLevelTransition();
        if (state.status === "transitioning") state.status = "playing";
      }, 1700)
    );
  }

  function loadLevel(index, { carriedLight = LIGHT_MAX } = {}) {
    currentLevelIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
    syncLevelRuntime();
    regenerateMaze();
    state = createInitialState({ light: carriedLight });
    levelStartedAt = performance.now();
    levelTimerPausedMs = 0;
    levelTimerPauseStartedAt = 0;
    keys.interactPressed = false;
    keys.restartPressed = false;
    bobPhase = 0;
    updateUI();
  }

  function loseGame(message) {
    if (placementEditor?.active) return;
    if (state.status !== "playing") return;
    state.status = "lost";
    if (document.pointerLockElement) document.exitPointerLock?.();
    stopNullBreath();
    levelStartedAt = 0;
    levelTimerPausedMs = 0;
    levelTimerPauseStartedAt = 0;
    showOverlay("Flame Extinguished", message, true, { mode: "restart" });
  }

  function showOverlay(title, message, isLose, opts = {}) {
    const mode = opts.mode || "restart";
    overlayTitleEl.textContent = title;
    overlayMessageEl.textContent = message;
    overlayEl.classList.toggle("lose", isLose);
    overlayCardEl.classList.toggle("lose", isLose);
    if (continueBtn) continueBtn.classList.toggle("hidden", mode !== "continue");
    if (restartBtn) restartBtn.classList.toggle("hidden", mode === "continue");
    overlayEl.classList.remove("hidden");
  }

  function hideOverlay() {
    overlayEl.classList.add("hidden");
  }

  function syncMenuVideos(playing) {
    if (!menuLogoVideoEl) return;
    if (playing) {
      menuLogoVideoEl.play().catch(() => {});
    } else {
      menuLogoVideoEl.pause();
    }
  }

  function showMainMenu() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    clearTransitionTimers();
    hideLevelTransition();
    state.status = "menu";
    hideOverlay();
    if (mainMenuEl) mainMenuEl.classList.remove("hidden");
    if (gameUiEl) gameUiEl.classList.add("hidden");
    if (runeBorderEl) runeBorderEl.classList.remove("hidden");
    keys.interactPressed = false;
    keys.restartPressed = false;
    if (player3d) player3d.setVisible(false);
    if (proxMapWrapEl) {
      proxMapWrapEl.classList.add("is-hidden");
      proxMapWrapEl.setAttribute("aria-hidden", "true");
    }
    syncMenuVideos(true);
    stopAmbient();
    stopNullBreath();
    musicPlayer.resumePlaylist();
  }

  function startGame() {
    clearTransitionTimers();
    hideLevelTransition();
    // Production always starts at L1. Local host may skip via picker / ?level=.
    currentLevelIndex = isLocalDevHost() ? debugStartLevelIndex : 0;
    levelTimesSec.length = 0;
    for (let i = 0; i < currentLevelIndex; i++) levelTimesSec[i] = 0;
    syncLevelRuntime();
    regenerateMaze();
    // Full flame when jumping in from the menu (incl. L3 skip) so you can test.
    state = createInitialState({ light: LIGHT_MAX });
    state.status = "playing";
    levelStartedAt = performance.now();
    levelTimerPausedMs = 0;
    levelTimerPauseStartedAt = 0;
    hideOverlay();
    if (mainMenuEl) mainMenuEl.classList.add("hidden");
    syncMenuVideos(false);
    if (gameUiEl) gameUiEl.classList.remove("hidden");
    if (runeBorderEl) runeBorderEl.classList.add("hidden");
    if (proxMapWrapEl) {
      proxMapWrapEl.classList.remove("is-hidden");
      proxMapWrapEl.setAttribute("aria-hidden", "false");
    }
    keys.interactPressed = false;
    keys.restartPressed = false;
    bobPhase = 0;
    lastTime = 0;
    flameSigSmooth.r = 255;
    flameSigSmooth.g = 160;
    flameSigSmooth.b = 40;
    flameSigSmooth.cue = "neutral";
    flameSigSmooth.power = 0;
    updateUI();
    syncViewportSize();
    requestAnimationFrame(() => {
      syncViewportSize();
      if (player3d) player3d.setVisible(true);
    });
    if (player3d) player3d.setVisible(true);
    musicPlayer.playExclusive(GAME_TRACK, { loop: true });
    startAmbient();
    if (placementEditor && shouldAutoOpenPlacementEditor()) {
      placementEditor.setActive(true);
    } else {
      placementEditor?.refreshTargetList?.();
    }
  }

  function resetGame() {
    startGame();
  }

  // ============================================
  // UI
  // ============================================

  function updateLanternUI() {
    const total = state.lanterns.length;
    const lit = state.lanterns.filter((l) => l.lit).length;
    const remaining = total - lit;
    const countText = `${lit} / ${total}`;

    if (lanternCountEl) lanternCountEl.textContent = countText;
    if (lanternHudCountEl) lanternHudCountEl.textContent = countText;

    let remainingText;
    let allDone = false;
    if (remaining === 0) {
      allDone = true;
      remainingText = state.exit.unlocked ? "Exit unlocked" : "All lit";
    } else {
      remainingText = `${remaining} to light`;
    }

    if (lanternRemainingEl) {
      lanternRemainingEl.textContent = remainingText;
      lanternRemainingEl.classList.toggle("done", allDone);
    }
    if (lanternHudRemainingEl) {
      lanternHudRemainingEl.textContent = remainingText;
      lanternHudRemainingEl.classList.toggle("done", allDone);
    }
  }

  function updateUI() {
    const light = state.player.light;
    const pct = Math.round(light);
    lightFillEl.style.width = `${pct}%`;
    lightPercentEl.textContent = `${pct}%`;
    lightFillEl.classList.toggle("low", light < 30);

    if (levelIndicatorEl) {
      levelIndicatorEl.textContent = activeLevel().label;
    }
    if (levelTimerEl) {
      let elapsed = 0;
      if (state.status === "playing" && levelStartedAt > 0) {
        elapsed = getLevelElapsedSec();
      } else if (levelTimesSec[currentLevelIndex] != null) {
        elapsed = levelTimesSec[currentLevelIndex];
      }
      levelTimerEl.textContent = formatLevelTime(elapsed);
    }

    updateLanternUI();
  }

  // ============================================
  // RAYCASTING
  // ============================================

  function castRay(rayAngle) {
    // DDA grid traversal
    const cos = Math.cos(rayAngle);
    const sin = Math.sin(rayAngle);

    let mapX = Math.floor(state.player.x);
    let mapY = Math.floor(state.player.y);

    const deltaDistX = cos === 0 ? 1e30 : Math.abs(1 / cos);
    const deltaDistY = sin === 0 ? 1e30 : Math.abs(1 / sin);

    let stepX;
    let stepY;
    let sideDistX;
    let sideDistY;

    if (cos < 0) {
      stepX = -1;
      sideDistX = (state.player.x - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - state.player.x) * deltaDistX;
    }

    if (sin < 0) {
      stepY = -1;
      sideDistY = (state.player.y - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - state.player.y) * deltaDistY;
    }

    let hit = false;
    let side = 0; // 0 = NS (hit on X), 1 = EW (hit on Y)
    let depth = 0;

    while (!hit && depth < MAX_DEPTH) {
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (mapY < 0 || mapX < 0 || mapY >= MAP_ROWS || mapX >= MAP_COLS) {
        hit = true;
        break;
      }
      if (LEVEL_MAP[mapY][mapX] === 1) hit = true;
      depth++;
    }

    let perpDist;
    if (side === 0) {
      perpDist = (mapX - state.player.x + (1 - stepX) / 2) / cos;
    } else {
      perpDist = (mapY - state.player.y + (1 - stepY) / 2) / sin;
    }
    perpDist = Math.max(0.0001, perpDist);

    // Wall texture coordinate (0–1 along the face)
    let wallX;
    if (side === 0) wallX = state.player.y + perpDist * sin;
    else wallX = state.player.x + perpDist * cos;
    wallX -= Math.floor(wallX);

    return { dist: perpDist, side, wallX, mapX, mapY };
  }

  // ============================================
  // RENDERING — WORLD
  // ============================================

  function drawCeilingAndFloor(bob) {
    const mid = CANVAS_H / 2 + bob;

    // Ceiling
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, mid);
    ceilGrad.addColorStop(0, "#05030a");
    ceilGrad.addColorStop(1, CEILING);
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, CANVAS_W, Math.max(0, mid));

    // Floor with distance falloff
    const floorGrad = ctx.createLinearGradient(0, mid, 0, CANVAS_H);
    floorGrad.addColorStop(0, FLOOR_NEAR);
    floorGrad.addColorStop(1, FLOOR_FAR);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, mid, CANVAS_W, CANVAS_H - mid);

    // Soft floor grid hint near player
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.strokeStyle = "#6a50a0";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = mid + ((CANVAS_H - mid) * i) / 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_W, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls(bob) {
    const p = state.player;
    const viewDist = getViewDistance();
    const halfFov = FOV / 2;

    for (let col = 0; col < NUM_RAYS; col++) {
      const rayScreen = (col / NUM_RAYS) * 2 - 1; // -1 .. 1
      const rayAngle = p.angle + Math.atan(rayScreen * Math.tan(halfFov));
      const hit = castRay(rayAngle);

      // Fix fish-eye
      const corrected = hit.dist * Math.cos(rayAngle - p.angle);
      zBuffer[col] = corrected;

      const lineH = Math.min(CANVAS_H * 2.5, (CANVAS_H / corrected) * 0.85);
      const drawStart = midY(bob) - lineH / 2;
      const drawEnd = drawStart + lineH;

      // Base wall color — purple stone, darker on Y-sides
      let shade = hit.side === 1 ? 0.65 : 1;

      // Distance fog based on flame strength
      const fog = Math.min(1, corrected / viewDist);
      shade *= 1 - fog * LIGHTING.wallFogStrength;

      // Warm tint when close (flame light on walls) — kept subtle
      const warm =
        Math.max(0, 1 - corrected / (viewDist * 0.55)) * LIGHTING.warmWallStrength;

      const r = Math.floor((55 + 90 * warm) * shade);
      const g = Math.floor((35 + 55 * warm) * shade);
      const b = Math.floor((95 + 20 * warm) * shade);

      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col, drawStart, 1, drawEnd - drawStart);

      // Subtle brick band every few units of wallX
      if (hit.wallX > 0.48 && hit.wallX < 0.52 && fog < 0.85) {
        ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - fog)})`;
        ctx.fillRect(col, drawStart, 1, drawEnd - drawStart);
      }
    }
  }

  function midY(bob) {
    return CANVAS_H / 2 + bob;
  }

  // ============================================
  // RENDERING — SPRITES (lanterns, shadows, exit)
  // ============================================

  function collectSprites() {
    const sprites = [];

    for (const lantern of state.lanterns) {
      sprites.push({
        x: lantern.x,
        y: lantern.y,
        type: "lantern",
        lit: lantern.lit,
        id: lantern.id,
      });
    }

    for (const shadow of state.shadows) {
      sprites.push({
        x: shadow.x,
        y: shadow.y,
        type: "shadow",
        id: shadow.id,
        bob: shadow.bob,
        floatPhase: shadow.floatPhase,
      });
    }

    sprites.push({
      x: state.exit.x,
      y: state.exit.y,
      type: "exit",
      unlocked: state.exit.unlocked,
    });

    return sprites;
  }

  function drawSprites(bob) {
    const p = state.player;
    const viewDist = getViewDistance();
    const sprites = collectSprites();

    // Transform to camera space and sort far → near
    const camCos = Math.cos(p.angle);
    const camSin = Math.sin(p.angle);

    const projected = [];
    for (const spr of sprites) {
      const dx = spr.x - p.x;
      const dy = spr.y - p.y;

      // Rotate into camera space
      const tx = dx * camCos + dy * camSin; // depth (forward)
      const ty = -dx * camSin + dy * camCos; // side

      if (tx <= 0.15) continue; // behind camera

      const screenX = (CANVAS_W / 2) * (1 + ty / (tx * Math.tan(FOV / 2)));
      const sizeMul = spr.type === "shadow" ? 1.15 : 0.7;
      const spriteH = Math.min(CANVAS_H * 2.2, (CANVAS_H / tx) * sizeMul);
      const spriteW = spriteH * (spr.type === "shadow" ? 0.82 : 1);

      projected.push({
        ...spr,
        depth: tx,
        screenX,
        spriteH,
        spriteW,
      });
    }

    projected.sort((a, b) => b.depth - a.depth);

    for (const spr of projected) {
      const fog = Math.min(1, spr.depth / viewDist);
      if (fog >= 0.98 && spr.type !== "lantern" && spr.type !== "shadow") continue;
      if (fog >= 0.995 && spr.type === "shadow") continue;

      const drawW = spr.spriteW;
      const drawH = spr.spriteH;
      const ghostBobPx =
        spr.type === "shadow"
          ? (spr.bob || 0) * (CANVAS_H / spr.depth) * 0.55 +
            Math.sin(animTime * 2.4 + (spr.floatPhase || 0)) * drawH * 0.05
          : 0;
      const left = Math.floor(spr.screenX - drawW / 2);
      const top = Math.floor(midY(bob) - drawH / 2 - ghostBobPx - drawH * 0.06);
      const right = Math.floor(spr.screenX + drawW / 2);

      // Draw column by column with z-buffer occlusion
      for (let stripe = left; stripe < right; stripe++) {
        if (stripe < 0 || stripe >= CANVAS_W) continue;
        if (spr.depth >= zBuffer[stripe]) continue;

        const u = (stripe - left) / drawW; // 0..1 across sprite

        if (spr.type === "lantern") {
          drawLanternStripe(stripe, top, drawH, u, spr, fog);
        } else if (spr.type === "shadow") {
          drawShadowStripe(stripe, top, drawH, u, fog);
        } else if (spr.type === "exit") {
          drawExitStripe(stripe, top, drawH, u, spr, fog);
        }
      }

      // Lit lantern glow bloom (screen-space soft circle)
      if (spr.type === "lantern" && spr.lit && fog < 0.92) {
        const glowR = drawW * 1.2;
        const glowA = 0.62 * (1 - fog * 0.55);
        const g = ctx.createRadialGradient(
          spr.screenX,
          midY(bob),
          2,
          spr.screenX,
          midY(bob),
          glowR
        );
        g.addColorStop(0, `rgba(255, 235, 140, ${glowA})`);
        g.addColorStop(0.4, `rgba(255, 195, 70, ${glowA * 0.45})`);
        g.addColorStop(1, "rgba(255, 160, 40, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(spr.screenX, midY(bob), glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Exit door glow when unlocked (or dim landmark glow when locked)
      if (spr.type === "exit" && fog < 0.95) {
        const glowR = drawW * (spr.unlocked ? 1.45 : 0.95);
        const pulse = spr.unlocked
          ? 0.72 + 0.28 * Math.sin(animTime * 2.5)
          : 0.5 + 0.12 * Math.sin(animTime * 1.6);
        const glowA = (spr.unlocked ? 0.72 : 0.28) * pulse * (1 - fog * 0.5);
        const g = ctx.createRadialGradient(
          spr.screenX,
          midY(bob),
          2,
          spr.screenX,
          midY(bob),
          glowR
        );
        g.addColorStop(0, `rgba(255, 220, 120, ${glowA})`);
        g.addColorStop(0.42, `rgba(255, 150, 45, ${glowA * 0.42})`);
        g.addColorStop(1, "rgba(255, 120, 30, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(spr.screenX, midY(bob), glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawLanternStripe(x, top, h, u, spr, fog) {
    const pulse = 0.85 + 0.15 * Math.sin(animTime * 3 + (spr.id || 0));
    const alpha = spr.lit ? 1 - fog * 0.4 : 1 - fog * 0.85;

    // Post in center
    if (u > 0.42 && u < 0.58) {
      ctx.fillStyle = `rgba(30, 24, 48, ${alpha})`;
      ctx.fillRect(x, top + h * 0.45, 1, h * 0.5);
    }

    // Cage / flame body
    if (u > 0.28 && u < 0.72) {
      if (spr.lit) {
        const bright = 235 + 20 * pulse;
        ctx.fillStyle = `rgba(${bright}, ${195 + 60 * pulse}, ${85 + 45 * pulse}, ${alpha})`;
        ctx.fillRect(x, top + h * 0.18, 1, h * 0.32);
        // Hot inner core
        if (u > 0.4 && u < 0.6) {
          ctx.fillStyle = `rgba(255, ${245 + 10 * pulse}, ${190 + 50 * pulse}, ${alpha * 0.95})`;
          ctx.fillRect(x, top + h * 0.22, 1, h * 0.24);
        }
      } else {
        ctx.fillStyle = `rgba(70, 55, 40, ${alpha})`;
        ctx.fillRect(x, top + h * 0.22, 1, h * 0.28);
      }
    }

    // Cap
    if (u > 0.22 && u < 0.78) {
      ctx.fillStyle = spr.lit
        ? `rgba(255, 248, 210, ${alpha})`
        : `rgba(90, 75, 60, ${alpha})`;
      ctx.fillRect(x, top + h * 0.12, 1, h * 0.08);
    }
  }

  function drawShadowStripe(x, top, h, u, fog) {
    const pulse = 0.72 + 0.28 * Math.sin(animTime * 3.2);
    const alpha = Math.min(1, (0.95 - fog * 0.35) * pulse);
    const img = enemySprite?.ready ? enemySprite.canvas : null;

    if (img) {
      const sx = Math.max(0, Math.min(img.width - 1, Math.floor(u * img.width)));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(img, sx, 0, 1, img.height, x, top, 1, h);
      ctx.restore();
      return;
    }

    // Procedural fallback while GLB loads
    const edge = Math.abs(u - 0.5) * 2;
    if (edge > 0.92) return;
    const shade = 1 - edge * 0.6;
    ctx.fillStyle = `rgba(${20 * shade}, ${8 * shade}, ${40 * shade}, ${alpha})`;
    ctx.fillRect(x, top + h * 0.15, 1, h * 0.75);
    if (u > 0.32 && u < 0.42) {
      ctx.fillStyle = `rgba(140, 100, 220, ${alpha})`;
      ctx.fillRect(x, top + h * 0.28, 1, h * 0.06);
    }
    if (u > 0.58 && u < 0.68) {
      ctx.fillStyle = `rgba(140, 100, 220, ${alpha})`;
      ctx.fillRect(x, top + h * 0.28, 1, h * 0.06);
    }
  }

  function drawExitStripe(x, top, h, u, spr, fog) {
    const alpha = 1 - fog * 0.8;
    const unlocked = spr.unlocked;
    const pulse = unlocked ? 0.7 + 0.3 * Math.sin(animTime * 2.5) : 0.45 + 0.15 * Math.sin(animTime * 1.6);

    // Frame edges
    if (u < 0.12 || u > 0.88) {
      ctx.fillStyle = unlocked
        ? `rgba(80, 55, 25, ${alpha})`
        : `rgba(42, 28, 58, ${alpha})`;
      ctx.fillRect(x, top, 1, h);
      return;
    }

    // Door panel
    if (unlocked) {
      const glow = 40 + 80 * pulse;
      ctx.fillStyle = `rgba(${glow + 40}, ${glow}, ${40}, ${alpha * 0.9})`;
    } else {
      const glow = 18 + 20 * pulse;
      ctx.fillStyle = `rgba(${glow + 24}, ${glow + 8}, ${24}, ${alpha * 0.82})`;
    }
    ctx.fillRect(x, top + h * 0.08, 1, h * 0.84);

    // Warm seam glow near the handle
    if (u > 0.62 && u < 0.8) {
      const seam = unlocked ? 180 + 60 * pulse : 70 + 35 * pulse;
      ctx.fillStyle = `rgba(255, ${seam}, ${50 + 30 * pulse}, ${alpha * (unlocked ? 0.95 : 0.55)})`;
      ctx.fillRect(x, top + h * 0.42, 1, h * 0.16);
    }

    // Lock / handle
    if (u > 0.7 && u < 0.82) {
      ctx.fillStyle = unlocked
        ? `rgba(255, 230, 160, ${alpha})`
        : `rgba(180, 120, 70, ${alpha * 0.75})`;
      ctx.fillRect(x, top + h * 0.48, 1, h * 0.08);
    }
  }

  // ============================================
  // RENDERING — FIRST-PERSON OVERLAYS
  // ============================================

  // Returns flame tint + cue from nearest unlit lantern, or the exit once unlocked.
  function flameSignalToward(tx, ty, p, maxDist) {
    const neutral = { r: 255, g: 160, b: 40, cue: "neutral", power: 0 };
    const nearestDist = dist(p.x, p.y, tx, ty);
    if (nearestDist > maxDist) return neutral;

    const toAngle = Math.atan2(ty - p.y, tx - p.x);
    let diff = toAngle - p.angle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    const dot = Math.cos(diff);
    const fadeSpan = Math.max(4, maxDist - 5);
    const fade = 1 - Math.max(0, (nearestDist - 5) / fadeSpan);

    let cue = "neutral";
    let power = 0;
    const thr = LIGHTING.cueDotThreshold;
    const fadeMin = LIGHTING.cueFadeMin;
    if (dot > thr && fade > fadeMin) {
      cue = "blue";
      power = Math.min(1, dot * fade * 1.2);
    } else if (dot < -thr && fade > fadeMin) {
      cue = "red";
      power = Math.min(1, -dot * fade * 1.2);
    }

    let r, g, b;
    const tintT = Math.min(1, Math.abs(dot) * fade * 1.2);
    if (dot >= 0) {
      r = Math.round(255 * (1 - tintT) + 30 * tintT);
      g = Math.round(160 * (1 - tintT) + 90 * tintT);
      b = Math.round(40  * (1 - tintT) + 255 * tintT);
    } else {
      r = 255;
      g = Math.round(160 * (1 - tintT) + 28 * tintT);
      b = Math.round(40  * (1 - tintT) + 20 * tintT);
    }
    return { r, g, b, cue, power };
  }

  function getFlameSignal() {
    const neutral = { r: 255, g: 160, b: 40, cue: "neutral", power: 0 };
    const p = state.player;
    const unlit = state.lanterns.filter((l) => !l.lit);

    if (unlit.length > 0) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const l of unlit) {
        const d = dist(p.x, p.y, l.x, l.y);
        if (d < nearestDist) { nearestDist = d; nearest = l; }
      }
      return flameSignalToward(nearest.x, nearest.y, p, 14);
    }

    if (state.exit.unlocked) {
      return flameSignalToward(state.exit.x, state.exit.y, p, 24);
    }

    return neutral;
  }

  function drawFlameGlow(flameSig, light, glowX, glowY, pulse) {
    const { cue } = flameSig;
    const isCue = cue === "blue" || cue === "red";
    if (isCue) return;
    const glowTarget = USE_3D_WORLD ? flameBloomCtx : ctx;
    if (!glowTarget) return;

    const halfW = 14 * pulse * FLAME_DIAMOND_SCALE;
    const halfH = 20 * pulse * FLAME_DIAMOND_SCALE;
    const core = glowTarget.createRadialGradient(glowX, glowY, 0, glowX, glowY, halfH);
    core.addColorStop(0, `rgba(255, 210, 90, ${0.42 * light * FLAME_DIAMOND_OPACITY})`);
    core.addColorStop(0.45, `rgba(255, 120, 30, ${0.18 * light * FLAME_DIAMOND_OPACITY})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    glowTarget.fillStyle = core;
    addDiamondPath(glowTarget, glowX, glowY, halfW, halfH);
    glowTarget.fill();
  }

  function addDiamondPath(ctx, cx, cy, halfW, halfH) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - halfH);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx, cy + halfH);
    ctx.lineTo(cx - halfW, cy);
    ctx.closePath();
  }

  const BLOOM_GAIN = 0.82;
  const NEUTRAL_BLOOM_GAIN = 0.95;
  const FLAME_DIAMOND_SCALE = 0.8;
  const FLAME_DIAMOND_OPACITY = 0.2;

  /** Four-sided diamond torch halo above the flame anchor. */
  function drawMenuStyleFlameGlow(cx, cy, strength, pulse, stops) {
    if (!flameBloomCtx) return;
    const menuPulse = 0.88 + 0.12 * Math.sin(animTime * 1.57);
    const scale = pulse * menuPulse * FLAME_DIAMOND_SCALE;

    flameBloomCtx.save();
    flameBloomCtx.translate(cx, cy);
    flameBloomCtx.globalCompositeOperation = "lighter";

    const innerHalfW = 34 * scale;
    const innerHalfH = 52 * scale;
    const grad = flameBloomCtx.createRadialGradient(0, -4 * scale, 0, 0, -4 * scale, innerHalfH);
    grad.addColorStop(0, `rgba(${stops.hot}, ${stops.inner * strength})`);
    grad.addColorStop(0.38, `rgba(${stops.warm}, ${stops.mid * strength})`);
    grad.addColorStop(0.72, "rgba(0,0,0,0)");
    flameBloomCtx.fillStyle = grad;
    addDiamondPath(flameBloomCtx, 0, 0, innerHalfW, innerHalfH);
    flameBloomCtx.fill();

    const outerHalfW = 52 * scale;
    const outerHalfH = 78 * scale;
    const outer = flameBloomCtx.createRadialGradient(0, -2 * scale, 0, 0, -2 * scale, outerHalfH);
    outer.addColorStop(0, `rgba(${stops.warm}, ${stops.outer * strength * 0.55})`);
    outer.addColorStop(1, "rgba(0,0,0,0)");
    flameBloomCtx.fillStyle = outer;
    addDiamondPath(flameBloomCtx, 0, 0, outerHalfW, outerHalfH);
    flameBloomCtx.fill();

    flameBloomCtx.restore();
  }

  /** Soft warm halo behind the torch flame (neutral). */
  function drawNeutralFlameBloom(light, glowX, glowY, pulse) {
    if (!flameBloomCtx || !flameBloomCanvas) return;
    flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);

    const strength = (0.9 + 0.2 * light) * NEUTRAL_BLOOM_GAIN;
    drawMenuStyleFlameGlow(glowX, glowY, strength, pulse, {
      hot: "255, 195, 90",
      warm: "255, 140, 45",
      inner: 0.95,
      mid: 0.48,
      outer: 0.28,
    });
  }

  /** Screen-space cue bloom on blue/red torch signals. */
  function drawFlameBloomOverlay(flameSig, light, glowX, glowY, pulse) {
    if (!flameBloomCtx || !flameBloomCanvas) return;
    flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);
    if (!flameSig || (flameSig.cue !== "blue" && flameSig.cue !== "red")) return;

    const { cue, power } = flameSig;
    const isBlue = cue === "blue";
    const strength = light * (0.72 + 0.28 * power) * BLOOM_GAIN;

    if (isBlue) {
      drawMenuStyleFlameGlow(glowX, glowY, strength, pulse, {
        hot: "170, 215, 255",
        warm: "40, 95, 210",
        inner: 0.48,
        mid: 0.2,
        outer: 0.1,
      });
    } else {
      drawMenuStyleFlameGlow(glowX, glowY, strength, pulse, {
        hot: "255, 185, 95",
        warm: "255, 85, 30",
        inner: 0.46,
        mid: 0.2,
        outer: 0.1,
      });
    }
  }

  function drawVignetteAndFlameLight() {
    const light = state.player.light / LIGHT_MAX;
    const target = USE_3D_WORLD ? flameBloomCtx : ctx;
    if (!target) return;
    const { w, h } = overlaySize();
    const sx = w / CANVAS_W;
    const sy = h / CANVAS_H;

    // Steady vignette — flame level nudges darkness slightly, not dramatically
    const drain = (1 - light) * LIGHTING.vignetteDarken;
    const vig = target.createRadialGradient(
      (CANVAS_W / 2) * sx,
      CANVAS_H * 0.72 * sy,
      CANVAS_H * (LIGHTING.vignetteInner + 0.04 * light) * sy,
      (CANVAS_W / 2) * sx,
      CANVAS_H * 0.72 * sy,
      CANVAS_H * (LIGHTING.vignetteOuter + 0.06 * light) * sy
    );
    vig.addColorStop(0, `rgba(0,0,0,${0.36 + drain})`);
    vig.addColorStop(0.4, `rgba(4, 2, 12, ${0.52 + drain * 1.1})`);
    vig.addColorStop(1, `rgba(2, 1, 8, ${0.76 + drain * 1.05})`);
    target.fillStyle = vig;
    target.fillRect(0, 0, w, h);
  }

  function drawHeldFlame(flameSig) {
    const light = state.player.light / LIGHT_MAX;
    if (light <= 0 || !flameSig) {
      if (player3d) player3d.setVisible(false);
      if (USE_3D_WORLD) {
        if (flameBloomCtx && flameBloomCanvas) {
          flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);
        }
        if (avatarCtx && player3dCanvas) {
          avatarCtx.clearRect(0, 0, player3dCanvas.width, player3dCanvas.height);
        }
      }
      return;
    }

    const moving =
      keys.forward || keys.back || keys.strafeLeft || keys.strafeRight;
    const pulse = 0.9 + 0.1 * Math.sin(animTime * 5.5);
    const isCue = flameSig.cue === "blue" || flameSig.cue === "red";

    const use3d = USE_3D_PLAYER && player3d && player3d.ready;
    if (player3d) player3d.setVisible(!!use3d && state.status !== "menu");

    if (use3d) {
      const flameScreen =
        player3d.getFlameSpriteScreen?.() ||
        player3d.getPointLightScreen?.() ||
        { x: 0.359, y: 0.25 };
      const { w: ow, h: oh } = overlaySize();
      const glowX = ow * flameScreen.x;
      const glowY = oh * flameScreen.y;

      player3dCanvas.style.filter = LIGHTING.avatarFilter;

      player3d.render();
      placementEditor?.renderOverlays?.();

      if (isCue) {
        if (!player3d.bloomEnabled) {
          drawFlameBloomOverlay(flameSig, light, glowX, glowY, pulse);
        } else if (flameBloomCtx && flameBloomCanvas) {
          flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);
        }
      } else if (!player3d.bloomEnabled) {
        drawNeutralFlameBloom(light, glowX, glowY, pulse);
      } else if (flameBloomCtx && flameBloomCanvas) {
        flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);
      }
      return;
    }

    if (flameBloomCtx && flameBloomCanvas) {
      flameBloomCtx.clearRect(0, 0, flameBloomCanvas.width, flameBloomCanvas.height);
    }
    if (USE_3D_WORLD && avatarCtx && player3dCanvas) {
      avatarCtx.clearRect(0, 0, player3dCanvas.width, player3dCanvas.height);
    }
    if (player3dCanvas) player3dCanvas.style.filter = "none";

    const { w: ow, h: oh } = overlaySize();
    const sx = ow / CANVAS_W;
    const sy = oh / CANVAS_H;

    // PNG fallback
    const idleX = Math.sin(animTime * 1.5) * 4;
    const idleY = Math.sin(animTime * 2.1) * 3;
    const walkX = moving ? Math.sin(bobPhase * 0.9) * 10 : 0;
    const walkY = moving ? -Math.abs(Math.sin(bobPhase)) * 8 : 0;
    const bobX = idleX + walkX;
    const bobY = idleY + walkY;
    const sway = Math.sin(animTime * 1.3) * 0.025 + (moving ? Math.sin(bobPhase) * 0.02 : 0);
    const breathe = 1 + Math.sin(animTime * 2.4) * 0.015;

    if (playerSpriteReady && playerSpriteCanvas) {
      const src = playerSpriteCanvas;
      const sw = src.width;
      const sh = src.height;
      const maxW = CANVAS_W * 0.72 * sx;
      const maxH = CANVAS_H * 0.58 * sy;
      const scale = Math.min(maxW / sw, maxH / sh) * breathe;
      const drawW = Math.round(sw * scale);
      const drawH = Math.round(sh * scale);
      const x = Math.round((ow - drawW) / 2 + bobX * sx);
      const y = Math.round(oh - drawH + bobY * sy);

      const glowX = x + drawW * 0.78;
      const glowY = y + drawH * 0.42;
      if (isCue) {
        drawFlameBloomOverlay(flameSig, light, glowX, glowY, pulse);
      } else {
        drawFlameGlow(flameSig, light, glowX, glowY, pulse);
        drawNeutralFlameBloom(light, glowX, glowY, pulse);
      }

      const pivotX = x + drawW * 0.5;
      const pivotY = y + drawH;
      const avatarTarget = USE_3D_WORLD ? avatarCtx : ctx;
      if (!avatarTarget) return;
      avatarTarget.save();
      avatarTarget.translate(pivotX, pivotY);
      avatarTarget.rotate(sway);
      avatarTarget.drawImage(src, 0, 0, sw, sh, -drawW * 0.5, -drawH, drawW, drawH);
      avatarTarget.restore();
    }
  }

  function drawCrosshair() {
    const target = USE_3D_WORLD ? flameBloomCtx : ctx;
    if (!target) return;
    const { w, h } = overlaySize();
    const cx = w / 2;
    const cy = h / 2;
    const sx = w / CANVAS_W;
    target.strokeStyle = "rgba(255, 230, 180, 0.35)";
    target.lineWidth = 1;
    target.beginPath();
    target.moveTo(cx - 8 * sx, cy);
    target.lineTo(cx - 3 * sx, cy);
    target.moveTo(cx + 3 * sx, cy);
    target.lineTo(cx + 8 * sx, cy);
    target.moveTo(cx, cy - 8 * sx);
    target.lineTo(cx, cy - 3 * sx);
    target.moveTo(cx, cy + 3 * sx);
    target.lineTo(cx, cy + 8 * sx);
    target.stroke();
  }

  function render() {
    const moving =
      keys.forward || keys.back || keys.strafeLeft || keys.strafeRight;
    const bob = moving ? Math.sin(bobPhase) * 4 : 0;
    const light = state.player.light / LIGHT_MAX;

    let flameSig = null;
    if (light > 0 && state.status === "playing") {
      const rawFlame = getFlameSignal();
      flameSig = smoothFlameSig(rawFlame, frameDt);
      if (USE_3D_PLAYER && player3d?.ready) {
        player3d.update({
          moving,
          bobPhase,
          flame: flameSig,
          light,
          flameCue: flameSig.cue,
          flamePower: flameSig.power,
        });
      }
    }

    if (USE_3D_WORLD && world3d) {
      world3d.update({
        player: state.player,
        lanterns: state.lanterns,
        shadows: state.shadows,
        exit: state.exit,
        light,
        bob: bob / 4,
        animTime,
        dt: frameDt,
        torchReachScale: levelRuntime.torchReachScale,
      });
      world3d.render();
      placementEditor?.renderOverlays?.();

      drawHeldFlame(flameSig);
      drawVignetteAndFlameLight();
      drawCrosshair();
      if (proximityMap && state.status === "playing") {
        proximityMap.draw({
          player: state.player,
          lanterns: state.lanterns,
          shadows: state.shadows,
          exit: state.exit,
          viewDist: getViewDistance(),
        });
      }
      return;
    }

    drawCeilingAndFloor(bob);
    drawWalls(bob);
    drawSprites(bob);

    drawVignetteAndFlameLight();
    drawHeldFlame(flameSig);
    drawCrosshair();
    if (proximityMap && state.status === "playing") {
      proximityMap.draw({
        player: state.player,
        lanterns: state.lanterns,
        shadows: state.shadows,
        exit: state.exit,
        viewDist: getViewDistance(),
      });
    }
  }

  // ============================================
  // MAIN LOOP
  // ============================================

  function update(dt) {
    if (keys.restartPressed) {
      keys.restartPressed = false;
      if (placementEditor?.active) {
        // R is blocked while editing; ignore any stale restart press.
      } else if (state.status === "levelClear") {
        beginLevelTransition();
        return;
      } else if (
        state.status === "playing" ||
        state.status === "won" ||
        state.status === "lost"
      ) {
        startGame();
      }
      return;
    }

    if (state.status === "levelClear") {
      if (keys.interactPressed) {
        keys.interactPressed = false;
        beginLevelTransition();
      }
      return;
    }

    if (state.status !== "playing") {
      keys.interactPressed = false;
      return;
    }

    // Edit mode: move/look freely; freeze Nulls, flame drain, and lose conditions.
    if (placementEditor?.active) {
      if (keys.restartPressed) keys.restartPressed = false;
      updatePlayer(dt, { freezeThreats: true });
      updateUI();
      placementEditor.update(dt);
      keys.interactPressed = false;
      return;
    }

    updatePlayer(dt);
    updateLanterns();
    updateShadows(dt);
    updateNullBreathAudio();
    updateUI();
    placementEditor?.update(dt);

    keys.interactPressed = false;
  }

  function frame(timestamp) {
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    if (dt > 0.05) dt = 0.05;
    frameDt = dt;

    animTime += dt;
    update(dt);

    // Only draw the 3D world while in-game (not on the main menu)
    if (state.status !== "menu") {
      render();
    }

    requestAnimationFrame(frame);
  }

  // Boot — land on the main menu
  Promise.all([initPlayer3D(), initWorld3D()]).then(() => {
    // The placement editor (F2 / ?edit=1) is a development tool only.
    // Never build it on the public site — players must not be able to open it.
    if (isLocalDevHost()) {
      placementEditor = createPlacementEditor({
        worldApi: () => world3d?.getEditorApi?.() || null,
        playerApi: () => player3d?.getEditorApi?.() || null,
        isPlaying: () => state.status === "playing",
        onActiveChange(active) {
          setEditGameplayPaused(active);
        },
      });
    }
    mountDevLevelPicker();
    showMainMenu();
    requestAnimationFrame(frame);
  });
})();
