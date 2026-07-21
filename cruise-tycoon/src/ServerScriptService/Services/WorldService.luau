--!strict
-- Builds the placeholder ("greybox") world so the game is playable before any
-- Studio art pass: water plane, spawn dock, dockmaster & market NPC stands with
-- ProximityPrompts, zone boundary markers, and mini-game station pads.
-- Everything created here is tagged with the "Greybox" attribute so it's easy
-- to find and delete once real assets exist.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local ZoneConfig = require(Shared.Config.ZoneConfig)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)

local BoatService = require(script.Parent.BoatService)
local MarketService = require(script.Parent.MarketService)

local WorldService = {}

local function greyboxPart(props: {
	name: string,
	size: Vector3,
	position: Vector3,
	color: Color3?,
	transparency: number?,
	canCollide: boolean?,
}): Part
	local part = Instance.new("Part")
	part.Name = props.name
	part.Size = props.size
	part.Position = props.position
	part.Anchored = true
	part.Color = props.color or Color3.fromRGB(128, 128, 128)
	part.Transparency = props.transparency or 0
	part.CanCollide = props.canCollide ~= false
	part:SetAttribute("Greybox", true)
	part.Parent = workspace
	return part
end

-- NPC stand: a colored pedestal + billboard label + ProximityPrompt that tells
-- the client which UI to open (the prompt fires client-side via PromptTriggered
-- handling in UIController — interaction stays physical, validation stays server-side).
local function npcStand(name: string, label: string, position: Vector3, color: Color3, promptAction: string)
	local stand = greyboxPart({
		name = name,
		size = Vector3.new(4, 6, 4),
		position = position,
		color = color,
	})

	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromOffset(200, 50)
	billboard.StudsOffset = Vector3.new(0, 5, 0)
	billboard.AlwaysOnTop = true
	local text = Instance.new("TextLabel")
	text.Size = UDim2.fromScale(1, 1)
	text.BackgroundTransparency = 1
	text.Text = label
	text.TextColor3 = Color3.new(1, 1, 1)
	text.TextStrokeTransparency = 0.4
	text.TextScaled = true
	text.Font = Enum.Font.GothamBold
	text.Parent = billboard
	billboard.Parent = stand

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = label
	prompt.ObjectText = "Dock"
	prompt.MaxActivationDistance = 16
	prompt.RequiresLineOfSight = false
	prompt:SetAttribute("UIAction", promptAction) -- read by the client UIController
	prompt.Parent = stand
end

function WorldService.init()
	-- Water: one huge thin plane at Y=0. Replace with Terrain water in Studio.
	greyboxPart({
		name = "GreyboxWater",
		size = Vector3.new(8192, 1, 8192),
		position = Vector3.new(1024, -0.5, 512),
		color = Color3.fromRGB(30, 90, 140),
		transparency = 0.4,
		canCollide = false,
	})

	-- Spawn island / main dock.
	greyboxPart({
		name = "SpawnDock",
		size = Vector3.new(120, 4, 80),
		position = Vector3.new(0, 3, -80),
		color = Color3.fromRGB(150, 120, 80),
	})
	local spawnLocation = Instance.new("SpawnLocation")
	spawnLocation.Size = Vector3.new(12, 1, 12)
	spawnLocation.Position = Vector3.new(0, 5.5, -80)
	spawnLocation.Anchored = true
	spawnLocation.Neutral = true
	spawnLocation:SetAttribute("Greybox", true)
	spawnLocation.Parent = workspace

	-- Physical interaction points (positions owned by the respective services).
	npcStand("Dockmaster", "Upgrade Boat", BoatService.DOCKMASTER_POSITION, Color3.fromRGB(200, 140, 60), "UpgradeShop")
	npcStand("MarketNPC", "Sell Fish & Shop", MarketService.DOCK_POSITION, Color3.fromRGB(80, 170, 90), "Market")

	-- Mini-game station pads.
	for gameId, entry in MiniGameConfig.Games do
		npcStand(
			`Station_{gameId}`,
			entry.displayName,
			entry.stationPosition,
			if entry.enabled then Color3.fromRGB(90, 120, 220) else Color3.fromRGB(90, 90, 100),
			`MiniGame:{gameId}`
		)
	end

	-- Zone corner markers: four tall pillars per zone so testers can see the
	-- gating boundaries. Delete after the terrain pass.
	for zoneId, bounds in ZoneConfig.Layout do
		local zone = ZoneConfig.getZone(zoneId)
		local half = bounds.size / 2
		for _, corner in { Vector3.new(1, 0, 1), Vector3.new(-1, 0, 1), Vector3.new(1, 0, -1), Vector3.new(-1, 0, -1) } do
			greyboxPart({
				name = `ZoneMarker_{zoneId}`,
				size = Vector3.new(4, 60, 4),
				position = bounds.center + Vector3.new(half.X * corner.X, 30, half.Z * corner.Z),
				color = if zone and zone.requiredBoatTier > 1
					then Color3.fromRGB(200, 80, 80)
					else Color3.fromRGB(80, 200, 120),
				transparency = 0.3,
				canCollide = false,
			})
		end
	end
end

return WorldService
