--!strict
-- Battle pass screen: season header, XP progress, and the tier track with
-- claim buttons for free/premium rewards.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local BattlePassConfig = require(Shared.Config.BattlePassConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local BattlePassUI = {}

local overlay: Frame
local content: ScrollingFrame
local uiController: any

local function describeReward(reward: any): string
	if not reward then
		return "—"
	end
	if reward.kind == "Doubloons" then
		return `{Format.comma(reward.amount or 0)} 🪙`
	elseif reward.kind == "Pearls" then
		return `{reward.amount or 0} ⚪`
	elseif reward.kind == "Bait" then
		return `{reward.amount or 1}x {reward.itemId} bait`
	end
	return `{reward.kind}: {reward.itemId}`
end

local function claim(tierIndex: number, premium: boolean)
	local result = Remotes.getFunction("ClaimBattlePassTier"):InvokeServer(tierIndex, premium)
	uiController.toast(
		if result.ok then "Reward claimed!" else (result.message or "Can't claim"),
		if result.ok then "success" else "error"
	)
end

local function rebuild()
	for _, child in content:GetChildren() do
		if child:IsA("Frame") or child:IsA("TextLabel") then
			child:Destroy()
		end
	end
	local data = ClientData.get()
	if not data then
		return
	end
	local pass = data.battlePass

	Theme.label({
		parent = content,
		text = `Season {BattlePassConfig.SEASON.number}: {BattlePassConfig.SEASON.name}`,
		size = UDim2.new(1, 0, 0, 28),
		bold = true,
		textColor = Theme.Colors.Gold,
		layoutOrder = 0,
	})
	Theme.label({
		parent = content,
		text = `Your XP: {Format.comma(pass.xp)}` .. (pass.ownsPremium and "  •  PREMIUM ✓" or "  •  Free track"),
		size = UDim2.new(1, 0, 0, 22),
		layoutOrder = 1,
	})

	for tierIndex, tier in BattlePassConfig.Tiers do
		local unlocked = pass.xp >= tier.xpRequired
		local row = Theme.rowCard(content, 96, 10 + tierIndex)
		if not unlocked then
			row.BackgroundTransparency = 0.4
		end
		Theme.label({
			parent = row,
			text = `Tier {tierIndex} — {Format.comma(tier.xpRequired)} XP` .. (unlocked and "" or " 🔒"),
			size = UDim2.new(1, 0, 0, 22),
			bold = true,
			textColor = if unlocked then Theme.Colors.Success else Theme.Colors.TextDim,
		})

		-- Free reward line + claim
		local freeClaimed = pass.claimedFree[tostring(tierIndex)] == true
		Theme.label({
			parent = row,
			text = `Free: {describeReward(tier.freeReward)}{freeClaimed and " ✓" or ""}`,
			size = UDim2.new(0.62, 0, 0, 20),
			position = UDim2.new(0, 0, 0, 26),
			textColor = Theme.Colors.Text,
		})
		if tier.freeReward and unlocked and not freeClaimed then
			Theme.button({
				parent = row,
				text = "Claim",
				size = UDim2.new(0.34, 0, 0, 28),
				position = UDim2.new(0.64, 0, 0, 22),
				color = Theme.Colors.Success,
				onClick = function()
					claim(tierIndex, false)
					rebuild()
				end,
			})
		end

		-- Premium reward line + claim
		local premiumClaimed = pass.claimedPremium[tostring(tierIndex)] == true
		Theme.label({
			parent = row,
			text = `Premium: {describeReward(tier.premiumReward)}{premiumClaimed and " ✓" or ""}`,
			size = UDim2.new(0.62, 0, 0, 20),
			position = UDim2.new(0, 0, 0, 52),
			textColor = Theme.Colors.Pearl,
		})
		if tier.premiumReward and unlocked and pass.ownsPremium and not premiumClaimed then
			Theme.button({
				parent = row,
				text = "Claim",
				size = UDim2.new(0.34, 0, 0, 28),
				position = UDim2.new(0.64, 0, 0, 52),
				color = Theme.Colors.Accent,
				onClick = function()
					claim(tierIndex, true)
					rebuild()
				end,
			})
		end
	end
end

function BattlePassUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "BattlePassModal",
		title = "🏆 Voyage Pass",
		onClose = controller.close,
	})
	controller.registerModal("BattlePass", {
		open = function()
			rebuild()
			overlay.Visible = true
		end,
		close = function()
			overlay.Visible = false
		end,
	})
end

return BattlePassUI
