--!strict
-- Fish selling + a lightweight supply/demand simulation.
--
-- Each rarity has a demand multiplier that starts at 1.0, takes a hit for
-- every fish of that rarity sold on this server, and recovers linearly over
-- time (plus a small random drift so prices feel alive even in quiet servers).
-- Sell price = baseValue * rarityMult * weightFactor * zonePayout * demand * petBonus.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local FishConfig = require(Shared.Config.FishConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)

local MarketService = {}

local MARKET = GameConfig.MARKET

-- Live demand state per rarity (server-local by design: each server is its own
-- little fish market, which also spreads load across the shard).
local demand: { [string]: number } = {}
for _, rarity in FishConfig.RARITY_ORDER do
	demand[rarity] = 1
end

-- World anchor for the market dock; the sell remote validates proximity so the
-- interaction stays physical. WorldService creates the placeholder NPC here.
MarketService.DOCK_POSITION = Vector3.new(40, 5, -60)

local function recoverAndDrift()
	while true do
		task.wait(MARKET.DRIFT_INTERVAL)
		local recovery = MARKET.DRIFT_INTERVAL / MARKET.RECOVERY_SECONDS
		for rarity, value in demand do
			local drifted = value + recovery + (math.random() * 2 - 1) * MARKET.DRIFT_MAGNITUDE
			demand[rarity] = math.clamp(drifted, MARKET.MIN_DEMAND, MARKET.MAX_DEMAND)
		end
	end
end

function MarketService.priceFor(data: any, catch: any): number
	local def = FishConfig.getFish(catch.fishId)
	if not def then
		return 0
	end
	local rarityInfo = FishConfig.RARITY_INFO[def.rarity]
	local zone = ZoneConfig.getZone(catch.zoneId)
	-- Weight factor: average-weight fish = 1.0, trophy weight up to 2.0.
	local weightSpan = math.max(def.maxWeight - def.minWeight, 0.01)
	local weightFactor = 0.5 + (catch.weight - def.minWeight) / weightSpan * 1.5

	local petBonus = 1
	local petId = data.cosmetics.equipped.pet
	local pet = petId and MonetizationConfig.Pets[petId]
	if pet then
		petBonus += math.min(pet.sellBonus, MonetizationConfig.MAX_PET_SELL_BONUS)
	end

	local price = def.baseValue
		* rarityInfo.valueMult
		* weightFactor
		* (zone and zone.payoutMultiplier or 1)
		* demand[def.rarity]
		* petBonus
	return math.max(1, math.floor(price))
end

local function nearDock(player: Player): boolean
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return false
	end
	return (root.Position - MarketService.DOCK_POSITION).Magnitude <= GameConfig.DOCK_INTERACT_DISTANCE
end

local function onSellAllFish(player: Player): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	if not nearDock(player) then
		return { ok = false, message = "Sail to the market dock to sell." }
	end
	if #data.fishInventory == 0 then
		return { ok = false, message = "Your hold is empty." }
	end

	local earned = 0
	for _, catch in data.fishInventory do
		earned += MarketService.priceFor(data, catch)
		-- Every sale nudges that rarity's demand down.
		local def = FishConfig.getFish(catch.fishId)
		if def then
			demand[def.rarity] = math.clamp(
				demand[def.rarity] - MARKET.DEMAND_HIT_PER_SALE,
				MARKET.MIN_DEMAND,
				MARKET.MAX_DEMAND
			)
		end
	end

	local count = #data.fishInventory
	data.fishInventory = {}
	DataService.adjustDoubloons(player, earned)
	DataService.replicate(player, { "fishInventory" })
	return { ok = true, earned = earned, message = `Sold {count} fish for {earned} Doubloons!` }
end

local function onGetMarketPrices(_player: Player): any
	-- Shallow copy so the client can't mutate server state via the reference.
	local snapshot = {}
	for rarity, value in demand do
		snapshot[rarity] = math.floor(value * 100) / 100
	end
	return snapshot
end

function MarketService.init()
	Remotes.getFunction("SellAllFish").OnServerInvoke = onSellAllFish
	Remotes.getFunction("GetMarketPrices").OnServerInvoke = onGetMarketPrices
	task.spawn(recoverAndDrift)
end

return MarketService
