--!strict
-- The 10-tier boat ladder, rowboat -> luxury cruise liner.
-- `cost` is the price to upgrade INTO that tier from the previous one.
-- `appearance` is a hint for the placeholder hull the server builds; replace
-- with real models in Studio (see README "Manual Studio Work").

local Types = require(script.Parent.Parent.Types)

local BoatConfig = {}

BoatConfig.Tiers: { Types.BoatTierDef } = {
	{
		tier = 1, displayName = "Leaky Rowboat", cost = 0,
		speed = 14, storage = 8, rodSlots = 1,
		description = "It floats. Mostly.",
		appearance = { size = Vector3.new(4, 1.5, 8), color = Color3.fromRGB(110, 80, 50) },
	},
	{
		tier = 2, displayName = "Patched Dinghy", cost = 500,
		speed = 18, storage = 15, rodSlots = 1,
		description = "Fresh planks, fewer leaks.",
		appearance = { size = Vector3.new(4.5, 1.8, 9), color = Color3.fromRGB(130, 95, 60) },
	},
	{
		tier = 3, displayName = "Coastal Skiff", cost = 2_000,
		speed = 24, storage = 25, rodSlots = 1,
		description = "First boat sturdy enough for the Open Ocean.",
		appearance = { size = Vector3.new(5, 2, 11), color = Color3.fromRGB(160, 160, 170) },
	},
	{
		tier = 4, displayName = "Fishing Sloop", cost = 6_000,
		speed = 28, storage = 40, rodSlots = 2,
		description = "A proper working boat with a second rod mount.",
		appearance = { size = Vector3.new(6, 2.5, 14), color = Color3.fromRGB(200, 200, 210) },
	},
	{
		tier = 5, displayName = "Trawler", cost = 15_000,
		speed = 30, storage = 70, rodSlots = 2,
		description = "Smells like fish. That's the point.",
		appearance = { size = Vector3.new(7, 3, 17), color = Color3.fromRGB(60, 90, 140) },
	},
	{
		tier = 6, displayName = "Storm Runner", cost = 40_000,
		speed = 38, storage = 90, rodSlots = 2,
		description = "Reinforced hull rated for the Storm Zone.",
		appearance = { size = Vector3.new(7, 3.5, 19), color = Color3.fromRGB(45, 45, 55) },
	},
	{
		tier = 7, displayName = "Deep Sea Cutter", cost = 90_000,
		speed = 42, storage = 130, rodSlots = 3,
		description = "Sonar, spotlights, and a third rod mount.",
		appearance = { size = Vector3.new(8, 4, 22), color = Color3.fromRGB(30, 60, 70) },
	},
	{
		tier = 8, displayName = "Trench Explorer", cost = 200_000,
		speed = 46, storage = 180, rodSlots = 3,
		description = "Pressure-rated rigging opens the Deep Trench.",
		appearance = { size = Vector3.new(9, 4.5, 25), color = Color3.fromRGB(20, 30, 45) },
	},
	{
		tier = 9, displayName = "Coastal Yacht", cost = 450_000,
		speed = 52, storage = 250, rodSlots = 4,
		description = "Half workboat, half status symbol.",
		appearance = { size = Vector3.new(10, 5, 30), color = Color3.fromRGB(240, 240, 245) },
	},
	{
		tier = 10, displayName = "Luxury Cruise Liner", cost = 1_000_000,
		speed = 55, storage = 400, rodSlots = 4,
		description = "Hosts NPC passengers for passive ticket income. You made it, captain.",
		appearance = { size = Vector3.new(14, 8, 45), color = Color3.fromRGB(250, 250, 255) },
	},
}

function BoatConfig.getTier(tier: number): Types.BoatTierDef?
	return BoatConfig.Tiers[tier]
end

BoatConfig.MAX_TIER = #BoatConfig.Tiers

return BoatConfig
