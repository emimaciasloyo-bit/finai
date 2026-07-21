--!strict
-- Doubloon-economy purchases that aren't boats: rod upgrades, bait, plus
-- cosmetic buy/equip (Pearls). Every path validates server-side — the client
-- request is only ever an id, never a price.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local BaitConfig = require(Shared.Config.BaitConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)
local BoatService = require(script.Parent.BoatService)

local EconomyService = {}

local MAX_BAIT_PER_PURCHASE = 100

--------------------------------------------------------------------------------
-- Rod upgrades
--------------------------------------------------------------------------------

local function onUpgradeRod(player: Player): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	local nextTier = GameConfig.ROD_TIERS[data.rodTier + 1]
	if not nextTier then
		return { ok = false, message = "Your rod is already the best there is." }
	end
	if not DataService.adjustDoubloons(player, -nextTier.cost) then
		return { ok = false, message = `You need {nextTier.cost} Doubloons for the {nextTier.name}.` }
	end
	data.rodTier += 1
	DataService.replicate(player, { "rodTier" })
	return { ok = true, newTier = data.rodTier }
end

--------------------------------------------------------------------------------
-- Bait
--------------------------------------------------------------------------------

local function onBuyBait(player: Player, baitId: unknown, amount: unknown): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	local bait = typeof(baitId) == "string" and BaitConfig.getBait(baitId) or nil
	if not bait then
		return { ok = false, message = "Unknown bait" }
	end
	local quantity = typeof(amount) == "number" and math.floor(amount) or 0
	if quantity < 1 or quantity > MAX_BAIT_PER_PURCHASE then
		return { ok = false, message = "Invalid amount" }
	end
	local totalCost = bait.cost * quantity
	if not DataService.adjustDoubloons(player, -totalCost) then
		return { ok = false, message = `That costs {totalCost} Doubloons.` }
	end
	data.baitInventory[bait.id] = (data.baitInventory[bait.id] or 0) + quantity
	DataService.replicate(player, { "baitInventory" })
	return { ok = true, message = `Bought {quantity}x {bait.displayName}.` }
end

local function onEquipBait(player: Player, baitId: unknown): any
	local data = DataService.get(player)
	if not data then
		return { ok = false }
	end
	if baitId == nil then
		data.equippedBait = nil
	else
		if typeof(baitId) ~= "string" or (data.baitInventory[baitId] or 0) <= 0 then
			return { ok = false }
		end
		data.equippedBait = baitId
	end
	DataService.replicate(player, { "equippedBait" })
	return { ok = true }
end

--------------------------------------------------------------------------------
-- Cosmetics (Pearls) — buy & equip
--------------------------------------------------------------------------------

type CosmeticCategory = "boatSkin" | "rodSkin" | "pet"

local function catalogFor(category: string): (any?, string?)
	if category == "boatSkin" then
		return MonetizationConfig.BoatSkins, "boatSkins"
	elseif category == "rodSkin" then
		return MonetizationConfig.RodSkins, "rodSkins"
	elseif category == "pet" then
		return MonetizationConfig.Pets, "pets"
	end
	return nil, nil
end

local function onBuyCosmetic(player: Player, category: unknown, itemId: unknown): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	if typeof(category) ~= "string" or typeof(itemId) ~= "string" then
		return { ok = false, message = "Invalid request" }
	end
	local catalog, ownedKey = catalogFor(category)
	if not catalog or not ownedKey then
		return { ok = false, message = "Invalid category" }
	end
	local item = catalog[itemId]
	if not item then
		return { ok = false, message = "Unknown item" }
	end
	if data.cosmetics[ownedKey][itemId] then
		return { ok = false, message = "Already owned" }
	end
	local cost = item.pearlCost or item.premiumCost or 0
	if not DataService.adjustPearls(player, -cost) then
		return { ok = false, message = `You need {cost} Pearls.` }
	end
	data.cosmetics[ownedKey][itemId] = true
	DataService.replicate(player, { "cosmetics" })
	return { ok = true, message = `Purchased {item.displayName}!` }
end

local function onEquipCosmetic(player: Player, category: unknown, itemId: unknown): any
	local data = DataService.get(player)
	if not data then
		return { ok = false }
	end
	if typeof(category) ~= "string" then
		return { ok = false }
	end
	local catalog, ownedKey = catalogFor(category)
	if not catalog or not ownedKey then
		return { ok = false }
	end
	if itemId ~= nil then
		if typeof(itemId) ~= "string" or not data.cosmetics[ownedKey][itemId] then
			return { ok = false } -- can only equip what you own
		end
	end
	data.cosmetics.equipped[category] = itemId
	DataService.replicate(player, { "cosmetics" })
	if category == "boatSkin" then
		BoatService.spawnBoat(player) -- respawn to apply the new hull paint
	end
	return { ok = true }
end

--------------------------------------------------------------------------------

function EconomyService.init()
	Remotes.getFunction("UpgradeRod").OnServerInvoke = onUpgradeRod
	Remotes.getFunction("BuyBait").OnServerInvoke = onBuyBait
	Remotes.getFunction("EquipBait").OnServerInvoke = onEquipBait
	Remotes.getFunction("BuyCosmetic").OnServerInvoke = onBuyCosmetic
	Remotes.getFunction("EquipCosmetic").OnServerInvoke = onEquipCosmetic

	-- Full-snapshot fetch for UI boot.
	Remotes.getFunction("GetData").OnServerInvoke = function(player: Player)
		return DataService.get(player)
	end
end

return EconomyService
