--!strict
-- Market dock screen: sell the hold, live demand readout, bait shop, rod
-- upgrades, and the Pearl cosmetics rack. Opened by the market NPC prompt.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local GameConfig = require(Shared.Config.GameConfig)
local BaitConfig = require(Shared.Config.BaitConfig)
local FishConfig = require(Shared.Config.FishConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local MarketUI = {}

local overlay: Frame
local content: ScrollingFrame
local uiController: any

local function sectionHeader(text: string, order: number)
	Theme.label({
		parent = content,
		text = text,
		size = UDim2.new(1, 0, 0, 30),
		bold = true,
		textColor = Theme.Colors.Gold,
		layoutOrder = order,
	})
end

local function rebuild()
	for _, child in content:GetChildren() do
		if child:IsA("Frame") or child:IsA("TextLabel") or child:IsA("TextButton") then
			child:Destroy()
		end
	end
	local data = ClientData.get()
	if not data then
		return
	end

	-- ===== Sell =====
	sectionHeader(`Your Hold ({#data.fishInventory} fish)`, 1)
	Theme.button({
		parent = content,
		text = "SELL ALL FISH",
		color = Theme.Colors.Success,
		layoutOrder = 2,
		onClick = function()
			local result = Remotes.getFunction("SellAllFish"):InvokeServer()
			uiController.toast(result.message or "...", if result.ok then "success" else "error")
			rebuild()
		end,
	})

	-- Demand ticker
	local prices = Remotes.getFunction("GetMarketPrices"):InvokeServer() or {}
	local demandRow = Theme.rowCard(content, 40, 3)
	local demandText = ""
	for _, rarity in FishConfig.RARITY_ORDER do
		local multiplier = prices[rarity]
		if multiplier then
			demandText ..= `{rarity} x{multiplier}  `
		end
	end
	Theme.label({
		parent = demandRow,
		text = "Demand: " .. demandText,
		size = UDim2.fromScale(1, 1),
		textColor = Theme.Colors.TextDim,
	})

	-- ===== Rod upgrade =====
	sectionHeader("Fishing Rod", 10)
	local currentRod = GameConfig.ROD_TIERS[data.rodTier]
	local nextRod = GameConfig.ROD_TIERS[data.rodTier + 1]
	local rodRow = Theme.rowCard(content, 72, 11)
	Theme.label({
		parent = rodRow,
		text = `{currentRod.name}` .. (nextRod and `  →  {nextRod.name}` or "  (MAX)"),
		size = UDim2.new(1, 0, 0.5, 0),
		bold = true,
	})
	if nextRod then
		Theme.button({
			parent = rodRow,
			text = `Upgrade — {Format.comma(nextRod.cost)} 🪙`,
			size = UDim2.new(1, 0, 0.5, -4),
			position = UDim2.new(0, 0, 0.5, 4),
			onClick = function()
				local result = Remotes.getFunction("UpgradeRod"):InvokeServer()
				uiController.toast(result.message or "Rod upgraded!", if result.ok then "success" else "error")
				rebuild()
			end,
		})
	end

	-- ===== Bait shop =====
	sectionHeader("Bait", 20)
	local order = 21
	for _, bait in BaitConfig.Baits do
		local owned = data.baitInventory[bait.id] or 0
		local isEquipped = data.equippedBait == bait.id
		local row = Theme.rowCard(content, 84, order)
		order += 1
		Theme.label({
			parent = row,
			text = `{bait.displayName} (own {owned}){isEquipped and " ✓ equipped" or ""}`,
			size = UDim2.new(1, 0, 0, 24),
			bold = true,
		})
		Theme.label({
			parent = row,
			text = bait.description,
			size = UDim2.new(1, 0, 0, 18),
			position = UDim2.new(0, 0, 0, 24),
			textColor = Theme.Colors.TextDim,
		})
		Theme.button({
			parent = row,
			text = `Buy 10 — {Format.comma(bait.cost * 10)} 🪙`,
			size = UDim2.new(0.48, 0, 0, 32),
			position = UDim2.new(0, 0, 1, -32),
			onClick = function()
				local result = Remotes.getFunction("BuyBait"):InvokeServer(bait.id, 10)
				uiController.toast(result.message or "...", if result.ok then "success" else "error")
				rebuild()
			end,
		})
		Theme.button({
			parent = row,
			text = if isEquipped then "Unequip" else "Equip",
			size = UDim2.new(0.48, 0, 0, 32),
			position = UDim2.new(0.52, 0, 1, -32),
			color = Theme.Colors.PanelLight,
			onClick = function()
				Remotes.getFunction("EquipBait"):InvokeServer(if isEquipped then nil else bait.id)
				rebuild()
			end,
		})
	end

	-- ===== Cosmetics (Pearls) =====
	sectionHeader("Cosmetics (Pearls — cosmetic only!)", 40)
	order = 41
	local racks: { { category: string, catalog: any, label: string } } = {
		{ category = "boatSkin", catalog = MonetizationConfig.BoatSkins, label = "Boat Skin" },
		{ category = "rodSkin", catalog = MonetizationConfig.RodSkins, label = "Rod Skin" },
		{ category = "pet", catalog = MonetizationConfig.Pets, label = "Crew Pet" },
	}
	for _, rack in racks do
		for itemId, item in rack.catalog do
			local ownedKey = rack.category .. "s"
			local owned = data.cosmetics[ownedKey] and data.cosmetics[ownedKey][itemId]
			local equipped = data.cosmetics.equipped[rack.category] == itemId
			local cost = item.pearlCost or item.premiumCost or 0
			local row = Theme.rowCard(content, 64, order)
			order += 1
			Theme.label({
				parent = row,
				text = `[{rack.label}] {item.displayName}{equipped and " ✓" or ""}`,
				size = UDim2.new(0.6, 0, 1, 0),
				bold = true,
			})
			Theme.button({
				parent = row,
				text = if not owned then `{cost} ⚪` elseif equipped then "Unequip" else "Equip",
				size = UDim2.new(0.38, 0, 0, 36),
				position = UDim2.new(0.62, 0, 0.5, -18),
				color = if owned then Theme.Colors.PanelLight else Theme.Colors.Accent,
				onClick = function()
					local result
					if not owned then
						result = Remotes.getFunction("BuyCosmetic"):InvokeServer(rack.category, itemId)
						uiController.toast(result.message or "...", if result.ok then "success" else "error")
					else
						Remotes.getFunction("EquipCosmetic"):InvokeServer(rack.category, if equipped then nil else itemId)
					end
					rebuild()
				end,
			})
		end
	end
end

function MarketUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "MarketModal",
		title = "🐟 Harbor Market",
		onClose = controller.close,
	})
	controller.registerModal("Market", {
		open = function()
			rebuild()
			overlay.Visible = true
		end,
		close = function()
			overlay.Visible = false
		end,
	})
end

return MarketUI
