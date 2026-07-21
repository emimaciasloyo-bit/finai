--!strict
-- Dockmaster screen: the boat tier ladder. Shows every tier, highlights the
-- current one, and offers the next upgrade. Opened by the dockmaster prompt;
-- the server re-validates proximity + funds on purchase.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local BoatConfig = require(Shared.Config.BoatConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local UpgradeUI = {}

local overlay: Frame
local content: ScrollingFrame
local uiController: any

-- Zones unlocked at a given tier, for the tier card blurbs.
local function zonesUnlockedAt(tier: number): string
	local names = {}
	for _, zone in ZoneConfig.Zones do
		if zone.requiredBoatTier == tier then
			table.insert(names, zone.displayName)
		end
	end
	return #names > 0 and ("Unlocks: " .. table.concat(names, ", ")) or ""
end

local function rebuild()
	for _, child in content:GetChildren() do
		if child:IsA("Frame") then
			child:Destroy()
		end
	end
	local data = ClientData.get()
	if not data then
		return
	end

	for _, tierDef in BoatConfig.Tiers do
		local isCurrent = tierDef.tier == data.boatTier
		local isNext = tierDef.tier == data.boatTier + 1
		local isOwnedOrPast = tierDef.tier <= data.boatTier

		local row = Theme.rowCard(content, if isNext then 116 else 84, tierDef.tier)
		if isCurrent then
			row.BackgroundColor3 = Theme.Colors.PanelLight
		end

		Theme.label({
			parent = row,
			text = `T{tierDef.tier} — {tierDef.displayName}` .. (isCurrent and "  (current)" or ""),
			size = UDim2.new(1, 0, 0, 24),
			bold = true,
			textColor = if isOwnedOrPast then Theme.Colors.Success else Theme.Colors.Text,
		})
		Theme.label({
			parent = row,
			text = `Speed {tierDef.speed} • Hold {tierDef.storage} fish • {tierDef.rodSlots} rod slot(s)`,
			size = UDim2.new(1, 0, 0, 18),
			position = UDim2.new(0, 0, 0, 24),
			textColor = Theme.Colors.TextDim,
		})
		local unlocks = zonesUnlockedAt(tierDef.tier)
		Theme.label({
			parent = row,
			text = if unlocks ~= "" then unlocks else tierDef.description,
			size = UDim2.new(1, 0, 0, 18),
			position = UDim2.new(0, 0, 0, 42),
			textColor = if unlocks ~= "" then Theme.Colors.Gold else Theme.Colors.TextDim,
		})

		if isNext then
			Theme.button({
				parent = row,
				text = `UPGRADE — {Format.comma(tierDef.cost)} 🪙`,
				size = UDim2.new(1, 0, 0, 40),
				position = UDim2.new(0, 0, 1, -40),
				color = if data.doubloons >= tierDef.cost then Theme.Colors.Success else Theme.Colors.Danger,
				onClick = function()
					local result = Remotes.getFunction("UpgradeBoat"):InvokeServer()
					if not result.ok then
						uiController.toast(result.message or "Can't upgrade yet.", "error")
					end
					rebuild()
				end,
			})
		end
	end
end

function UpgradeUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "UpgradeModal",
		title = "⚓ Dockmaster — Boat Upgrades",
		onClose = controller.close,
	})
	controller.registerModal("UpgradeShop", {
		open = function()
			rebuild()
			overlay.Visible = true
		end,
		close = function()
			overlay.Visible = false
		end,
	})
end

return UpgradeUI
