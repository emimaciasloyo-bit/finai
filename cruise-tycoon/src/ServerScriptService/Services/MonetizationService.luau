--!strict
-- Robux entry points: Pearl developer products and the premium battle pass
-- game pass. Receipts are made idempotent by recording PurchaseId in the
-- profile before granting — a re-delivered receipt is acknowledged, not
-- re-granted (classic dupe protection).

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)

local MonetizationService = {}

local function pearlsForProduct(productId: number): number?
	for _, product in MonetizationConfig.PearlProducts do
		if product.productId == productId and product.productId ~= 0 then
			return product.pearls
		end
	end
	return nil
end

local function processReceipt(receiptInfo: any): Enum.ProductPurchaseDecision
	local player = Players:GetPlayerByUserId(receiptInfo.PlayerId)
	if not player then
		-- Player left; Roblox will re-deliver this receipt on next join.
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end
	local data = DataService.get(player)
	if not data then
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	-- Idempotency: already granted? Just acknowledge.
	if data.redeemedReceipts[receiptInfo.PurchaseId] then
		return Enum.ProductPurchaseDecision.PurchaseGranted
	end

	local pearls = pearlsForProduct(receiptInfo.ProductId)
	if not pearls then
		warn(`[Monetization] Receipt for unknown product {receiptInfo.ProductId}`)
		return Enum.ProductPurchaseDecision.NotProcessedYet
	end

	-- Record BEFORE granting so a crash between the two never double-grants
	-- (worst case the player is owed pearls we can reconcile from receipts).
	data.redeemedReceipts[receiptInfo.PurchaseId] = true
	DataService.adjustPearls(player, pearls)
	Remotes.getEvent("Notify"):FireClient(player, `+{pearls} Pearls — thank you!`, "success")
	return Enum.ProductPurchaseDecision.PurchaseGranted
end

-- Premium battle pass ownership check, refreshed on join.
local function refreshGamePasses(player: Player)
	local passId = MonetizationConfig.PremiumBattlePassGamePassId
	if passId == 0 then
		return -- not configured yet
	end
	local ok, owns = pcall(function()
		return MarketplaceService:UserOwnsGamePassAsync(player.UserId, passId)
	end)
	if ok and owns then
		local data = DataService.get(player)
		if data and not data.battlePass.ownsPremium then
			data.battlePass.ownsPremium = true
			DataService.replicate(player, { "battlePass" })
		end
	end
end

function MonetizationService.init()
	MarketplaceService.ProcessReceipt = processReceipt

	Players.PlayerAdded:Connect(function(player)
		task.spawn(function()
			-- Wait for the profile, then sync game pass ownership.
			local deadline = os.clock() + 30
			while os.clock() < deadline and player.Parent do
				if DataService.get(player) then
					refreshGamePasses(player)
					return
				end
				task.wait(0.5)
			end
		end)
	end)

	MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, passId, purchased)
		if purchased and passId == MonetizationConfig.PremiumBattlePassGamePassId then
			refreshGamePasses(player)
		end
	end)
end

return MonetizationService
