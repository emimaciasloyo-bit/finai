--!strict
-- Seasonal battle pass. Bump SEASON.number and swap the tier table each season;
-- DataService resets per-season progress automatically when the number changes.

local Types = require(script.Parent.Parent.Types)

local BattlePassConfig = {}

BattlePassConfig.SEASON = {
	number = 1,
	name = "Maiden Voyage",
}

-- xpRequired is CUMULATIVE. Rewards reference ids from Bait/Monetization configs.
BattlePassConfig.Tiers: { Types.BattlePassTier } = {
	{ xpRequired = 0, freeReward = { kind = "Doubloons", amount = 50 } },
	{ xpRequired = 100, freeReward = { kind = "Bait", itemId = "Worm", amount = 10 }, premiumReward = { kind = "Pearls", amount = 25 } },
	{ xpRequired = 250, freeReward = { kind = "Doubloons", amount = 150 }, premiumReward = { kind = "RodSkin", itemId = "Coral" } },
	{ xpRequired = 500, freeReward = { kind = "Bait", itemId = "Shrimp", amount = 10 } },
	{ xpRequired = 900, freeReward = { kind = "Doubloons", amount = 400 }, premiumReward = { kind = "Pearls", amount = 50 } },
	{ xpRequired = 1400, freeReward = { kind = "Bait", itemId = "Squid", amount = 8 }, premiumReward = { kind = "BoatSkin", itemId = "Candy" } },
	{ xpRequired = 2000, freeReward = { kind = "Doubloons", amount = 800 } },
	{ xpRequired = 2800, freeReward = { kind = "Bait", itemId = "GlowGrub", amount = 6 }, premiumReward = { kind = "Pet", itemId = "Seagull" } },
	{ xpRequired = 3800, freeReward = { kind = "Doubloons", amount = 1500 }, premiumReward = { kind = "Pearls", amount = 100 } },
	{ xpRequired = 5000, freeReward = { kind = "Doubloons", amount = 3000 }, premiumReward = { kind = "BoatSkin", itemId = "KrakenWrap" } },
}

return BattlePassConfig
