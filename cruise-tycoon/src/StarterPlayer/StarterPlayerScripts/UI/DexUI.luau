--!strict
-- Fish encyclopedia (Dex). Grouped by rarity, showing caught species with
-- stats and undiscovered ones as "???" silhouette rows.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local FishConfig = require(Shared.Config.FishConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local DexUI = {}

local overlay: Frame
local content: ScrollingFrame

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

	-- Completion header
	local totalSpecies = 0
	local caughtSpecies = 0
	for fishId in FishConfig.Fish do
		totalSpecies += 1
		if data.fishDex[fishId] then
			caughtSpecies += 1
		end
	end
	Theme.label({
		parent = content,
		text = `Discovered {caughtSpecies}/{totalSpecies} species`,
		size = UDim2.new(1, 0, 0, 28),
		bold = true,
		textColor = Theme.Colors.Gold,
		layoutOrder = 0,
	})

	local order = 1
	for rarityIndex, rarity in FishConfig.RARITY_ORDER do
		local rarityColor = FishConfig.RARITY_INFO[rarity].color
		Theme.label({
			parent = content,
			text = rarity,
			size = UDim2.new(1, 0, 0, 26),
			bold = true,
			textColor = rarityColor,
			layoutOrder = rarityIndex * 100,
		})
		order = rarityIndex * 100 + 1
		for fishId, def in FishConfig.Fish do
			if def.rarity ~= rarity then
				continue
			end
			local entry = data.fishDex[fishId]
			local row = Theme.rowCard(content, 64, order)
			order += 1
			if entry then
				Theme.label({
					parent = row,
					text = def.displayName,
					size = UDim2.new(1, 0, 0, 22),
					bold = true,
					textColor = rarityColor,
				})
				local zoneNames = {}
				for _, zoneId in def.zones do
					local zone = ZoneConfig.getZone(zoneId)
					table.insert(zoneNames, zone and zone.displayName or zoneId)
				end
				Theme.label({
					parent = row,
					text = `Caught {entry.caught} • Best {Format.weight(entry.bestWeight)} • {table.concat(zoneNames, ", ")}`,
					size = UDim2.new(1, 0, 0, 18),
					position = UDim2.new(0, 0, 0, 24),
					textColor = Theme.Colors.TextDim,
				})
			else
				Theme.label({
					parent = row,
					text = "???",
					size = UDim2.new(1, 0, 0, 22),
					bold = true,
					textColor = Theme.Colors.TextDim,
				})
				Theme.label({
					parent = row,
					text = "Not yet discovered",
					size = UDim2.new(1, 0, 0, 18),
					position = UDim2.new(0, 0, 0, 24),
					textColor = Theme.Colors.TextDim,
				})
			end
		end
	end
end

function DexUI.init(controller: any)
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "DexModal",
		title = "📖 Fish Encyclopedia",
		onClose = controller.close,
	})
	controller.registerModal("Dex", {
		open = function()
			rebuild()
			overlay.Visible = true
		end,
		close = function()
			overlay.Visible = false
		end,
	})
end

return DexUI
