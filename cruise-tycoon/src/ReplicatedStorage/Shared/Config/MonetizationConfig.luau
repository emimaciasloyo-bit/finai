--!strict
-- Cosmetic-only monetization. Pearls (premium currency) buy skins and pets;
-- nothing here raises fishing income beyond the tiny capped pet bonuses.
-- IMPORTANT: replace every `productId = 0` / `gamePassId = 0` with real ids
-- created in the Creator Dashboard before publishing.

local Types = require(script.Parent.Parent.Types)

local MonetizationConfig = {}

-- Developer Products: Pearl bundles (consumable purchases).
MonetizationConfig.PearlProducts = {
	{ productId = 0, pearls = 100, name = "Handful of Pearls" }, -- TODO real id
	{ productId = 0, pearls = 550, name = "Pouch of Pearls" }, -- TODO real id
	{ productId = 0, pearls = 1200, name = "Chest of Pearls" }, -- TODO real id
}

-- Game Pass: premium battle pass track.
MonetizationConfig.PremiumBattlePassGamePassId = 0 -- TODO real id

-- Boat skins (Pearls). `seasonal` skins should only be purchasable while the
-- matching event flag is on (see BattlePassConfig.SEASON).
MonetizationConfig.BoatSkins = {
	Midnight = {
		id = "Midnight",
		displayName = "Midnight Hull",
		pearlCost = 250,
		seasonal = false,
		color = Color3.fromRGB(15, 15, 25),
	},
	Candy = {
		id = "Candy",
		displayName = "Candy Stripe",
		pearlCost = 250,
		seasonal = false,
		color = Color3.fromRGB(255, 105, 180),
	},
	Gilded = {
		id = "Gilded",
		displayName = "Gilded Hull",
		pearlCost = 800,
		seasonal = false,
		color = Color3.fromRGB(212, 175, 55),
	},
	KrakenWrap = {
		id = "KrakenWrap",
		displayName = "Kraken Wrap",
		pearlCost = 1200,
		seasonal = true,
		color = Color3.fromRGB(60, 20, 90),
	},
}

-- Rod skins (Pearls). Purely visual.
MonetizationConfig.RodSkins = {
	Coral = { id = "Coral", displayName = "Coral Rod", pearlCost = 150, color = Color3.fromRGB(255, 127, 100) },
	Neon = { id = "Neon", displayName = "Neon Rod", pearlCost = 300, color = Color3.fromRGB(0, 255, 170) },
	Royal = { id = "Royal", displayName = "Royal Rod", pearlCost = 600, color = Color3.fromRGB(120, 60, 220) },
}

-- Pets/crew follow the player. Bonuses are intentionally tiny and hard-capped
-- below so no future config edit can sneak in pay-to-win numbers.
MonetizationConfig.MAX_PET_LUCK = 0.05
MonetizationConfig.MAX_PET_SELL_BONUS = 0.05

local Pets: { [string]: Types.PetDef } = {
	Seagull = {
		id = "Seagull",
		displayName = "First Mate Seagull",
		premiumCost = 200,
		luckBonus = 0.02,
		sellBonus = 0,
		description = "Squawks encouragingly. +2% luck.",
	},
	Crab = {
		id = "Crab",
		displayName = "Deckhand Crab",
		premiumCost = 200,
		luckBonus = 0,
		sellBonus = 0.02,
		description = "Haggles with fishmongers. +2% sell price.",
	},
	Parrot = {
		id = "Parrot",
		displayName = "Quartermaster Parrot",
		premiumCost = 500,
		luckBonus = 0.03,
		sellBonus = 0.03,
		description = "A well-rounded shoulder companion. +3%/+3%.",
	},
}
MonetizationConfig.Pets = Pets

return MonetizationConfig
