# CLAUDE.md — Mechanical Animals (UE5 Racing Game)

Project guide for Claude and for humans. This file covers the **Leaderboard + Ranking
System with Usernames** for a driving/racing game built around a car with a hanging
avatar charm.

Engine target: **Unreal Engine 5.3+** (works on 5.1–5.6 with the noted differences).
Primary language: **Blueprints.** C++ is optional and only suggested where Blueprint
genuinely cannot reach.

---

## 0. How Claude should work in this project

- **Blueprints first.** Do not propose a C++ refactor unless Blueprints cannot do the
  job. When C++ is unavoidable, say so explicitly and keep it to a thin plugin/helper
  that is exposed back to Blueprint.
- **Describe graphs node-by-node.** Claude cannot author `.uasset` files. Every
  Blueprint deliverable must be written as an ordered node list a beginner can
  reproduce: node name → pin values → what connects to what. Use the format in §6.
- **Comment everything.** Every function gets a description in the Blueprint details
  panel. Every graph gets Comment boxes (`C` key) naming the phase.
- **Never break the metric abstraction.** Score is produced in exactly one place
  (`CalculateScore`). Nothing else may hardcode "distance" or "speed".
- **Never call EOS directly from gameplay Blueprints.** Everything goes through
  `BP_LeaderboardManager`, which goes through `BPI_OnlineLeaderboard`. The game must
  fully work with EOS disabled.
- **Assume offline is normal.** Every online path needs a timeout, a failure branch,
  and a local fallback. A failed submit is queued, not lost.
- **No blocking calls on the game thread.** `SaveGameToSlot` and any online fetch use
  the async variants.
- When unsure about a Dev Portal setting or plugin version, say so rather than
  inventing a menu path — the Epic Dev Portal UI changes often.

### Naming conventions

| Prefix | Meaning | Example |
|---|---|---|
| `BP_` | Blueprint class | `BP_LeaderboardManager` |
| `WBP_` | UMG widget | `WBP_Leaderboard` |
| `SG_` | SaveGame object | `SG_LeaderboardSave` |
| `S_` | Struct | `S_LeaderboardEntry` |
| `E_` | Enum | `E_PlayerRank` |
| `BPI_` | Blueprint Interface | `BPI_OnlineLeaderboard` |
| `DT_` | Data Table | `DT_RankTiers` |
| `T_` | Texture | `T_Rank_Gold` |

### Folder layout

```
Content/
  Leaderboard/
    Core/        BP_LeaderboardManager, BPI_OnlineLeaderboard, BP_EOSLeaderboardProvider,
                 BP_NullLeaderboardProvider
    Data/        S_LeaderboardEntry, S_RunStats, E_ScoreMetric, E_PlayerRank,
                 E_LeaderboardScope, DT_RankTiers, SG_LeaderboardSave
    UI/          WBP_Leaderboard, WBP_LeaderboardRow, WBP_LeaderboardRowData,
                 WBP_RunSummary, WBP_RankBadge, WBP_UsernameEntry
    Art/         T_Rank_Bronze ... T_Rank_Legend
```

---

## 1. Architecture at a glance

```
                 ┌──────────────────────────────────────┐
   Race ends ───►│      BP_LeaderboardManager           │
   (car / GM)    │      (GameInstance subclass)         │
                 │                                      │
                 │  SetUsername      SubmitScore        │
                 │  CalculateScore   FetchLeaderboard   │
                 │  GetPlayerRank    SaveData / LoadData│
                 └───┬───────────────────────┬──────────┘
                     │                       │
        ┌────────────▼─────────┐   ┌─────────▼──────────────────┐
        │  SG_LeaderboardSave  │   │  BPI_OnlineLeaderboard     │
        │  (local, on disk)    │   │  (interface)               │
        │  Username, Entries,  │   │        ▲          ▲        │
        │  TotalPoints, Queue  │   │        │          │        │
        └──────────────────────┘   │  BP_EOS...   BP_Null...    │
                                   │  Provider    Provider      │
                                   └────────────────────────────┘
                     │
        ┌────────────▼──────────────────────────────┐
        │  WBP_Leaderboard  /  WBP_RunSummary       │
        │  (bind to manager's dispatchers)          │
        └───────────────────────────────────────────┘
```

**Why a GameInstance subclass:** it survives level transitions, so username, save data
and cached leaderboard pages persist from main menu → race → results without reloading.

**Why a provider interface:** the game ships and plays with zero online setup. Swap
`BP_NullLeaderboardProvider` for `BP_EOSLeaderboardProvider` when EOS credentials
exist. UI code never changes.

---

## 2. Setup guide — Part A: project & plugins

Do this before creating any asset.

### 2.1 Enable plugins

`Edit → Plugins`, enable each, restart when prompted:

| Plugin | Why | Notes |
|---|---|---|
| **Online Subsystem EOS** | EOS platform service | Ships with the engine |
| **EOS Shared** | EOS SDK loader | Usually auto-enabled by the above |
| **Online Subsystem Utils** | Shared online helpers | Usually already on |
| **UMG** (Widget Blueprints) | UI | On by default |
| **Common UI** *(optional)* | Gamepad nav, input routing on tabs | Recommended if you ship on console/controller |

**Important:** the engine's built-in `OnlineSubsystemEOS` does **not** expose
Leaderboards or Stats to Blueprint. You need one of the following to reach EOS from
Blueprint only:

1. **EOS Integration Kit (EIK)** by Betide Studio — free, Blueprint-exposed EOS
   including Stats and Leaderboards, async nodes with `On Success` / `On Failure`
   execution pins. This is the recommended path for a Blueprint-first project.
2. **Online Subsystem Blueprints** — open-source community plugin that exposes the
   generic `IOnlineLeaderboards` interface to Blueprint.
3. **A thin C++ wrapper** you write yourself (≈150 lines) exposing four
   `UBlueprintAsyncActionBase` nodes: `IngestStat`, `QueryLeaderboardGlobal`,
   `QueryLeaderboardUser`, `CopyLeaderboardRecord`.

Pick one and record the choice here:

```
ONLINE BACKEND IN USE: <fill in — EIK / OSSBP / custom C++ / none yet>
PLUGIN VERSION:        <fill in>
```

Everything below is written so that only `BP_EOSLeaderboardProvider` touches the
plugin's nodes. If you switch plugins, one asset changes.

### 2.2 Epic Games Dev Portal

1. Go to `dev.epicgames.com/portal`, create an **Organization** and a **Product**
   ("Mechanical Animals").
2. **Product Settings → Sandboxes / Deployments** — note the **Dev** sandbox id and
   its deployment id. Keep Dev and Live separate; never test against Live.
3. **Product Settings → Clients**
   - Create a **Client Policy**. For a Blueprint-only client that ingests its own
     stats, the policy needs, at minimum: Connect login, Stats **ingest**, and
     Leaderboards **read**.
   - Create a **Client** using that policy. Copy the **Client ID** and
     **Client Secret**.
   > If stat ingest is rejected at runtime with a permissions error, the policy is the
   > cause. Some policy templates only permit stat ingest from a trusted (dedicated
   > server) credential. Either loosen the client policy or move submission behind a
   > server. Verify in the portal — this behaviour differs by policy template.
4. **Game Services → Player Data → Stats.** Create the stats you will rank on:

   | Stat name | Aggregation | Meaning |
   |---|---|---|
   | `RUN_SCORE` | `MAX` | best single-run score, all time |
   | `TOTAL_POINTS` | `SUM` | lifetime points, drives rank tier |
   | `WEEKLY_SCORE` | `MAX` | best run inside the current week window |

   Stat names are **case-sensitive** and must match your Blueprint strings exactly.
5. **Game Services → Leaderboards.** Create one definition per tab:

   | Leaderboard name | Stat | Window |
   |---|---|---|
   | `GLOBAL_BEST` | `RUN_SCORE` | all-time (no end date) |
   | `WEEKLY_BEST` | `WEEKLY_SCORE` | start/end covering the current week |

   > EOS leaderboard definitions carry a **fixed** start/end time; they do not roll
   > over on their own. Practical options for "Weekly":
   > - create the next week's definition ahead of time and bump the name your client
   >   queries (`WEEKLY_BEST_2026_W34`) via a small config/remote value, **or**
   > - keep one long-window `WEEKLY_BEST` definition and reset `WEEKLY_SCORE` on a
   >   schedule from a trusted server, **or**
   > - for a solo/indie build, compute the Weekly tab **locally** from dated entries
   >   in the save file and only ship Local + Global online. This is the default in
   >   §7 and requires no backend work.
6. Note the **Product ID**, **Sandbox ID**, **Deployment ID**, **Client ID**,
   **Client Secret**, and generate a 64-hex-character **Encryption Key**.

### 2.3 Project Settings

`Edit → Project Settings → Plugins → Online Subsystem EOS`:

1. Under **Artifacts**, add an entry named e.g. `Dev` and paste Product ID, Sandbox ID,
   Deployment ID, Client ID, Client Secret, Encryption Key.
2. Set **Default Artifact Name** to `Dev`.
3. Tick **Use EOS Connect for Authentication** (called *Use Crossplay Authentication*
   in some versions) if you want cross-platform identity.

`Edit → Project Settings → Game → Maps & Modes → Game Instance Class` →
**`BP_LeaderboardManager`**. Miss this and nothing works; the manager never spawns.

`DefaultEngine.ini` should end up containing (verify, don't blindly paste):

```ini
[OnlineSubsystem]
DefaultPlatformService=EOS

[OnlineSubsystemEOS]
bEnabled=true

[/Script/Engine.GameEngine]
+NetDriverDefinitions=(DefName="GameNetDriver",DriverClassName="OnlineSubsystemEOS.NetDriverEOS",DriverClassNameFallback="OnlineSubsystemUtils.IpNetDriver")
```

### 2.4 Secrets hygiene

Client Secret and Encryption Key end up in `DefaultEngine.ini`. If this project is in
a public repo, move the artifact block to `Config/DefaultEngine.ini` overrides that are
`.gitignore`d, or inject them in CI. At minimum, use a **Dev** sandbox client for
anything committed and keep Live credentials out of source control.

### 2.5 Verify before continuing

- PIE launches with no red `LogEOSSDK` errors in Output Log.
- `Get Game Instance → Cast To BP_LeaderboardManager` succeeds from any Blueprint.
- Filter Output Log by `LogEOS` and confirm the SDK initialises.

---

## 3. Data types

Create these first — everything else depends on them.

### 3.1 `E_ScoreMetric` (Enum)

```
Distance        // metres travelled
TimeSurvived    // seconds alive
TopSpeed        // km/h peak
Points          // custom scoring
```

### 3.2 `E_PlayerRank` (Enum)

```
Bronze
Silver
Gold
Platinum
Legend
```

### 3.3 `E_LeaderboardScope` (Enum)

```
Local
Global
Weekly
```

### 3.4 `S_RunStats` (Struct)

Raw telemetry from one run. Keep raw numbers here; never store a pre-computed score.

| Variable | Type | Default | Notes |
|---|---|---|---|
| `DistanceMeters` | Float | 0 | |
| `TimeSurvivedSeconds` | Float | 0 | |
| `TopSpeedKPH` | Float | 0 | |
| `Points` | Integer | 0 | pickups, near-misses, drift chain |
| `bCompletedRun` | Boolean | false | false = crashed out; can gate submission |

### 3.5 `S_LeaderboardEntry` (Struct)

| Variable | Type | Notes |
|---|---|---|
| `Rank` | Integer | 1-based; assigned at display time, not stored authoritatively |
| `Username` | String | |
| `Score` | Float | already run through `CalculateScore` |
| `DateEarned` | DateTime | UTC. Use `UtcNow`, never `Now` |
| `PlayerId` | String | local GUID, or EOS ProductUserId for global rows |
| `Tier` | `E_PlayerRank` | cached so rows don't recompute |
| `bIsLocalPlayer` | Boolean | drives row highlight |

### 3.6 `DT_RankTiers` (Data Table)

Row struct `S_RankTier`:

| Variable | Type |
|---|---|
| `Tier` | `E_PlayerRank` |
| `MinTotalPoints` | Integer |
| `DisplayName` | Text |
| `Icon` | `Texture2D` (soft reference) |
| `TierColor` | Linear Color |

Suggested starting rows — tune from real playtest data, these are placeholders:

| Row name | Tier | MinTotalPoints | Color |
|---|---|---|---|
| `Bronze` | Bronze | 0 | `(0.55, 0.33, 0.15)` |
| `Silver` | Silver | 5000 | `(0.75, 0.75, 0.80)` |
| `Gold` | Gold | 20000 | `(1.00, 0.78, 0.20)` |
| `Platinum` | Platinum | 60000 | `(0.65, 0.90, 0.95)` |
| `Legend` | Legend | 150000 | `(0.80, 0.25, 0.95)` |

Keeping tiers in a Data Table means rebalancing is a spreadsheet edit, not a Blueprint
edit. **Rows must be authored in ascending `MinTotalPoints` order**; `GetPlayerRank`
walks the table backwards and relies on it.

### 3.7 `SG_LeaderboardSave` (SaveGame Blueprint)

Parent class **SaveGame**. Variables:

| Variable | Type | Default | Notes |
|---|---|---|---|
| `SaveVersion` | Integer | 1 | bump when you change the layout; see §9.4 |
| `Username` | String | `Bert` | |
| `PlayerGUID` | String | *(empty)* | generated once on first run |
| `Entries` | Array of `S_LeaderboardEntry` | | local top N |
| `BestScore` | Float | 0 | |
| `TotalPoints` | Integer | 0 | lifetime, drives rank |
| `RunsCompleted` | Integer | 0 | |
| `PendingSubmissions` | Array of `S_LeaderboardEntry` | | queued while offline |
| `ActiveMetric` | `E_ScoreMetric` | `Distance` | remembered across sessions |

---

## 4. `BP_LeaderboardManager` — variables

Create a Blueprint of parent class **GameInstance**. Set it as the Game Instance class
(§2.3).

### 4.1 Config (Instance Editable, Category `Config`)

| Variable | Type | Default | Notes |
|---|---|---|---|
| `ScoreMetric` | `E_ScoreMetric` | `Distance` | **the one switch that changes scoring** |
| `bHigherIsBetter` | Boolean | true | flip for lap-time style metrics |
| `MaxLocalEntries` | Integer | 20 | 10–20 per spec |
| `SaveSlotName` | String | `MechanicalAnimals_Leaderboard` | |
| `SaveUserIndex` | Integer | 0 | |
| `DefaultUsername` | String | `Bert` | |
| `RankTable` | Data Table | `DT_RankTiers` | |
| `GlobalLeaderboardName` | String | `GLOBAL_BEST` | must match Dev Portal |
| `WeeklyLeaderboardName` | String | `WEEKLY_BEST` | |
| `RunScoreStatName` | String | `RUN_SCORE` | |
| `TotalPointsStatName` | String | `TOTAL_POINTS` | |
| `WeeklyStatName` | String | `WEEKLY_SCORE` | |
| `OnlineTimeoutSeconds` | Float | 12.0 | |
| `bEnableOnline` | Boolean | true | master kill switch |
| `OnlineProviderClass` | Class (`BPI_OnlineLeaderboard` impl) | `BP_NullLeaderboardProvider` | swap to EOS provider |

### 4.2 Runtime (not editable, Category `Runtime`)

| Variable | Type | Notes |
|---|---|---|
| `SaveData` | `SG_LeaderboardSave` object ref | the live save object |
| `OnlineProvider` | Object ref | spawned from `OnlineProviderClass` |
| `CachedGlobal` | Array of `S_LeaderboardEntry` | |
| `CachedWeekly` | Array of `S_LeaderboardEntry` | |
| `bFetchInFlight` | Boolean | re-entrancy guard |
| `bOnlineReady` | Boolean | login completed |
| `LastFetchTime` | Float | for the 60s cache in `FetchLeaderboard` |
| `TimeoutHandle` | Timer Handle | |

### 4.3 Event Dispatchers

| Dispatcher | Signature | Fired when |
|---|---|---|
| `OnLeaderboardUpdated` | `Scope` (`E_LeaderboardScope`), `Entries` (array) | any list is ready |
| `OnScoreSubmitted` | `bLocalSuccess`, `bOnlineSuccess`, `NewRank` (int) | submit finished |
| `OnUsernameChanged` | `NewName` (String) | |
| `OnRankChanged` | `OldTier`, `NewTier` (`E_PlayerRank`) | tier promotion |
| `OnOnlineError` | `Message` (Text) | show a toast, don't block |

UI binds to dispatchers. UI never polls the manager on Tick.

---

## 5. `BPI_OnlineLeaderboard` (Blueprint Interface)

Functions (all fire-and-forget; results come back through the manager's dispatchers,
so declare these as **events**, i.e. no return values):

| Function | Inputs |
|---|---|
| `InitializeOnline` | `Manager` (Object) |
| `SubmitScoreOnline` | `StatName` (String), `Value` (Integer), `Username` (String) |
| `FetchLeaderboardOnline` | `LeaderboardName` (String), `Scope` (`E_LeaderboardScope`), `MaxResults` (Integer) |
| `FetchPlayerRankOnline` | `LeaderboardName` (String) |
| `IsOnlineReady` | *(a pure Blueprint **function**, returns Boolean)* |

`BP_NullLeaderboardProvider` implements all of them as no-ops that immediately call
back into the manager with "offline". Ship with this until EOS is verified.

> EOS stats are **integers**. Multiply float scores by 100 before ingest and divide by
> 100 on read so you keep two decimals. Do this inside the EOS provider only — the rest
> of the game keeps working in floats.

---

## 6. `BP_LeaderboardManager` — graphs

Format: `NodeName` → pins → connection. Reproduce top to bottom.

### 6.1 `Event Init` (GameInstance startup)

```
Event Init
 └─► Parent: Init
     └─► LoadOrCreateSave                    (custom function, §6.2)
         └─► Branch  (Condition: bEnableOnline)
              True ─► Spawn Object from Class
              │        Class = OnlineProviderClass
              │        Outer  = self
              │        └─► SET OnlineProvider
              │            └─► InitializeOnline (Interface Message)
              │                  Target = OnlineProvider, Manager = self
              False ─► (skip)
```

Comment box: `INIT — load save, spin up online provider`.

### 6.2 `LoadOrCreateSave` (function)

```
Does Save Game Exist (SlotName=SaveSlotName, UserIndex=SaveUserIndex)
 └─► Branch
      True ─► Load Game from Slot ─► Cast To SG_LeaderboardSave ─► SET SaveData
      │         └─► MigrateSaveIfNeeded  (§9.4)
      False ─► Create Save Game Object (Class = SG_LeaderboardSave)
                └─► SET SaveData
                    └─► SET Username = DefaultUsername ("Bert")   (on SaveData)
                        └─► SET PlayerGUID = ToString(New Guid)   (on SaveData)
                            └─► SaveDataAsync                     (§6.9)
```

Then, in both branches: `SET ScoreMetric = SaveData.ActiveMetric`.

### 6.3 `SetUsername` (function — Name: String → Success: Boolean)

```
SanitizeUsername (local pure function, §6.4)
 └─► Branch (Condition: Length(Sanitized) >= 3)
      True ─► SET SaveData.Username = Sanitized
      │        └─► SaveDataAsync
      │            └─► Call OnUsernameChanged (Sanitized)
      │                └─► Return Success = true
      False ─► Return Success = false
```

### 6.4 `SanitizeUsername` (pure function — In: String → Out: String)

1. `Trim` then `TrimTrailing`.
2. `Replace` any of `\n \r \t` with empty.
3. Filter to letters, digits, space, `_`, `-`: loop the characters, `Append` only
   allowed ones. (A profanity list check goes here too if you ship publicly.)
4. `Left` with `Count = 16` to clamp length.
5. `Branch` — if result is empty, output `DefaultUsername`.

Never trust the raw text box. Usernames end up on a global leaderboard.

### 6.5 `CalculateScore` (pure function — Stats: `S_RunStats` → Score: Float)

**This is the single point of truth for scoring.** Change the formula here only.

```
Switch on E_ScoreMetric (ScoreMetric)
 ├─ Distance     ─► Score = Stats.DistanceMeters
 ├─ TimeSurvived ─► Score = Stats.TimeSurvivedSeconds
 ├─ TopSpeed     ─► Score = Stats.TopSpeedKPH
 └─ Points       ─► Score = Stats.Points  (int → float)
```

Want a blended score? Replace the `Points` branch body with, e.g.:
`(Distance * 1.0) + (TimeSurvived * 10.0) + (TopSpeed * 5.0) + (Points * 25.0)`.
Nothing else in the project needs to know.

### 6.6 `FormatScore` (pure function — Score: Float → Display: Text)

```
Switch on E_ScoreMetric
 ├─ Distance     ─► Format "{0} m"     (ToText float, MaxFractionalDigits = 0)
 ├─ TimeSurvived ─► mm:ss  →  Minutes = Floor(Score / 60), Seconds = Score % 60,
 │                            Format Text "{0}:{1}" with Seconds zero-padded to 2
 ├─ TopSpeed     ─► Format "{0} km/h"  (MaxFractionalDigits = 1)
 └─ Points       ─► Format "{0} pts"   (UseGrouping = true)
```

### 6.7 `SubmitScore` (function — Stats: `S_RunStats`)

The one function gameplay calls. Local write is synchronous and always succeeds;
online is fire-and-forget.

```
─── PHASE 1: SCORE ───────────────────────────────────────────
CalculateScore (Stats) ─► local var Score

─── PHASE 2: BUILD ENTRY ─────────────────────────────────────
Make S_LeaderboardEntry
   Rank         = 0                    // assigned at display time
   Username     = SaveData.Username
   Score        = Score
   DateEarned   = UtcNow
   PlayerId     = SaveData.PlayerGUID
   Tier         = GetPlayerRank(SaveData.TotalPoints)
   bIsLocalPlayer = true
 └─► local var NewEntry

─── PHASE 3: LOCAL LIST ──────────────────────────────────────
Add (SaveData.Entries, NewEntry)
 └─► SortEntries (§6.8)  — descending when bHigherIsBetter
     └─► TrimToMax:  While Length(Entries) > MaxLocalEntries → Remove Index (Last)
         └─► Find (Entries, NewEntry) ─► local var NewRankIndex

─── PHASE 4: TOTALS ──────────────────────────────────────────
SET SaveData.BestScore     = Max(SaveData.BestScore, Score)
SET SaveData.RunsCompleted = SaveData.RunsCompleted + 1
local var OldTier = GetPlayerRank(SaveData.TotalPoints)
SET SaveData.TotalPoints   = SaveData.TotalPoints + Round(Stats.Points)
local var NewTier = GetPlayerRank(SaveData.TotalPoints)
Branch (NewTier != OldTier) ─True─► Call OnRankChanged (OldTier, NewTier)

─── PHASE 5: PERSIST ─────────────────────────────────────────
SaveDataAsync (§6.9)

─── PHASE 6: ONLINE ──────────────────────────────────────────
Branch (bEnableOnline AND IsValid(OnlineProvider) AND IsOnlineReady(OnlineProvider))
 True ─► SubmitScoreOnline (Message)
 │         StatName = RunScoreStatName
 │         Value    = Round(Score * 100)      // EOS stats are integers
 │         Username = SaveData.Username
 │       SubmitScoreOnline (Message)
 │         StatName = WeeklyStatName,  Value = Round(Score * 100)
 │       SubmitScoreOnline (Message)
 │         StatName = TotalPointsStatName, Value = Round(Stats.Points)
 │       └─► StartOnlineTimeout (§6.11)
 False ─► Add (SaveData.PendingSubmissions, NewEntry)
           └─► SaveDataAsync

─── PHASE 7: NOTIFY ──────────────────────────────────────────
Call OnScoreSubmitted (bLocalSuccess=true, bOnlineSuccess=false, NewRank=NewRankIndex+1)
Call OnLeaderboardUpdated (Local, SaveData.Entries)
```

`bOnlineSuccess` is fired again as `true` later, from `HandleOnlineSubmitComplete`,
if EOS confirms. The UI shows "Saved locally" instantly and upgrades to "Submitted
online" when the callback lands — never make the player wait on the network.

### 6.8 `SortEntries` (function — In/Out: Array of `S_LeaderboardEntry`)

Blueprint has no comparator sort for structs. Use a simple insertion sort — with
`MaxLocalEntries` ≤ 20 this is free:

```
For Loop  i = 1 to Length-1
  local var Key = Entries[i]
  local var j   = i - 1
  While Loop  (j >= 0) AND IsBetter(Entries[j].Score, Key.Score) == false
      SET Entries[j+1] = Entries[j]
      SET j = j - 1
  SET Entries[j+1] = Key
```

`IsBetter (A, B)` pure helper: `Branch bHigherIsBetter → true: A >= B, false: A <= B`.
Honouring `bHigherIsBetter` here is what lets you switch to a lap-time metric later
without touching anything else.

> If you later raise `MaxLocalEntries` above ~200, move the sort into a C++
> `UBlueprintFunctionLibrary`. Insertion sort is O(n²) and Blueprint loops are slow.

### 6.9 `SaveDataAsync` (function)

```
Is Valid (SaveData)
 └─► Async Save Game to Slot
       SaveGameObject = SaveData
       SlotName       = SaveSlotName
       UserIndex      = SaveUserIndex
       Completed ─► Branch (Success)
                     True  ─► Print String "Leaderboard saved" (Dev only)
                     False ─► Call OnOnlineError ("Could not save progress.")
```

Never use plain `Save Game to Slot` here — it hitches on the game thread, and this
runs at the end of a run when the results screen is animating in.

### 6.10 `FetchLeaderboard` (function — Scope: `E_LeaderboardScope`, bForceRefresh: Boolean)

```
Switch on E_LeaderboardScope
 ├─ Local ─► Call OnLeaderboardUpdated (Local, SaveData.Entries)   // instant, no network
 │
 ├─ Global ─► FetchOnlineScoped (GlobalLeaderboardName, Global)
 └─ Weekly ─► Branch (bWeeklyIsOnline)
               True  ─► FetchOnlineScoped (WeeklyLeaderboardName, Weekly)
               False ─► BuildLocalWeekly (§7.3)
```

`FetchOnlineScoped` (collapsed graph):

```
Branch (bFetchInFlight)  ─True─► Return    // guard: no double queries
Branch (NOT bForceRefresh AND (GetTimeSeconds - LastFetchTime) < 60.0)
   True ─► Call OnLeaderboardUpdated (Scope, cached array) ─► Return
Branch (bEnableOnline AND IsOnlineReady)
   False ─► Call OnOnlineError ("Offline — showing local scores.")
            └─► Call OnLeaderboardUpdated (Scope, SaveData.Entries)
   True  ─► SET bFetchInFlight = true
            └─► StartOnlineTimeout
                └─► FetchLeaderboardOnline (Message)
                      LeaderboardName = <name>, Scope = <scope>, MaxResults = 100
```

### 6.11 Timeout + callbacks

`StartOnlineTimeout`:

```
Clear and Invalidate Timer by Handle (TimeoutHandle)
Set Timer by Event
   Time = OnlineTimeoutSeconds, Looping = false
   Event ─► HandleOnlineTimeout
   Return Value ─► SET TimeoutHandle
```

`HandleOnlineTimeout` (custom event):

```
SET bFetchInFlight = false
Call OnOnlineError ("Server didn't respond. Showing local scores.")
Call OnLeaderboardUpdated (Global, SaveData.Entries)
```

`HandleOnlineLeaderboardReceived` (custom event — Scope, Entries array) — the provider
calls this:

```
Clear and Invalidate Timer by Handle (TimeoutHandle)
SET bFetchInFlight = false
SET LastFetchTime  = Get Time Seconds
MarkLocalPlayerEntries (Entries)     // set bIsLocalPlayer where PlayerId matches
AssignRanks (Entries)                // Rank = index + 1
SET CachedGlobal / CachedWeekly  (Switch on Scope)
Call OnLeaderboardUpdated (Scope, Entries)
```

`HandleOnlineSubmitComplete` (custom event — bSuccess: Boolean):

```
Clear and Invalidate Timer by Handle (TimeoutHandle)
Branch (bSuccess)
 True ─► FlushPendingSubmissions
 │        └─► Call OnScoreSubmitted (true, true, LastKnownRank)
 False ─► Add current entry to SaveData.PendingSubmissions
           └─► SaveDataAsync
               └─► Call OnOnlineError ("Score saved locally, will upload later.")
```

`FlushPendingSubmissions`: `For Each Loop` over `PendingSubmissions` → send each via
`SubmitScoreOnline` → `Clear` the array → `SaveDataAsync`. Call this from
`InitializeOnline`'s success path too, so a queued score from last session uploads on
next launch.

### 6.12 `GetPlayerRank` (pure function — TotalPoints: Integer → Tier: `E_PlayerRank`, Row: `S_RankTier`)

```
Get Data Table Row Names (RankTable)
 └─► Reverse (array)                    // walk highest threshold first
     └─► For Each Loop with Break
           Get Data Table Row (RankTable, name) ─► Row
             └─► Branch (TotalPoints >= Row.MinTotalPoints)
                   True ─► SET Tier = Row.Tier, SET Row = Row
                           └─► Break
Default if nothing matched: Bronze + first row.
```

Also add `GetPlayerRankInfo` (no args) that just calls this with
`SaveData.TotalPoints` — the widgets use that one.

And `GetProgressToNextTier` → returns `0..1` Float plus `PointsRemaining` Integer, for
the progress bar under the rank badge. Find the current row index, look up index+1; if
there is no next row (Legend), return `1.0`.

---

## 7. UMG

### 7.1 `WBP_LeaderboardRowData` (Object)

Parent class **Object** (not a widget). One variable: `Entry` (`S_LeaderboardEntry`,
Instance Editable + Expose on Spawn). This is the payload type for `ListView`.

### 7.2 `WBP_LeaderboardRow` (User Widget)

Implements interface **`User Object List Entry`**.

Hierarchy:

```
SizeBox (Height Override 56)
└─ Overlay
   ├─ Border  "BG_Highlight"            (Visibility: Collapsed by default)
   └─ Horizontal Box
      ├─ TextBlock  "Txt_Rank"          (Size: Fill 0.12, Justification Center)
      ├─ Image      "Img_RankIcon"      (Size: Auto, 32x32)
      ├─ TextBlock  "Txt_Username"      (Size: Fill 0.48, Clipping: Clip to Bounds)
      ├─ TextBlock  "Txt_Score"         (Size: Fill 0.25, Justification Right)
      └─ TextBlock  "Txt_Date"          (Size: Fill 0.15, Justification Right)
```

Event Graph:

```
Event On List Item Object Set (ListItemObject)
 └─► Cast To WBP_LeaderboardRowData
     └─► Break S_LeaderboardEntry
         ├─► Txt_Rank      SetText  = "#" + Rank
         ├─► Txt_Username  SetText  = Username
         ├─► Txt_Score     SetText  = Manager.FormatScore(Score)
         ├─► Txt_Date      SetText  = Format DateTime (DateEarned, "%d %b")
         ├─► Img_RankIcon  SetBrushFromSoftTexture = RankRow.Icon
         │                 SetColorAndOpacity      = RankRow.TierColor
         └─► BG_Highlight  SetVisibility = bIsLocalPlayer ? Visible : Collapsed
             (and Txt_Username SetColorAndOpacity to the accent colour when local)
```

**Use `ListView`, not a `ScrollBox` full of Create Widget calls.** ListView recycles a
handful of row widgets no matter how many entries exist; a 100-row ScrollBox builds 100
widgets and will visibly hitch on the results screen.

### 7.3 `WBP_Leaderboard` (User Widget)

Hierarchy:

```
Canvas Panel
└─ Border "Frame"
   └─ Vertical Box
      ├─ Horizontal Box  "TabBar"
      │   ├─ Button "Btn_Local"   (child: TextBlock "LOCAL")
      │   ├─ Button "Btn_Global"  (child: TextBlock "GLOBAL")
      │   └─ Button "Btn_Weekly"  (child: TextBlock "WEEKLY")
      ├─ Horizontal Box  "HeaderRow"    // static column labels, mirrors the row layout
      │   └─ "#" | "" | "PLAYER" | "SCORE" | "DATE"
      ├─ Overlay
      │   ├─ ListView "LV_Entries"   (Entry Widget Class = WBP_LeaderboardRow)
      │   ├─ Throbber "Loading_Spinner"  (Collapsed)
      │   └─ TextBlock "Txt_Empty"       (Collapsed — "No scores yet. Go drive.")
      ├─ WBP_RankBadge "PlayerBadge"     // your own rank, always visible
      └─ Horizontal Box
          ├─ Button "Btn_Refresh"
          └─ Button "Btn_Close"
```

Variables: `CurrentScope` (`E_LeaderboardScope`, default `Local`), `Manager`
(`BP_LeaderboardManager` ref).

Event Graph:

```
Event Construct
 └─► Get Game Instance ─► Cast To BP_LeaderboardManager ─► SET Manager
     ├─► Bind Event to OnLeaderboardUpdated  ─► HandleLeaderboardUpdated
     ├─► Bind Event to OnOnlineError         ─► HandleOnlineError
     ├─► Bind Event to OnScoreSubmitted      ─► HandleScoreSubmitted
     └─► SwitchTab (Local)

Event Destruct
 └─► Unbind all four dispatchers          // REQUIRED — see §9.1

Btn_Local  OnClicked ─► SwitchTab (Local)
Btn_Global OnClicked ─► SwitchTab (Global)
Btn_Weekly OnClicked ─► SwitchTab (Weekly)
Btn_Refresh OnClicked ─► Manager.FetchLeaderboard (CurrentScope, bForceRefresh = true)
                          └─► ShowLoading (true)
Btn_Close  OnClicked ─► Remove from Parent  (+ Set Input Mode Game Only if in pause menu)
```

`SwitchTab` (function — Scope):

```
SET CurrentScope = Scope
UpdateTabVisuals   // tint the active button, dim the other two
ShowLoading (Scope != Local)
Manager.FetchLeaderboard (Scope, false)
```

`HandleLeaderboardUpdated` (custom event — Scope, Entries):

```
Branch (Scope == CurrentScope)          // ignore late replies from a tab you left
 True ─► ShowLoading (false)
         └─► LV_Entries: Clear List Items
             └─► For Each Loop (Entries)
                   Construct Object from Class (WBP_LeaderboardRowData, Outer = self)
                     └─► SET Entry = <element>
                         └─► LV_Entries: Add Item
             └─► Txt_Empty SetVisibility = (Length == 0) ? Visible : Collapsed
                 └─► ScrollToLocalPlayer
```

`ScrollToLocalPlayer`: find the item whose `bIsLocalPlayer` is true →
`LV_Entries → Scroll Index Into View`. On the Global tab with hundreds of rows this is
the difference between "where am I?" and a usable screen.

`BuildLocalWeekly` (on the manager, used when Weekly is computed locally): filter
`SaveData.Entries` where `UtcNow - DateEarned < 7 days`
(`Get Days`/`Subtract DateTime` → `Timespan`), sort, fire `OnLeaderboardUpdated`.

### 7.4 `WBP_RankBadge` (User Widget)

```
Horizontal Box
├─ Image     "Img_Tier"
├─ Vertical Box
│  ├─ TextBlock "Txt_Username"
│  ├─ TextBlock "Txt_Tier"           // "GOLD"
│  └─ ProgressBar "Bar_Progress"     // to next tier
└─ TextBlock "Txt_Points"            // "18,240 pts"
```

`Event Construct` → `Refresh`. `Refresh` reads `Manager.GetPlayerRankInfo` and
`GetProgressToNextTier`, sets the texture, tints `Img_Tier` and `Bar_Progress` fill with
`TierColor`, and writes the strings. Also bind `OnRankChanged` → `Refresh` and play a
promotion flourish animation.

Reuse this widget anywhere a username appears — main menu, pause menu, results screen.

### 7.5 `WBP_UsernameEntry` (User Widget)

```
Vertical Box
├─ TextBlock  "Enter your name"
├─ EditableTextBox "Txt_Input"   (HintText "Bert", MaxLength via sanitizer)
├─ TextBlock  "Txt_Error"        (Collapsed — "Needs at least 3 characters")
└─ Button     "Btn_Confirm"
```

```
Event Construct ─► Txt_Input SetText = Manager.SaveData.Username
Btn_Confirm OnClicked ─► Manager.SetUsername (Txt_Input.GetText → ToString)
                          └─► Branch (Success)
                               True  ─► Remove from Parent
                               False ─► Txt_Error SetVisibility = Visible
Txt_Input OnTextCommitted (OnEnter) ─► same path as Btn_Confirm
```

Show this automatically on first launch: in the main menu widget's `Construct`, if
`SaveData.RunsCompleted == 0`, add `WBP_UsernameEntry` to the viewport.

### 7.6 `WBP_RunSummary` (end-of-run submit screen)

```
Vertical Box
├─ TextBlock "RUN COMPLETE"
├─ TextBlock "Txt_Score"        // Manager.FormatScore(Score) — big
├─ TextBlock "Txt_Personal"     // "NEW PERSONAL BEST!" (Collapsed unless true)
├─ TextBlock "Txt_LocalRank"    // "Local rank #3"
├─ WBP_RankBadge "Badge"
├─ HorizontalBox "SubmitStatus"
│   ├─ Throbber  "Spin_Upload"
│   └─ TextBlock "Txt_UploadState"   // "Saved locally" → "Submitted to global"
└─ HorizontalBox
    ├─ Button "Btn_ViewLeaderboard"  ─► Create WBP_Leaderboard, Add to Viewport
    ├─ Button "Btn_Retry"
    └─ Button "Btn_MainMenu"
```

```
Event Construct ─► Bind Event to Manager.OnScoreSubmitted ─► HandleSubmitted
Event Destruct  ─► Unbind

HandleSubmitted (bLocal, bOnline, NewRank)
 ├─ Txt_LocalRank    SetText = "Local rank #" + NewRank
 ├─ Txt_Personal     SetVisibility = (Score >= SaveData.BestScore) ? Visible : Collapsed
 ├─ Txt_UploadState  SetText = bOnline ? "Submitted to global" : "Saved locally"
 └─ Spin_Upload      SetVisibility = bOnline ? Collapsed : Visible
```

### 7.7 Menu entry points

**Main menu** — add `Btn_Leaderboard`:

```
OnClicked ─► Create Widget (WBP_Leaderboard) ─► Add to Viewport (ZOrder 10)
             └─► Set Input Mode UI Only (Widget to Focus = the new widget)
                 └─► Set Show Mouse Cursor = true
```

**Pause menu** — same, plus `Set Game Paused = true` and tick **Is Focusable** on
`WBP_Leaderboard`. On close, restore `Set Input Mode Game Only` and unpause.

---

## 8. Integrating with the car / race Blueprint

### 8.1 Collect stats during the run

In `BP_RaceGameMode` (or your car pawn — one owner only), add an `S_RunStats` variable
named `CurrentRun`, plus `RunStartTime` (Float) and `LastPosition` (Vector).

**Do not accumulate on Tick.** Use a 0.1s looping timer:

```
Event BeginPlay
 └─► SET RunStartTime  = Get Game Time in Seconds
     SET LastPosition  = GetActorLocation (car)
     └─► Set Timer by Event (Time 0.1, Looping true) ─► SampleRun

SampleRun (custom event)
 ├─ CurrentRun.DistanceMeters += Vector Distance (CarLocation, LastPosition) / 100.0
 │        (UE units are centimetres — the /100 matters)
 ├─ SET LastPosition = CarLocation
 ├─ CurrentRun.TopSpeedKPH = Max(CurrentRun.TopSpeedKPH,
 │                               VectorLength(Car.GetVelocity()) * 0.036)
 └─ CurrentRun.TimeSurvivedSeconds = Get Game Time in Seconds - RunStartTime
```

`0.036` converts cm/s → km/h. Ten samples a second is plenty and costs nothing;
per-frame distance accumulation also drifts more at high framerate.

Award points where they happen — pickup overlap, drift chain, near-miss:
`CurrentRun.Points += <value>`.

### 8.2 Call `SubmitScore` on race end

At your `EndRace` / `OnPlayerDied` / `OnFinishLineCrossed`:

```
EndRace (custom event)
 ├─► Clear and Invalidate Timer by Handle (SampleTimerHandle)   // stop sampling FIRST
 ├─► SET CurrentRun.bCompletedRun = true
 ├─► Disable car input  (Disable Input / set a "race over" state)
 └─► Get Game Instance ─► Cast To BP_LeaderboardManager
      └─► SubmitScore (Stats = CurrentRun)
          └─► Create Widget (WBP_RunSummary)
              └─► Add to Viewport
                  └─► Set Input Mode UI Only + Show Mouse Cursor
```

Order matters: stop the timer before submitting, or a late sample mutates
`CurrentRun` after the score was calculated.

Guard against double submission — a crash that also crosses the finish line will
otherwise fire twice. Add a `bRunSubmitted` Boolean, `Branch` on it at the top of
`EndRace`, and set it true immediately.

### 8.3 Hanging avatar charm reacting to rank

The charm is the natural place to show off a tier. On the car Blueprint:

```
Event BeginPlay
 └─► Get Game Instance ─► Cast To BP_LeaderboardManager
     └─► GetPlayerRankInfo ─► Break S_RankTier
         └─► CharmMesh: Set Material (Dynamic Material Instance)
             └─► Set Vector Parameter Value ("TintColor", Row.TierColor)
                 // or Set Static Mesh from a per-tier charm mesh soft ref
```

Bind `OnRankChanged` here too so a mid-session promotion is visible immediately.

Keep the charm's physics (a constraint or a simple pendulum in the animation
blueprint) entirely separate from this — rank only drives look, never simulation.

---

## 9. Pitfalls that will bite you

### 9.1 Dispatcher leaks

Every `Bind Event to <Dispatcher>` in a widget needs a matching `Unbind Event from
<Dispatcher>` in `Event Destruct`. The manager is a GameInstance and outlives every
level; a widget that binds and never unbinds keeps itself alive and gets re-invoked
after removal, usually surfacing as "the leaderboard updates twice" or an
`Accessed None` on a destroyed widget.

### 9.2 `Cast To BP_LeaderboardManager` returns None

Almost always: Game Instance Class was never set in Project Settings (§2.3). It is not
enough to create the Blueprint.

### 9.3 Local time vs UTC

Store `UtcNow`. Display with `Format DateTime` after converting to local if you care.
Storing local time makes any future server-side comparison wrong and lets a player
change their score's date by changing their clock.

### 9.4 Save migration

Adding a variable to `SG_LeaderboardSave` is safe — old saves load with defaults.
**Removing or retyping** a variable can fail the load and silently wipe progress.
Bump `SaveVersion` and add `MigrateSaveIfNeeded`:

```
Branch (SaveData.SaveVersion < 2)
 True ─► <fix up fields>
         └─► SET SaveData.SaveVersion = 2 ─► SaveDataAsync
```

Never delete a shipped variable. Mark it deprecated and stop reading it.

### 9.5 Local saves are trivially editable

`SaveGame` files are plaintext-ish on disk and a determined player will edit them. That
is fine for a local leaderboard. It is **not** fine for a global one: anything that
matters competitively must be validated server-side, and EOS stat ingest straight from
the client is by definition trusted-client data. If the global board ever gets stakes,
move ingest behind a dedicated server or a trusted backend.

### 9.6 EOS specifics

- Stat and leaderboard names are **case-sensitive** and must match the Dev Portal.
- Stats are **integers**; the ×100 convention lives in the EOS provider only.
- The player must be logged in (Connect) before any ingest or query. Gate on
  `IsOnlineReady`, never assume.
- Aggregation is set in the portal, not the client. Ingesting a `MAX` stat with a lower
  value is a no-op, not an error — that is correct behaviour, not a bug.
- A leaderboard query returns ProductUserIds; display names need a separate lookup.
  Simplest workaround: ingest the username as part of your own metadata, or use the EOS
  user-info query the plugin exposes and cache the result.

### 9.7 Testing checklist

- [ ] First launch with no save → username is `Bert`, board is empty, no errors
- [ ] Set username to `<3` chars → rejected with visible error
- [ ] Set username with emoji/newlines → sanitized, not crashed
- [ ] Complete a run → entry appears with correct score and today's date
- [ ] Complete 25 runs → list caps at `MaxLocalEntries`, lowest score dropped
- [ ] Quit and relaunch → all entries and username persist
- [ ] Change `ScoreMetric` to `TopSpeed` → new scores use it and format as km/h
- [ ] Cross a tier threshold → `OnRankChanged` fires, badge and charm update
- [ ] Airplane mode → submit still succeeds locally, queues, no hang, no error spam
- [ ] Reconnect and relaunch → queued submission uploads
- [ ] Open leaderboard from main menu **and** pause menu → input mode restores correctly
- [ ] Switch tabs rapidly → no double lists, no stuck spinner
- [ ] Delete the save file mid-session → next save recreates cleanly

---

## 10. Performance and saving — the short version

**Saving**
- `Async Save Game to Slot` only. Never the blocking node.
- Save on meaningful events (run end, username change, tier change). Not on Tick, not
  every point pickup.
- One save object, one slot. Multiple slots multiply your migration problems.
- Cap `Entries` at `MaxLocalEntries`. An uncapped array grows forever and every save
  serialises all of it.

**UI**
- `ListView` + `User Object List Entry`, never a ScrollBox of pre-built rows.
- Build widgets on open, not on level load. `Remove from Parent` when closed.
- Soft-reference rank icons in the Data Table so all five textures aren't resident when
  only one is shown.
- No `Cast` and no `Get All Actors of Class` inside `Tick` or inside a row's refresh.

**Gameplay**
- Timer-based sampling (§8.1), not Tick accumulation.
- Cache the manager reference once in `BeginPlay`; don't re-cast per call.

**Online**
- One in-flight fetch at a time (`bFetchInFlight`).
- 60-second cache before re-querying the same scope.
- Always a timeout with a local fallback. Never a UI state that can hang forever.

---

## 11. Extension points

Designed to be added without touching existing code:

- **New score metric** → add an enum value, add one `Switch` branch in `CalculateScore`
  and one in `FormatScore`. Done.
- **New rank tier** → add a `DT_RankTiers` row. No Blueprint edit.
- **Friends-only tab** → add `E_LeaderboardScope::Friends`, one `SwitchTab` branch, one
  provider call. UI is already tab-driven.
- **Per-track leaderboards** → make `GlobalLeaderboardName` a function of the level
  name: `"GLOBAL_" + GetCurrentLevelName`. Create the matching Dev Portal definitions.
- **Seasons** → add `SeasonId` to the entry struct and filter on it, exactly like the
  local Weekly filter.
- **Rewards for tier promotion** → hook `OnRankChanged`; unlock a charm mesh per tier.
