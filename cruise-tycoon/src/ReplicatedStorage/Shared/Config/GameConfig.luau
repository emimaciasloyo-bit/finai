--!strict
-- Global tuning knobs. Every "magic number" in the game should live here or in
-- a sibling config so balance passes never require touching system code.

local GameConfig = {
	-- Economy
	STARTING_DOUBLOONS = 100,
	STARTING_PEARLS = 0,

	-- Fishing
	CAST_COOLDOWN = 1.5, -- seconds between casts
	REEL_TIME_LIMIT = 12, -- client must report a reel result within this window
	REEL_MIN_TIME = 0.35, -- results faster than this are physically impossible -> reject
	-- Accuracy from the reel minigame scales catch weight between these bounds.
	ACCURACY_WEIGHT_BONUS = 0.5, -- perfect reel = +50% weight roll bias

	-- Rod progression: each tier adds luck and widens the reel "sweet spot".
	ROD_TIERS = {
		{ name = "Driftwood Rod", cost = 0, luckBonus = 0, sweetSpotSize = 0.18 },
		{ name = "Oak Rod", cost = 250, luckBonus = 0.03, sweetSpotSize = 0.20 },
		{ name = "Fiberglass Rod", cost = 1_200, luckBonus = 0.06, sweetSpotSize = 0.23 },
		{ name = "Carbon Rod", cost = 5_000, luckBonus = 0.10, sweetSpotSize = 0.26 },
		{ name = "Trident Rod", cost = 20_000, luckBonus = 0.15, sweetSpotSize = 0.30 },
		{ name = "Abyssal Rod", cost = 75_000, luckBonus = 0.22, sweetSpotSize = 0.34 },
	},

	-- Market / selling (see MarketService for the demand simulation)
	MARKET = {
		-- Demand drops by this fraction of a full recovery for every fish of a
		-- rarity sold, and recovers back to 1.0 over RECOVERY_SECONDS.
		DEMAND_HIT_PER_SALE = 0.02,
		MIN_DEMAND = 0.5,
		MAX_DEMAND = 1.5, -- scarcity bonus when nobody has sold a rarity lately
		RECOVERY_SECONDS = 600,
		-- Small random walk applied each tick so prices feel alive.
		DRIFT_INTERVAL = 30,
		DRIFT_MAGNITUDE = 0.03,
	},

	-- Interaction distances (server-validated; the client UI just mirrors them)
	DOCK_INTERACT_DISTANCE = 24,

	-- Fixed world landmarks, shared by server services (validation, building)
	-- and the client (minimap). Keep in sync with ZoneConfig.Layout.
	WORLD = {
		DOCKMASTER_POSITION = Vector3.new(-40, 5, -60),
		MARKET_POSITION = Vector3.new(40, 5, -60),
		BOAT_SPAWN = Vector3.new(0, 3, -30),
		-- Treasure Diving wreck site (seafloor of Starter Bay).
		DIVE_SITE = Vector3.new(-100, -25, 90),
		-- Storm Navigation course start (open water south of the bay).
		STORM_COURSE_START = Vector3.new(120, 2, -160),
	},

	-- Battle pass XP sources
	XP_PER_CATCH = { Common = 5, Uncommon = 10, Rare = 25, Epic = 60, Legendary = 150, Mythic = 400 },
	XP_PER_MINIGAME_WIN = 35,

	-- Passive income once the player owns the cruise liner (tier 10):
	-- NPC passengers pay ticket revenue on a timer. Tune freely.
	CRUISE_PASSIVE = {
		REQUIRED_TIER = 10,
		INTERVAL_SECONDS = 60,
		DOUBLOONS_PER_TICK = 250,
	},
}

return GameConfig
