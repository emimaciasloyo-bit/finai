--!strict
-- Mini-game registry. Each entry maps to a ModuleScript in
-- ServerScriptService/Services/MiniGames/<id>.luau implementing the
-- MiniGameManager interface (see that file for the contract).

local MiniGameConfig = {}

MiniGameConfig.Games = {
	CrabRacing = {
		id = "CrabRacing",
		displayName = "Crab Racing",
		description = "Bet on the fastest crustacean in the bay.",
		-- Station placement (placeholder pad; build a real crab track in Studio)
		stationPosition = Vector3.new(80, 5, 120),
		enabled = true,
		config = {
			crabCount = 4,
			trackLength = 100, -- abstract units, replicated as 0..1 progress
			bettingSeconds = 20,
			raceSeconds = 15,
			minBet = 10,
			maxBet = 5_000,
			-- Payout = bet * odds of the chosen crab (house takes nothing; the
			-- spread comes from odds rounding). Odds derive from hidden speed.
		},
	},
	TreasureDiving = {
		id = "TreasureDiving",
		displayName = "Treasure Diving",
		description = "Dive the wreck and grab treasure before your air runs out.",
		stationPosition = Vector3.new(-100, 5, 90),
		enabled = false, -- TODO: enable once TreasureDiving.luau is implemented
		config = {
			divingSeconds = 60,
			treasureCount = 12,
			payoutPerTreasure = 15,
		},
	},
	StormNavigation = {
		id = "StormNavigation",
		displayName = "Storm Navigation",
		description = "Steer a course through the squall for a bonus payout.",
		stationPosition = Vector3.new(120, 5, -90),
		enabled = false, -- TODO: enable once StormNavigation.luau is implemented
		config = {
			courseSeconds = 45,
			hazardCount = 10,
			basePayout = 200,
		},
	},
}

return MiniGameConfig
