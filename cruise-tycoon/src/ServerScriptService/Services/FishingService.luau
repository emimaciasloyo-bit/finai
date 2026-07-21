--!strict
-- Server-authoritative fishing loop.
--
-- State machine per player: Idle -> WaitingBite -> Reeling -> Idle.
-- The client only ever sends *intents* (cast, reel accuracy); the server:
--   * validates zone access against boat tier and character position
--   * rolls the fish (rarity -> species -> weight) entirely server-side
--   * enforces cast cooldowns, reel time windows, and storage capacity
-- A hacked client can therefore never choose its fish, skip the wait, or
-- exceed its cargo hold.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local FishConfig = require(Shared.Config.FishConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local BaitConfig = require(Shared.Config.BaitConfig)
local BoatConfig = require(Shared.Config.BoatConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)
local WeightedRandom = require(Shared.Util.WeightedRandom)

local DataService = require(script.Parent.DataService)
local BattlePassService = require(script.Parent.BattlePassService)

local FishingService = {}

type FishingState = {
	phase: "Idle" | "WaitingBite" | "Reeling",
	lastCastAt: number,
	biteAt: number, -- os.clock() when the bite fired
	castId: number, -- monotonically increasing; stale delayed threads compare it
	pendingFishId: string?,
	pendingZoneId: string?,
}

local states: { [Player]: FishingState } = {}

local function getState(player: Player): FishingState
	local state = states[player]
	if not state then
		state = { phase = "Idle", lastCastAt = 0, biteAt = 0, castId = 0 }
		states[player] = state
	end
	return state
end

--------------------------------------------------------------------------------
-- Luck & rolls
--------------------------------------------------------------------------------

-- Total luck = rod + equipped bait + equipped pet (pet capped in config).
local function computeLuck(data: any): number
	local rod = GameConfig.ROD_TIERS[data.rodTier]
	local luck = rod and rod.luckBonus or 0
	local bait = BaitConfig.getBait(data.equippedBait)
	if bait then
		luck += bait.luckBonus
	end
	local petId = data.cosmetics.equipped.pet
	local pet = petId and MonetizationConfig.Pets[petId]
	if pet then
		luck += math.min(pet.luckBonus, MonetizationConfig.MAX_PET_LUCK)
	end
	return math.clamp(luck, 0, 1)
end

local function rollFish(zoneId: string, luck: number): string?
	local zone = ZoneConfig.getZone(zoneId)
	local pools = FishConfig.ZoneRarityPools[zoneId]
	if not zone or not pools then
		return nil
	end
	-- Ordered common->rare so WeightedRandom's luck skew helps rarity.
	local entries = {}
	for _, rarity in FishConfig.RARITY_ORDER do
		local weight = zone.rarityWeights[rarity] or 0
		if weight > 0 and pools[rarity] and #pools[rarity] > 0 then
			table.insert(entries, { value = rarity, weight = weight })
		end
	end
	local rarity = WeightedRandom.pick(entries, luck)
	if not rarity then
		return nil
	end
	local pool = pools[rarity :: any]
	return pool[math.random(1, #pool)]
end

--------------------------------------------------------------------------------
-- Cast / bite / reel
--------------------------------------------------------------------------------

local function playerZone(player: Player): string?
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return nil
	end
	return ZoneConfig.zoneAtPosition(root.Position)
end

local function onCastRequest(player: Player)
	local data = DataService.get(player)
	local state = getState(player)
	if not data or state.phase ~= "Idle" then
		return
	end
	if os.clock() - state.lastCastAt < GameConfig.CAST_COOLDOWN then
		return
	end

	-- Zone gating: must physically be in a zone their boat tier allows.
	local zoneId = playerZone(player)
	local zone = zoneId and ZoneConfig.getZone(zoneId)
	if not zoneId or not zone then
		Remotes.getEvent("Notify"):FireClient(player, "You need to be on the water to fish.", "error")
		return
	end
	if data.boatTier < zone.requiredBoatTier then
		Remotes.getEvent("Notify"):FireClient(player, `Your boat can't handle {zone.displayName} yet.`, "error")
		return
	end

	-- Storage gating against the CURRENT boat's hold.
	local boat = BoatConfig.getTier(data.boatTier)
	if boat and #data.fishInventory >= boat.storage then
		Remotes.getEvent("Notify"):FireClient(player, "Your hold is full! Sell your catch at the market dock.", "error")
		return
	end

	state.phase = "WaitingBite"
	state.lastCastAt = os.clock()
	state.castId += 1
	local thisCast = state.castId

	-- Consume bait NOW (cast = commitment) and compute bite delay.
	local bait = BaitConfig.getBait(data.equippedBait)
	local biteMultiplier = 1
	if bait then
		local held = data.baitInventory[bait.id] or 0
		if held > 0 then
			data.baitInventory[bait.id] = held - 1
			biteMultiplier = bait.biteSpeedMultiplier
			if data.baitInventory[bait.id] == 0 then
				data.equippedBait = nil
			end
			DataService.replicate(player, { "baitInventory", "equippedBait" })
		else
			data.equippedBait = nil -- had it equipped but none left
		end
	end

	local luck = computeLuck(data)
	local delaySeconds = WeightedRandom.range(zone.biteTimeRange.min, zone.biteTimeRange.max) * biteMultiplier

	task.delay(delaySeconds, function()
		-- castId guard: if this cast was cancelled and a new one started, this
		-- stale thread must not fire a bite into the new cast.
		if state.phase ~= "WaitingBite" or state.castId ~= thisCast or not player.Parent then
			return
		end
		-- Roll the fish server-side at bite time; the client learns nothing
		-- about it until the reel resolves.
		state.pendingFishId = rollFish(zoneId, luck)
		state.pendingZoneId = zoneId
		state.phase = "Reeling"
		state.biteAt = os.clock()

		local rod = GameConfig.ROD_TIERS[data.rodTier]
		Remotes.getEvent("BiteAlert"):FireClient(player, {
			sweetSpotSize = rod and rod.sweetSpotSize or 0.18,
			timeLimit = GameConfig.REEL_TIME_LIMIT,
		})

		-- Auto-fail if the client never reports back.
		task.delay(GameConfig.REEL_TIME_LIMIT + 1, function()
			if state.phase == "Reeling" and state.castId == thisCast then
				state.phase = "Idle"
				state.pendingFishId = nil
				Remotes.getEvent("CatchResult"):FireClient(player, nil, true)
			end
		end)
	end)
end

local function onCancelCast(player: Player)
	local state = getState(player)
	if state.phase == "WaitingBite" then
		state.phase = "Idle"
		state.pendingFishId = nil
	end
end

local function onReelResult(player: Player, accuracy: unknown)
	local data = DataService.get(player)
	local state = getState(player)
	if not data or state.phase ~= "Reeling" then
		return
	end

	-- Timing window validation: too fast is an exploit, too slow already failed.
	local elapsed = os.clock() - state.biteAt
	if elapsed < GameConfig.REEL_MIN_TIME or elapsed > GameConfig.REEL_TIME_LIMIT then
		state.phase = "Idle"
		state.pendingFishId = nil
		Remotes.getEvent("CatchResult"):FireClient(player, nil, true)
		return
	end

	-- Sanitize the client-reported accuracy. It only shapes weight, never
	-- rarity — worst case a spoofed 1.0 yields a slightly heavier fish.
	local clampedAccuracy = 0
	if typeof(accuracy) == "number" and accuracy == accuracy then
		clampedAccuracy = math.clamp(accuracy, 0, 1)
	end

	local fishId = state.pendingFishId
	local zoneId = state.pendingZoneId or "StarterBay"
	state.phase = "Idle"
	state.pendingFishId = nil
	state.pendingZoneId = nil

	local fishDef = fishId and FishConfig.getFish(fishId)
	-- Escape chance: missing the sweet spot entirely (accuracy 0) always loses
	-- the fish; partial accuracy gives a proportional chance to land it.
	if not fishId or not fishDef or clampedAccuracy <= 0 or math.random() > (0.25 + clampedAccuracy * 0.75) then
		Remotes.getEvent("CatchResult"):FireClient(player, nil, true)
		return
	end

	local weight = WeightedRandom.biasedRange(
		fishDef.minWeight,
		fishDef.maxWeight,
		clampedAccuracy * GameConfig.ACCURACY_WEIGHT_BONUS
	)
	weight = math.floor(weight * 100) / 100

	local catch = {
		fishId = fishId,
		weight = weight,
		caughtAt = os.time(),
		zoneId = zoneId,
	}
	table.insert(data.fishInventory, catch)

	-- Dex tracking
	local entry = data.fishDex[fishId]
	if entry then
		entry.caught += 1
		entry.bestWeight = math.max(entry.bestWeight, weight)
	else
		data.fishDex[fishId] = { caught = 1, bestWeight = weight, firstCaughtAt = os.time() }
		Remotes.getEvent("Notify"):FireClient(player, `New species discovered: {fishDef.displayName}!`, "success")
	end
	data.stats.totalCatches += 1

	BattlePassService.grantXP(player, GameConfig.XP_PER_CATCH[fishDef.rarity] or 5)
	DataService.replicate(player, { "fishInventory", "fishDex", "stats" })
	Remotes.getEvent("CatchResult"):FireClient(player, catch, false)
end

--------------------------------------------------------------------------------

function FishingService.init()
	Remotes.getEvent("CastRequest").OnServerEvent:Connect(onCastRequest)
	Remotes.getEvent("CancelCast").OnServerEvent:Connect(onCancelCast)
	Remotes.getEvent("ReelResult").OnServerEvent:Connect(onReelResult)
	Players.PlayerRemoving:Connect(function(player)
		states[player] = nil
	end)
end

return FishingService
