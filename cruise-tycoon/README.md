# 🚢 Cruise Tycoon

A hybrid tycoon / fishing simulator / mini-game hub for Roblox. Players start
with a leaky rowboat, earn Doubloons through skill-based fishing and dockside
mini-games, and climb a 10-tier boat ladder to a luxury cruise liner with
passive passenger income.

Built as a **Rojo-compatible** Luau codebase: all game logic is here, in
version control. The Studio place only needs terrain, models, and art.

---

## Getting started (sync into Roblox Studio)

1. Install the toolchain (pinned in `aftman.toml`):
   ```sh
   # install aftman first: https://github.com/LPGhatguy/aftman
   aftman install
   ```
2. Serve the project from this folder:
   ```sh
   rojo serve default.project.json
   ```
3. In Roblox Studio, install the [Rojo plugin](https://rojo.space/docs/v7/getting-started/installation/),
   open a place, and click **Connect** in the plugin panel.
4. Press **Play**. The greybox world (docks, NPC stands, zone markers, water
   plane) is generated at runtime by `WorldService`, so an empty baseplate is
   enough to play the full loop immediately.

> **Studio API access:** enable *Game Settings → Security → Allow Studio Access
> to API Services* so DataStores work in Studio playtests.

For a one-shot build without live sync: `rojo build -o CruiseTycoon.rbxlx`.

---

## Folder structure

```
cruise-tycoon/
├── default.project.json          # Rojo tree mapping
├── aftman.toml                   # pinned tool versions (rojo, stylua, selene)
└── src/
    ├── ReplicatedStorage/Shared/         # shared by server AND client
    │   ├── Types.luau                    # every cross-boundary data shape
    │   ├── Remotes.luau                  # THE single registry of all remotes
    │   ├── Config/                       # all balance data, zero logic
    │   │   ├── GameConfig.luau           # tuning knobs (cooldowns, XP, market)
    │   │   ├── FishConfig.luau           # fish species + per-zone drop pools
    │   │   ├── BoatConfig.luau           # the 10 boat tiers
    │   │   ├── ZoneConfig.luau           # zones, gating, world layout
    │   │   ├── BaitConfig.luau           # bait catalog
    │   │   ├── MiniGameConfig.luau       # mini-game registry + per-game config
    │   │   ├── MonetizationConfig.luau   # cosmetics, pets, product ids
    │   │   └── BattlePassConfig.luau     # season + tier track
    │   └── Util/
    │       ├── WeightedRandom.luau       # weighted rolls with luck skew
    │       └── Format.luau               # number/weight/time formatting
    ├── ServerScriptService/
    │   ├── Server.server.luau            # bootstrap (init order matters)
    │   └── Services/
    │       ├── DataService.luau          # DataStore + session locking + retries
    │       ├── FishingService.luau       # server-authoritative fishing FSM
    │       ├── BoatService.luau          # boat spawning, upgrades, passive income
    │       ├── MarketService.luau        # selling + supply/demand simulation
    │       ├── EconomyService.luau       # rods, bait, cosmetics purchases
    │       ├── BattlePassService.luau    # XP + tier claims
    │       ├── MonetizationService.luau  # ProcessReceipt + game pass sync
    │       ├── MiniGameManager.luau      # mini-game registry/router
    │       ├── MiniGames/
    │       │   ├── CrabRacing.luau       # ✅ fully implemented reference game
    │       │   ├── TreasureDiving.luau   # 🚧 stub with design + TODOs
    │       │   └── StormNavigation.luau  # 🚧 stub with design + TODOs
    │       └── WorldService.luau         # greybox world generation
    └── StarterPlayer/StarterPlayerScripts/
        ├── Client.client.luau            # client bootstrap
        ├── Controllers/
        │   ├── ClientData.luau           # replicated PlayerData mirror
        │   ├── UIController.luau         # HUD, toasts, modals, prompt routing
        │   └── FishingController.luau    # cast button + reel timing minigame
        └── UI/
            ├── Theme.luau                # mobile-first programmatic UI kit
            ├── MarketUI.luau             # sell / bait / rod / cosmetics
            ├── UpgradeUI.luau            # boat tier ladder
            ├── DexUI.luau                # fish encyclopedia
            ├── BattlePassUI.luau         # season track
            └── CrabRacingUI.luau         # crab race betting screen
```

## Architecture notes

- **Server authority everywhere.** Clients only send intents (cast, reel
  accuracy, "buy item X"). The server rolls every fish, owns every price, and
  validates proximity for physical interactions (dockmaster, market). Reel
  accuracy is clamped 0–1 and only biases catch *weight* — a spoofing client
  gains almost nothing.
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
  `init(context)` / `handleAction(player, action, payload)`. `CrabRacing.luau`
  is the reference implementation; the two stubs contain full designs.

## Design decisions made for you (tweak in configs)

- Currency names: **Doubloons** (earned) and **Pearls** (premium).
- Boat tier costs run 500 → 1,000,000 Doubloons (roughly ×2.2 per tier).
- The reel minigame is a sweeping-marker timing bar; rod tiers widen the sweet
  spot rather than adding raw luck only, so upgrades *feel* better.
- Bait is consumed on cast (commitment), bought only with Doubloons.
- Market demand is per-server, per-rarity, recovers in ~10 minutes.
- Battle pass premium is per-season (standard industry pattern).
- Fishing works standing on any water-zone position (not just from the boat) to
  keep the greybox playable; tighten to boat-only later if desired
  (`FishingService.playerZone` is the hook).

---

## ⚠️ Manual work required in Roblox Studio

Everything below is art/content that code cannot generate — the systems are
already wired to receive it:

1. **Terrain & water** — Replace the flat greybox water plane with Terrain
   water. Sculpt the four zones to match `ZoneConfig.Layout` (Starter Bay
   island at origin, Open Ocean east, Storm Zone northeast, Deep Trench far
   east). Delete all parts with the `Greybox` attribute afterwards.
2. **Boat models** — Build/import 10 hull models and place them in
   `ServerStorage` named `BoatModel_1` … `BoatModel_10` (each needs a
   `VehicleSeat` named `DriverSeat` and a `PrimaryPart`). `BoatService` will
   automatically prefer them over generated placeholder hulls. Add skin
   variants by recoloring parts named `Hull` (that's what skins recolor).
3. **NPC characters** — Replace the dockmaster/market pedestal stands with
   rigged NPC models (keep the `ProximityPrompt` and its `UIAction` attribute —
   that's the whole integration contract).
4. **Fishing rod tools & animations** — Rod models per tier, cast/reel
   animations, rod trail VFX. Hook the equip visuals into
   `GameConfig.ROD_TIERS` and rod skins from `MonetizationConfig.RodSkins`.
5. **Fish models/icons** — Icons for the Dex UI (add an `icon` asset id field
   to `FishConfig.Fish` entries and an `ImageLabel` to `DexUI` rows).
6. **Pets** — Models + follow behavior for the three crew pets (a simple
   `AlignPosition` follower script parented to the pet model is enough; equip
   state is already in `data.cosmetics.equipped.pet`).
7. **Crab race track** — A visible race track at the Crab Racing station with
   crab models animated from the replicated 0–1 progress values (the UI already
   shows progress bars; a world-space race is pure presentation).
8. **Mini-game environments** — Underwater wreck for Treasure Diving and a
   hazard course for Storm Navigation (then implement the two stub modules —
   designs and TODO lists are in the files).
9. **Zone theming** — Skybox/lighting/particles per zone (storm rain + lightning
   in Storm Zone, fog + dark ambient in Deep Trench), plus sounds/music.
10. **Minimap** — The HUD currently shows a text zone indicator. A real
    minimap needs a top-down rendered map image (art asset) — wire it into
    `UIController.buildHud`.
11. **Monetization ids** — Create the Pearl developer products and the premium
    pass Game Pass in the Creator Dashboard, then fill in the `productId = 0`
    placeholders in `MonetizationConfig.luau`.
12. **Icons & branding** — Game icon, thumbnails, and UI sound effects.

## Suggested next steps (code)

- Implement `TreasureDiving` and `StormNavigation` (designs in the stubs).
- Boat-mounted fishing enforcement + multi-rod slots (rodSlots is stored but
  slots 2-4 are not yet used by `FishingService`).
- Leaderboards (OrderedDataStore) for total earnings / dex completion.
- Weather system feeding the Storm Zone risk/reward loop.
