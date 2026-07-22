# 🚢 Cruise Tycoon

A hybrid tycoon / fishing simulator / mini-game hub for Roblox. Players start
with a leaky rowboat, earn Doubloons through skill-based fishing and dockside
mini-games, and climb a 10-tier boat ladder to a luxury cruise liner with
passive passenger income.

Built as a **Rojo-compatible** Luau codebase with **zero uploaded assets**:
the entire world (Terrain water, islands, docks, NPCs, boats, pets, the crab
race track, mini-game courses) is generated procedurally at server start, so
the game is fully playable straight from this repository.

---

## ▶️ Play it right now (zero setup)

1. Install [Roblox Studio](https://create.roblox.com/) (free).
2. Open **`CruiseTycoon.rbxlx`** from this folder (File → Open from File, or
   double-click it).
3. Enable *Game Settings → Security → Allow Studio Access to API Services*
   (needed once, for DataStores; playtesting works without it but progress
   won't save).
4. Press **Play** (F5). Give the server a few seconds to fill the terrain
   water on first spawn.

`CruiseTycoon.rbxlx` is generated from `src/` by `tools/build_rbxlx.py`
(plain Python, no dependencies) — regenerate it after editing any script:

```sh
python3 tools/build_rbxlx.py
```

### Developing with Rojo (live sync, recommended for ongoing work)

```sh
aftman install        # installs rojo/stylua/selene pinned in aftman.toml
rojo serve default.project.json
```

Then connect the [Rojo Studio plugin](https://rojo.space/docs/v7/getting-started/installation/)
to an empty place and press Play. Format/lint with `stylua --syntax Luau src/`.

---

## What's in the box

| System | Status |
| --- | --- |
| Fishing (cast → bite → reel timing bar, 22 species, 6 rarities, 4 zone drop tables, bait, luck) | ✅ server-authoritative |
| Boat ladder (10 procedural tier models, physical dockmaster upgrades, drive physics) | ✅ |
| Economy (sell market with supply/demand price sim, rod upgrades, bait shop) | ✅ |
| Mini-games: Crab Racing (live world-space races + betting), Treasure Diving, Storm Navigation | ✅ all three playable |
| Battle pass (10 tiers, free + premium tracks, season rollover) | ✅ |
| Cosmetics (boat skins, rod skins, follower pets with capped bonuses) — Pearls only, no pay-to-win | ✅ |
| Saves (DataStore session locking, retries, autosave, BindToClose, migrations, idempotent receipts) | ✅ |
| World (Terrain water, beach island, wooden docks, sunken wreck, zone buoys, NPCs) | ✅ procedural |
| UI (mobile-first HUD, minimap, fish dex, shops, battle pass, mini-game screens, toasts) | ✅ |
| Zone ambience (per-zone fog/lighting, Storm Zone rain + lightning, Deep Trench gloom) | ✅ |

## Folder structure

```
cruise-tycoon/
├── CruiseTycoon.rbxlx            # ready-to-open place file (generated)
├── default.project.json          # Rojo tree mapping
├── aftman.toml                   # pinned tool versions (rojo, stylua, selene)
├── tools/build_rbxlx.py          # src/ -> .rbxlx compiler (no Rojo needed)
└── src/
    ├── ReplicatedStorage/Shared/         # shared by server AND client
    │   ├── Types.luau                    # every cross-boundary data shape
    │   ├── Remotes.luau                  # THE single registry of all remotes
    │   ├── Config/                       # all balance data, zero logic
    │   │   ├── GameConfig.luau           # tuning knobs + world landmark positions
    │   │   ├── FishConfig.luau           # fish species + per-zone drop pools
    │   │   ├── BoatConfig.luau           # the 10 boat tiers
    │   │   ├── ZoneConfig.luau           # zones, gating, world layout
    │   │   ├── BaitConfig.luau           # bait catalog
    │   │   ├── MiniGameConfig.luau       # mini-game registry + per-game config
    │   │   ├── MonetizationConfig.luau   # cosmetics, pets, product ids
    │   │   └── BattlePassConfig.luau     # season + tier track
    │   └── Util/                         # WeightedRandom (luck rolls), Format
    ├── ServerScriptService/
    │   ├── Server.server.luau            # bootstrap (init order matters)
    │   └── Services/
    │       ├── DataService.luau          # DataStore + session locking + retries
    │       ├── FishingService.luau       # server-authoritative fishing FSM
    │       ├── BoatService.luau          # boat spawn/upgrade/drive, passive income
    │       ├── MarketService.luau        # selling + supply/demand simulation
    │       ├── EconomyService.luau       # rods, bait, cosmetics purchases
    │       ├── BattlePassService.luau    # XP + tier claims
    │       ├── MonetizationService.luau  # ProcessReceipt + game pass sync
    │       ├── PetService.luau           # follower pet models
    │       ├── ModelFactory.luau         # procedural boats/NPCs/pets/crabs/buoys
    │       ├── MiniGameManager.luau      # mini-game registry/router
    │       ├── MiniGames/                # CrabRacing, TreasureDiving, StormNavigation
    │       └── WorldService.luau         # terrain + world generation
    └── StarterPlayer/StarterPlayerScripts/
        ├── Client.client.luau            # client bootstrap
        ├── Controllers/                  # ClientData, UIController, Fishing,
        │                                 # Minimap, Ambience
        └── UI/                           # Theme kit + all screens
```

## Architecture notes

- **Server authority everywhere.** Clients only send intents (cast, reel
  accuracy, "buy item X"). The server rolls every fish, owns every price,
  validates proximity for physical interactions, checkpoint order for Storm
  Navigation, and chest distance for Treasure Diving. Reel accuracy is clamped
  0–1 and only biases catch *weight*.
- **Remotes** are declared in exactly one file (`Shared/Remotes.luau`), created
  by the server at boot. Auditing the attack surface = reading that file.
- **Data safety.** `DataService` implements ProfileService-style session
  locking (lock record inside the stored value, stolen only when stale),
  `UpdateAsync`-only writes, exponential-backoff retries, autosave,
  `BindToClose` flush, and schema versioning with a migration hook. Robux
  receipts are recorded before granting for idempotency (anti-dupe).
- **No pay-to-win.** Pearls buy cosmetics and pets whose bonuses are hard
  capped (`MAX_PET_LUCK = 0.05`) in config.
- **Adding a mini-game** = one config entry + one module implementing
  `init(context)` / `handleAction(player, action, payload)`.
- **Swapping art in** never touches logic: boat models are looked up in
  `ServerStorage` as `BoatModel_<tier>` before falling back to procedural
  ones; NPC prompts carry a `UIAction` attribute that is the whole client
  contract; everything world-generated is tagged with a `Greybox` attribute
  for easy cleanup.

## Design decisions made for you (tweak in configs)

- Currency names: **Doubloons** (earned) and **Pearls** (premium).
- Boat tier costs run 500 → 1,000,000 Doubloons (roughly ×2.2 per tier).
- Rod tiers widen the reel sweet spot *and* add luck, so upgrades feel better.
- Bait is consumed on cast (commitment), bought only with Doubloons.
- Market demand is per-server, per-rarity, recovers in ~10 minutes.
- Battle pass premium is per-season (standard industry pattern).
- Crab race odds derive from hidden crab speeds with per-tick noise, so the
  favorite usually-but-not-always wins and value betting exists.
- Storm Navigation uses a loaner skiff so the course is fair at every boat tier.

---

## ⚠️ The short list that genuinely needs a human with the Roblox account

Everything below requires being logged into Roblox — code cannot do it:

1. **Publish the place** — File → Publish to Roblox from Studio.
2. **Create monetization products** in the Creator Dashboard (3 Pearl
   developer products + 1 premium-pass Game Pass), then paste the ids into
   the `productId = 0` / `PremiumBattlePassGamePassId = 0` placeholders in
   `MonetizationConfig.luau`.
3. **Game icon & thumbnails** — image uploads on the game's Creator page.
4. **Optional art pass** — replace procedural models/terrain with real meshes,
   add uploaded animations (rod casting, NPC idles) and audio (music, SFX,
   rain/thunder). All hooks are noted above; none of it blocks playing.

## Suggested next steps (code)

- Leaderboards (OrderedDataStore) for total earnings / dex completion.
- Multi-rod fishing using the stored `rodSlots` (slots 2–4 currently unused).
- A weather system feeding Storm Zone risk/reward.
- Trading between players (needs careful anti-dupe design on top of the
  session locks).
