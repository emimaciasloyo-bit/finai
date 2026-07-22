--!strict
-- Builds the world at server start so the game is fully playable (and
-- swimmable) with zero uploaded assets:
--   * Real Terrain water across all zones (deep pit under the Deep Trench)
--   * Sand seafloors, a beach island behind the spawn dock
--   * Wooden spawn dock with pilings + SpawnLocation
--   * Dockmaster / market NPC characters (procedural) with ProximityPrompts
--   * Mini-game station platforms with NPCs
--   * Sunken wreck at the Treasure Diving site
--   * Lit buoys marking zone boundaries (green = tier-1 accessible, red = gated)
-- Everything is tagged with the "Greybox" attribute; replace piecemeal with
-- real art whenever — game logic only depends on prompt attributes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)

local ModelFactory = require(script.Parent.ModelFactory)

local WorldService = {}

local WORLD = GameConfig.WORLD

local function tag(instance: Instance): Instance
	instance:SetAttribute("Greybox", true)
	return instance
end

local function anchoredPart(props: {
	name: string,
	size: Vector3,
	cframe: CFrame,
	color: Color3?,
	material: Enum.Material?,
	transparency: number?,
	canCollide: boolean?,
}): Part
	local part = Instance.new("Part")
	part.Name = props.name
	part.Size = props.size
	part.CFrame = props.cframe
	part.Color = props.color or Color3.fromRGB(128, 128, 128)
	part.Material = props.material or Enum.Material.SmoothPlastic
	part.Transparency = props.transparency or 0
	part.CanCollide = props.canCollide ~= false
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	tag(part)
	part.Parent = workspace
	return part
end

--------------------------------------------------------------------------------
-- Terrain
--------------------------------------------------------------------------------

local function buildTerrain()
	local terrain = workspace.Terrain

	-- One contiguous water sheet over the whole play space (surface at Y=0)
	-- so boats never cross dry gaps between zone rectangles.
	terrain:FillBlock(CFrame.new(1400, -15, 500), Vector3.new(3800, 30, 2800), Enum.Material.Water)

	-- Deep pit under the Deep Trench zone.
	local trench = ZoneConfig.Layout.DeepTrench
	terrain:FillBlock(
		CFrame.new(trench.center.X, -110, trench.center.Z),
		Vector3.new(trench.size.X, 220, trench.size.Z),
		Enum.Material.Water
	)

	-- Seafloors (filled after water so they replace the bottom voxels).
	local floors: { [string]: Enum.Material } = {
		StarterBay = Enum.Material.Sand,
		OpenOcean = Enum.Material.Sandstone,
		StormZone = Enum.Material.Slate,
	}
	for zoneId, material in floors do
		local bounds = ZoneConfig.Layout[zoneId]
		terrain:FillBlock(
			CFrame.new(bounds.center.X, -32, bounds.center.Z),
			Vector3.new(bounds.size.X + 128, 12, bounds.size.Z + 128),
			material
		)
	end
	terrain:FillBlock(
		CFrame.new(trench.center.X, -226, trench.center.Z),
		Vector3.new(trench.size.X, 16, trench.size.Z),
		Enum.Material.Rock
	)

	-- Beach island behind the spawn dock (rises above the waterline).
	terrain:FillBlock(CFrame.new(0, -2, -190), Vector3.new(240, 26, 140), Enum.Material.Sand)
	terrain:FillBlock(CFrame.new(0, 6, -230), Vector3.new(140, 10, 60), Enum.Material.Grass)
end

--------------------------------------------------------------------------------
-- Docks & NPCs
--------------------------------------------------------------------------------

-- NPC with billboard + prompt. The prompt's UIAction attribute is the entire
-- client integration contract (UIController routes it to a modal).
local function npcCharacter(name: string, label: string, position: Vector3, outfitColor: Color3, promptAction: string)
	local npc = ModelFactory.buildNPC(name, outfitColor, position - Vector3.new(0, 5, 0), math.pi)
	tag(npc)
	npc.Parent = workspace
	local torso = npc.PrimaryPart :: BasePart

	local billboard = Instance.new("BillboardGui")
	billboard.Size = UDim2.fromOffset(200, 50)
	billboard.StudsOffset = Vector3.new(0, 4, 0)
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
	billboard.Parent = torso

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = label
	prompt.ObjectText = name
	prompt.MaxActivationDistance = 16
	prompt.RequiresLineOfSight = false
	prompt:SetAttribute("UIAction", promptAction)
	prompt.Parent = torso
end

local function woodPlatform(name: string, center: Vector3, size: Vector3)
	anchoredPart({
		name = name,
		size = size,
		cframe = CFrame.new(center),
		color = Color3.fromRGB(150, 115, 75),
		material = Enum.Material.WoodPlanks,
	})
	-- Pilings down into the water at the corners.
	local half = size / 2
	for _, corner in { Vector2.new(1, 1), Vector2.new(-1, 1), Vector2.new(1, -1), Vector2.new(-1, -1) } do
		anchoredPart({
			name = name .. "Piling",
			size = Vector3.new(1.2, center.Y + 30, 1.2),
			cframe = CFrame.new(
				center.X + (half.X - 1.5) * corner.X,
				(center.Y - 30) / 2 + 12,
				center.Z + (half.Z - 1.5) * corner.Y
			),
			color = Color3.fromRGB(100, 75, 50),
			material = Enum.Material.Wood,
		})
	end
end

local function buildSpawnDock()
	woodPlatform("SpawnDock", Vector3.new(0, 3, -80), Vector3.new(120, 2, 80))

	local spawnLocation = Instance.new("SpawnLocation")
	spawnLocation.Size = Vector3.new(12, 1, 12)
	spawnLocation.Position = Vector3.new(0, 4.5, -100)
	spawnLocation.Anchored = true
	spawnLocation.Neutral = true
	spawnLocation.Color = Color3.fromRGB(170, 140, 95)
	spawnLocation.Material = Enum.Material.WoodPlanks
	tag(spawnLocation)
	spawnLocation.Parent = workspace

	npcCharacter("Dockmaster", "Upgrade Boat", WORLD.DOCKMASTER_POSITION, Color3.fromRGB(200, 140, 60), "UpgradeShop")
	npcCharacter("Fishmonger", "Sell Fish & Shop", WORLD.MARKET_POSITION, Color3.fromRGB(80, 170, 90), "Market")
end

local function buildStations()
	for gameId, entry in MiniGameConfig.Games do
		local center = entry.stationPosition
		woodPlatform(`Station_{gameId}`, Vector3.new(center.X, 2.5, center.Z), Vector3.new(20, 2, 20))
		npcCharacter(
			`Host_{gameId}`,
			entry.displayName,
			Vector3.new(center.X, 5, center.Z),
			if entry.enabled then Color3.fromRGB(90, 120, 220) else Color3.fromRGB(90, 90, 100),
			`MiniGame:{gameId}`
		)
	end
end

--------------------------------------------------------------------------------
-- Wreck (Treasure Diving site) & buoys
--------------------------------------------------------------------------------

local function buildWreck()
	local site = WORLD.DIVE_SITE
	local woodColor = Color3.fromRGB(70, 55, 40)
	-- A broken hull: two tilted halves + a snapped mast, resting on the bay floor.
	anchoredPart({
		name = "WreckHullFore",
		size = Vector3.new(8, 5, 14),
		cframe = CFrame.new(site + Vector3.new(-4, 1, -6)) * CFrame.Angles(math.rad(12), math.rad(20), math.rad(-8)),
		color = woodColor,
		material = Enum.Material.WoodPlanks,
	})
	anchoredPart({
		name = "WreckHullAft",
		size = Vector3.new(8, 5, 10),
		cframe = CFrame.new(site + Vector3.new(6, 0.5, 8)) * CFrame.Angles(math.rad(-8), math.rad(-30), math.rad(14)),
		color = woodColor,
		material = Enum.Material.WoodPlanks,
	})
	anchoredPart({
		name = "WreckMast",
		size = Vector3.new(1, 18, 1),
		cframe = CFrame.new(site + Vector3.new(0, 2, 2)) * CFrame.Angles(0, 0, math.rad(75)),
		color = Color3.fromRGB(60, 48, 36),
		material = Enum.Material.Wood,
	})
end

local function buildBuoys()
	for zoneId, bounds in ZoneConfig.Layout do
		local zone = ZoneConfig.getZone(zoneId)
		local color = if zone and zone.requiredBoatTier > 1
			then Color3.fromRGB(230, 80, 70)
			else Color3.fromRGB(70, 210, 110)
		local half = bounds.size / 2
		-- Corners + edge midpoints so boundaries read at sea level.
		local offsets = {
			Vector2.new(1, 1),
			Vector2.new(-1, 1),
			Vector2.new(1, -1),
			Vector2.new(-1, -1),
			Vector2.new(1, 0),
			Vector2.new(-1, 0),
			Vector2.new(0, 1),
			Vector2.new(0, -1),
		}
		for _, offset in offsets do
			local buoy = ModelFactory.buildBuoy(
				color,
				Vector3.new(bounds.center.X + half.X * offset.X, 0, bounds.center.Z + half.Z * offset.Y)
			)
			tag(buoy)
			buoy.Parent = workspace
		end
	end
end

--------------------------------------------------------------------------------

function WorldService.init()
	buildTerrain()
	buildSpawnDock()
	buildStations()
	buildWreck()
	buildBuoys()
end

return WorldService
