--!strict
-- Fishing zones. Each zone is a named region in Workspace ("Zones/<id>") whose
-- bounds gate both travel (boat tier) and the fish drop table.
-- Positions/sizes here drive the placeholder region parts the server spawns;
-- sculpt the real terrain in Studio to roughly match.

local Types = require(script.Parent.Parent.Types)

local ZoneConfig = {}

ZoneConfig.Zones: { [string]: Types.ZoneDef } = {
	StarterBay = {
		id = "StarterBay",
		displayName = "Starter Bay",
		requiredBoatTier = 1,
		rarityWeights = { Common = 70, Uncommon = 25, Rare = 5, Epic = 0, Legendary = 0, Mythic = 0 },
		biteTimeRange = { min = 2, max = 5 },
		payoutMultiplier = 1,
		description = "Calm, shallow water. Learn the ropes here.",
	},
	OpenOcean = {
		id = "OpenOcean",
		displayName = "Open Ocean",
		requiredBoatTier = 3,
		rarityWeights = { Common = 40, Uncommon = 38, Rare = 17, Epic = 5, Legendary = 0, Mythic = 0 },
		biteTimeRange = { min = 3, max = 7 },
		payoutMultiplier = 1.25,
		description = "Big water, bigger fish.",
	},
	StormZone = {
		id = "StormZone",
		displayName = "Storm Zone",
		requiredBoatTier = 6,
		rarityWeights = { Common = 15, Uncommon = 35, Rare = 30, Epic = 15, Legendary = 5, Mythic = 0 },
		biteTimeRange = { min = 4, max = 9 },
		payoutMultiplier = 1.75,
		description = "High risk, high reward. Bring a reinforced hull.",
	},
	DeepTrench = {
		id = "DeepTrench",
		displayName = "Deep Trench",
		requiredBoatTier = 8,
		rarityWeights = { Common = 5, Uncommon = 20, Rare = 35, Epic = 25, Legendary = 12, Mythic = 3 },
		biteTimeRange = { min = 5, max = 12 },
		payoutMultiplier = 2.5,
		description = "The abyss stares back — and it's full of Doubloons.",
	},
}

-- Placeholder world layout (studs, XZ plane). Studio terrain should follow this
-- rough map so zone gating matches the geography.
ZoneConfig.Layout: { [string]: { center: Vector3, size: Vector3 } } = {
	StarterBay = { center = Vector3.new(0, 0, 0), size = Vector3.new(512, 100, 512) },
	OpenOcean = { center = Vector3.new(1024, 0, 0), size = Vector3.new(1024, 200, 1024) },
	StormZone = { center = Vector3.new(1024, 0, 1280), size = Vector3.new(1024, 200, 1024) },
	DeepTrench = { center = Vector3.new(2560, 0, 640), size = Vector3.new(1024, 400, 1024) },
}

function ZoneConfig.getZone(zoneId: string): Types.ZoneDef?
	return ZoneConfig.Zones[zoneId]
end

-- Returns the zone id containing a world position, or nil if outside all zones.
function ZoneConfig.zoneAtPosition(position: Vector3): string?
	for zoneId, bounds in ZoneConfig.Layout do
		local half = bounds.size / 2
		local offset = position - bounds.center
		if math.abs(offset.X) <= half.X and math.abs(offset.Z) <= half.Z then
			return zoneId
		end
	end
	return nil
end

return ZoneConfig
