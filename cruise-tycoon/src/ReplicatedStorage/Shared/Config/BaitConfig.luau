--!strict
-- Bait catalog. Bait is consumed per cast and bought with Doubloons at the
-- market dock (never Pearls — keep the economy free of pay-to-win).

local Types = require(script.Parent.Parent.Types)

local BaitConfig = {}

BaitConfig.Baits: { [string]: Types.BaitDef } = {
	Worm = {
		id = "Worm",
		displayName = "Worm",
		cost = 5,
		luckBonus = 0.02,
		biteSpeedMultiplier = 0.9,
		description = "A classic. Fish respect tradition.",
	},
	Shrimp = {
		id = "Shrimp",
		displayName = "Shrimp",
		cost = 20,
		luckBonus = 0.05,
		biteSpeedMultiplier = 0.85,
		description = "Irresistible to mid-tier fish.",
	},
	Squid = {
		id = "Squid",
		displayName = "Squid Chunk",
		cost = 60,
		luckBonus = 0.09,
		biteSpeedMultiplier = 0.8,
		description = "Deep water fish can smell it a mile away.",
	},
	GlowGrub = {
		id = "GlowGrub",
		displayName = "Glow Grub",
		cost = 150,
		luckBonus = 0.14,
		biteSpeedMultiplier = 0.75,
		description = "Bioluminescent bait for the darkest depths.",
	},
}

function BaitConfig.getBait(baitId: string?): Types.BaitDef?
	if baitId == nil then
		return nil
	end
	return BaitConfig.Baits[baitId]
end

return BaitConfig
