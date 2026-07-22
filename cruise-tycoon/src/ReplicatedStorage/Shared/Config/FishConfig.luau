--!strict
-- Master fish table. Rarity is rolled first (per-zone weights in ZoneConfig),
-- then a fish of that rarity whose `zones` list includes the current zone.
-- Sell price = baseValue * rarityMult * weightFactor * zone payout * market demand.

local Types = require(script.Parent.Parent.Types)

local FishConfig = {}

-- Ordered rarest-last; UI and luck math both rely on this order.
local RarityOrder: { Types.Rarity } = { "Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic" }
FishConfig.RARITY_ORDER = RarityOrder

local RarityInfo: { [Types.Rarity]: { valueMult: number, color: Color3 } } = {
	Common = { valueMult = 1, color = Color3.fromRGB(180, 180, 180) },
	Uncommon = { valueMult = 2.2, color = Color3.fromRGB(96, 200, 96) },
	Rare = { valueMult = 5, color = Color3.fromRGB(70, 140, 255) },
	Epic = { valueMult = 12, color = Color3.fromRGB(170, 90, 240) },
	Legendary = { valueMult = 30, color = Color3.fromRGB(255, 170, 40) },
	Mythic = { valueMult = 100, color = Color3.fromRGB(255, 70, 90) },
}
FishConfig.RARITY_INFO = RarityInfo

local Fish: { [string]: Types.FishDef } = {
	-- ============ Starter Bay ============
	Sardine = {
		displayName = "Sardine",
		rarity = "Common",
		baseValue = 4,
		minWeight = 0.1,
		maxWeight = 0.4,
		zones = { "StarterBay" },
		description = "The bread and butter of every deckhand.",
	},
	Anchovy = {
		displayName = "Anchovy",
		rarity = "Common",
		baseValue = 5,
		minWeight = 0.1,
		maxWeight = 0.3,
		zones = { "StarterBay", "OpenOcean" },
		description = "Small, salty, and everywhere.",
	},
	Mackerel = {
		displayName = "Mackerel",
		rarity = "Common",
		baseValue = 7,
		minWeight = 0.5,
		maxWeight = 2,
		zones = { "StarterBay", "OpenOcean" },
		description = "Striped and speedy.",
	},
	BayBass = {
		displayName = "Bay Bass",
		rarity = "Uncommon",
		baseValue = 12,
		minWeight = 1,
		maxWeight = 4,
		zones = { "StarterBay" },
		description = "Puts up a decent fight for a bay fish.",
	},
	SilverMullet = {
		displayName = "Silver Mullet",
		rarity = "Uncommon",
		baseValue = 14,
		minWeight = 0.8,
		maxWeight = 3,
		zones = { "StarterBay" },
		description = "Its scales flash like coins underwater.",
	},
	GoldenKoi = {
		displayName = "Golden Koi",
		rarity = "Rare",
		baseValue = 25,
		minWeight = 1,
		maxWeight = 5,
		zones = { "StarterBay" },
		description = "Said to bring luck to new captains.",
	},

	-- ============ Open Ocean ============
	Tuna = {
		displayName = "Tuna",
		rarity = "Uncommon",
		baseValue = 18,
		minWeight = 10,
		maxWeight = 60,
		zones = { "OpenOcean" },
		description = "A torpedo with fins.",
	},
	Mahi = {
		displayName = "Mahi-Mahi",
		rarity = "Uncommon",
		baseValue = 20,
		minWeight = 5,
		maxWeight = 15,
		zones = { "OpenOcean" },
		description = "Brilliant gold and green.",
	},
	Swordfish = {
		displayName = "Swordfish",
		rarity = "Rare",
		baseValue = 32,
		minWeight = 30,
		maxWeight = 120,
		zones = { "OpenOcean", "StormZone" },
		description = "Handle with care.",
	},
	Marlin = {
		displayName = "Blue Marlin",
		rarity = "Epic",
		baseValue = 55,
		minWeight = 80,
		maxWeight = 400,
		zones = { "OpenOcean" },
		description = "The trophy every angler dreams about.",
	},
	MoonJelly = {
		displayName = "Moon Jelly",
		rarity = "Rare",
		baseValue = 28,
		minWeight = 0.5,
		maxWeight = 2,
		zones = { "OpenOcean", "DeepTrench" },
		description = "Glows faintly under moonlight.",
	},

	-- ============ Storm Zone ============
	StormCod = {
		displayName = "Storm Cod",
		rarity = "Uncommon",
		baseValue = 22,
		minWeight = 2,
		maxWeight = 8,
		zones = { "StormZone" },
		description = "Only surfaces when the waves turn violent.",
	},
	ThunderEel = {
		displayName = "Thunder Eel",
		rarity = "Rare",
		baseValue = 40,
		minWeight = 3,
		maxWeight = 12,
		zones = { "StormZone" },
		description = "Crackles with static. Do not lick.",
	},
	TempestRay = {
		displayName = "Tempest Ray",
		rarity = "Epic",
		baseValue = 70,
		minWeight = 20,
		maxWeight = 90,
		zones = { "StormZone" },
		description = "Rides the storm surge like a kite.",
	},
	Leviathan = {
		displayName = "Leviathan Pup",
		rarity = "Legendary",
		baseValue = 160,
		minWeight = 200,
		maxWeight = 800,
		zones = { "StormZone", "DeepTrench" },
		description = "If this is the pup, no one wants to meet the parent.",
	},

	-- ============ Deep Trench ============
	Anglerfish = {
		displayName = "Anglerfish",
		rarity = "Rare",
		baseValue = 38,
		minWeight = 5,
		maxWeight = 20,
		zones = { "DeepTrench" },
		description = "Brings its own lantern to the party.",
	},
	GulperEel = {
		displayName = "Gulper Eel",
		rarity = "Epic",
		baseValue = 65,
		minWeight = 8,
		maxWeight = 30,
		zones = { "DeepTrench" },
		description = "Mostly mouth.",
	},
	AbyssalSquid = {
		displayName = "Abyssal Squid",
		rarity = "Epic",
		baseValue = 75,
		minWeight = 40,
		maxWeight = 150,
		zones = { "DeepTrench" },
		description = "Ink black as the trench itself.",
	},
	GhostShark = {
		displayName = "Ghost Shark",
		rarity = "Legendary",
		baseValue = 180,
		minWeight = 60,
		maxWeight = 250,
		zones = { "DeepTrench" },
		description = "Seen only in the beam of a dying flashlight.",
	},
	Krakenling = {
		displayName = "Krakenling",
		rarity = "Mythic",
		baseValue = 500,
		minWeight = 300,
		maxWeight = 1200,
		zones = { "DeepTrench" },
		description = "Legends say catching one marks you forever.",
	},
	SunkenCrown = {
		displayName = "Sunken Crown Fish",
		rarity = "Mythic",
		baseValue = 650,
		minWeight = 2,
		maxWeight = 6,
		zones = { "DeepTrench" },
		description = "Wears the crown of a drowned king. Nobody asks how.",
	},
}
FishConfig.Fish = Fish

-- Build zone -> rarity -> {fishId} lookup once at require time.
local zoneRarityPools: { [string]: { [Types.Rarity]: { string } } } = {}
for fishId, def in FishConfig.Fish do
	for _, zoneId in def.zones do
		zoneRarityPools[zoneId] = zoneRarityPools[zoneId] or {}
		local pools = zoneRarityPools[zoneId]
		pools[def.rarity] = pools[def.rarity] or {}
		table.insert(pools[def.rarity] :: { string }, fishId)
	end
end
FishConfig.ZoneRarityPools = zoneRarityPools

function FishConfig.getFish(fishId: string): Types.FishDef?
	return FishConfig.Fish[fishId]
end

return FishConfig
