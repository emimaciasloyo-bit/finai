--!strict
-- Seasonal battle pass: XP granting and tier claims.
-- XP only ever flows from server-side gameplay events (catches, mini-game
-- wins) — there is no remote to "add XP", only to claim earned tiers.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local BattlePassConfig = require(Shared.Config.BattlePassConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)

local BattlePassService = {}

function BattlePassService.grantXP(player: Player, amount: number)
	local data = DataService.get(player)
	if not data or amount <= 0 then
		return
	end
	data.battlePass.xp += math.floor(amount)
	DataService.replicate(player, { "battlePass" })
end

-- Grants a configured reward into the profile. Returns false if the reward is
-- malformed (config typo) so the claim can be refused instead of half-applied.
local function grantReward(player: Player, data: any, reward: any): boolean
	if reward.kind == "Doubloons" then
		return DataService.adjustDoubloons(player, reward.amount or 0)
	elseif reward.kind == "Pearls" then
		return DataService.adjustPearls(player, reward.amount or 0)
	elseif reward.kind == "Bait" then
		if not reward.itemId then
			return false
		end
		data.baitInventory[reward.itemId] = (data.baitInventory[reward.itemId] or 0) + (reward.amount or 1)
		DataService.replicate(player, { "baitInventory" })
		return true
	elseif reward.kind == "BoatSkin" and reward.itemId and MonetizationConfig.BoatSkins[reward.itemId] then
		data.cosmetics.boatSkins[reward.itemId] = true
		DataService.replicate(player, { "cosmetics" })
		return true
	elseif reward.kind == "RodSkin" and reward.itemId and MonetizationConfig.RodSkins[reward.itemId] then
		data.cosmetics.rodSkins[reward.itemId] = true
		DataService.replicate(player, { "cosmetics" })
		return true
	elseif reward.kind == "Pet" and reward.itemId and MonetizationConfig.Pets[reward.itemId] then
		data.cosmetics.pets[reward.itemId] = true
		DataService.replicate(player, { "cosmetics" })
		return true
	end
	return false
end

local function onClaimTier(player: Player, tierIndex: unknown, premium: unknown): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	if typeof(tierIndex) ~= "number" or tierIndex ~= math.floor(tierIndex) then
		return { ok = false, message = "Invalid tier" }
	end
	local tier = BattlePassConfig.Tiers[tierIndex]
	if not tier then
		return { ok = false, message = "Invalid tier" }
	end
	if data.battlePass.xp < tier.xpRequired then
		return { ok = false, message = "Not enough XP yet" }
	end

	local wantsPremium = premium == true
	local key = tostring(tierIndex)

	if wantsPremium then
		if not data.battlePass.ownsPremium then
			return { ok = false, message = "Premium pass required" }
		end
		if data.battlePass.claimedPremium[key] then
			return { ok = false, message = "Already claimed" }
		end
		local reward = tier.premiumReward
		if not reward then
			return { ok = false, message = "No premium reward at this tier" }
		end
		if not grantReward(player, data, reward) then
			return { ok = false, message = "Reward unavailable" }
		end
		data.battlePass.claimedPremium[key] = true
	else
		if data.battlePass.claimedFree[key] then
			return { ok = false, message = "Already claimed" }
		end
		local reward = tier.freeReward
		if not reward then
			return { ok = false, message = "No free reward at this tier" }
		end
		if not grantReward(player, data, reward) then
			return { ok = false, message = "Reward unavailable" }
		end
		data.battlePass.claimedFree[key] = true
	end

	DataService.replicate(player, { "battlePass" })
	return { ok = true }
end

function BattlePassService.init()
	Remotes.getFunction("ClaimBattlePassTier").OnServerInvoke = onClaimTier
end

return BattlePassService
