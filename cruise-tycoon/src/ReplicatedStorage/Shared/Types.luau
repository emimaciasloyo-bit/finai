--!strict
-- Shared type definitions used by both the server and the client.
-- Keep every cross-boundary data shape here so remotes stay honest.

export type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary" | "Mythic"

export type FishDef = {
	displayName: string,
	rarity: Rarity,
	baseValue: number, -- Doubloons before rarity/market multipliers
	minWeight: number, -- kg
	maxWeight: number, -- kg
	zones: { string }, -- ZoneConfig ids this fish can appear in
	description: string,
}

export type CaughtFish = {
	fishId: string,
	weight: number, -- rolled kg, affects sell value
	caughtAt: number, -- os.time()
	zoneId: string,
}

export type DexEntry = {
	caught: number,
	bestWeight: number,
	firstCaughtAt: number,
}

export type BoatTierDef = {
	tier: number,
	displayName: string,
	cost: number, -- Doubloons to upgrade INTO this tier
	speed: number, -- studs/sec used by the VehicleSeat
	storage: number, -- max fish held before selling
	rodSlots: number,
	description: string,
	-- Purely visual hints for the Studio pass (hull size/colors); logic never reads these.
	appearance: { size: Vector3, color: Color3 },
}

export type ZoneDef = {
	id: string,
	displayName: string,
	requiredBoatTier: number,
	-- Weighted rarity table; FishingService rolls rarity first, then a fish of
	-- that rarity that lists this zone.
	rarityWeights: { [Rarity]: number },
	biteTimeRange: { min: number, max: number }, -- seconds until a bite
	payoutMultiplier: number, -- zone-wide sell value bonus (risk/reward)
	description: string,
}

export type BaitDef = {
	id: string,
	displayName: string,
	cost: number,
	-- Additive luck shifts rarity weights toward the rare end (see FishingService).
	luckBonus: number,
	biteSpeedMultiplier: number, -- <1 means faster bites
	description: string,
}

export type PetDef = {
	id: string,
	displayName: string,
	premiumCost: number, -- Pearls
	-- Deliberately tiny bonuses: cosmetics-first, never pay-to-win.
	luckBonus: number, -- capped at 0.05 by MonetizationConfig.MAX_PET_LUCK
	sellBonus: number, -- capped at 0.05
	description: string,
}

export type BattlePassReward = {
	kind: "Doubloons" | "Pearls" | "Bait" | "BoatSkin" | "RodSkin" | "Pet",
	amount: number?,
	itemId: string?,
}

export type BattlePassTier = {
	xpRequired: number, -- cumulative XP to reach this tier
	freeReward: BattlePassReward?,
	premiumReward: BattlePassReward?,
}

-- The full persisted player profile. Bump DataService.SCHEMA_VERSION and add a
-- migration step whenever this shape changes.
export type PlayerData = {
	schemaVersion: number,
	doubloons: number,
	pearls: number,
	boatTier: number,
	rodTier: number,
	equippedBait: string?, -- BaitDef id
	baitInventory: { [string]: number },
	fishInventory: { CaughtFish },
	fishDex: { [string]: DexEntry },
	cosmetics: {
		boatSkins: { [string]: boolean },
		rodSkins: { [string]: boolean },
		pets: { [string]: boolean },
		equipped: { boatSkin: string?, rodSkin: string?, pet: string? },
	},
	miniGameHighScores: { [string]: number },
	battlePass: {
		season: number,
		xp: number,
		ownsPremium: boolean,
		claimedFree: { [string]: boolean }, -- keyed by tostring(tierIndex)
		claimedPremium: { [string]: boolean },
	},
	stats: {
		totalCatches: number,
		totalEarned: number,
		joinCount: number,
	},
	-- Receipt PurchaseIds already granted; makes ProcessReceipt idempotent.
	redeemedReceipts: { [string]: boolean },
}

return nil
