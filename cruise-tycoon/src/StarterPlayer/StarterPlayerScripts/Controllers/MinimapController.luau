--!strict
-- Procedural minimap (no image assets): zone rectangles drawn to scale from
-- ZoneConfig.Layout, landmark dots from GameConfig.WORLD / MiniGameConfig,
-- and a live player arrow. Locked zones show red until the boat tier allows
-- them (updates live from ClientData).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)

local ClientData = require(script.Parent.ClientData)
local Theme = require(script.Parent.Parent.UI.Theme)

local MinimapController = {}

local player = Players.LocalPlayer

local MAP_SIZE = 150 -- px, square

-- World bounds = union of zone rectangles plus a margin.
local minX, maxX = math.huge, -math.huge
local minZ, maxZ = math.huge, -math.huge
for _, bounds in ZoneConfig.Layout do
	local half = bounds.size / 2
	minX = math.min(minX, bounds.center.X - half.X)
	maxX = math.max(maxX, bounds.center.X + half.X)
	minZ = math.min(minZ, bounds.center.Z - half.Z)
	maxZ = math.max(maxZ, bounds.center.Z + half.Z)
end
local MARGIN = 100
minX -= MARGIN
maxX += MARGIN
minZ -= MARGIN
maxZ += MARGIN

local function toMap(worldPosition: Vector3): UDim2
	local u = (worldPosition.X - minX) / (maxX - minX)
	local v = (worldPosition.Z - minZ) / (maxZ - minZ)
	return UDim2.fromScale(u, v)
end

local zoneFrames: { [string]: Frame } = {}
local playerBlip: Frame

local function refreshZoneColors()
	local data = ClientData.get()
	local tier = data and data.boatTier or 1
	for zoneId, frame in zoneFrames do
		local zone = ZoneConfig.getZone(zoneId)
		if zone then
			frame.BackgroundColor3 = if tier >= zone.requiredBoatTier
				then Color3.fromRGB(60, 130, 180)
				else Color3.fromRGB(150, 60, 60)
		end
	end
end

function MinimapController.init(parentGui: ScreenGui)
	local map = Instance.new("Frame")
	map.Name = "Minimap"
	map.AnchorPoint = Vector2.new(1, 0)
	map.Position = UDim2.new(1, -8, 0, 52)
	map.Size = UDim2.fromOffset(MAP_SIZE, MAP_SIZE)
	map.BackgroundColor3 = Color3.fromRGB(16, 36, 56) -- open sea
	map.BackgroundTransparency = 0.2
	map.ClipsDescendants = true
	Theme.corner(map, 10)
	map.Parent = parentGui

	-- Zone rectangles
	for zoneId, bounds in ZoneConfig.Layout do
		local frame = Instance.new("Frame")
		frame.Name = zoneId
		frame.AnchorPoint = Vector2.new(0.5, 0.5)
		frame.Position = toMap(bounds.center)
		frame.Size = UDim2.fromScale(bounds.size.X / (maxX - minX), bounds.size.Z / (maxZ - minZ))
		frame.BackgroundTransparency = 0.45
		frame.BorderSizePixel = 0
		Theme.corner(frame, 4)
		frame.Parent = map
		zoneFrames[zoneId] = frame

		local label = Instance.new("TextLabel")
		label.Size = UDim2.fromScale(1, 0.4)
		label.Position = UDim2.fromScale(0, 0.3)
		label.BackgroundTransparency = 1
		label.Text = ZoneConfig.getZone(zoneId).displayName
		label.TextColor3 = Color3.fromRGB(235, 240, 248)
		label.TextTransparency = 0.25
		label.TextScaled = true
		label.Font = Enum.Font.GothamBold
		label.Parent = frame
	end

	-- Landmark dots: home dock (gold) + mini-game stations (blue).
	local landmarks: { { position: Vector3, color: Color3 } } = {
		{ position = GameConfig.WORLD.MARKET_POSITION, color = Color3.fromRGB(240, 195, 80) },
	}
	for _, entry in MiniGameConfig.Games do
		table.insert(landmarks, { position = entry.stationPosition, color = Color3.fromRGB(120, 170, 255) })
	end
	for _, landmark in landmarks do
		local dot = Instance.new("Frame")
		dot.AnchorPoint = Vector2.new(0.5, 0.5)
		dot.Position = toMap(landmark.position)
		dot.Size = UDim2.fromOffset(5, 5)
		dot.BackgroundColor3 = landmark.color
		dot.ZIndex = 3
		Theme.corner(dot, 3)
		dot.Parent = map
	end

	-- Player arrow (a rotated square reads fine at this size).
	playerBlip = Instance.new("Frame")
	playerBlip.AnchorPoint = Vector2.new(0.5, 0.5)
	playerBlip.Size = UDim2.fromOffset(8, 8)
	playerBlip.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	playerBlip.ZIndex = 4
	Theme.corner(playerBlip, 2)
	playerBlip.Parent = map

	ClientData.Changed:Connect(refreshZoneColors)
	refreshZoneColors()

	-- 10 Hz is plenty for a minimap and cheap on mobile.
	local accumulator = 0
	RunService.Heartbeat:Connect(function(deltaTime)
		accumulator += deltaTime
		if accumulator < 0.1 then
			return
		end
		accumulator = 0
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if root then
			playerBlip.Position = toMap(root.Position)
			local _, yaw, _ = root.CFrame:ToEulerAnglesYXZ()
			playerBlip.Rotation = -math.deg(yaw) + 45
		end
	end)
end

return MinimapController
