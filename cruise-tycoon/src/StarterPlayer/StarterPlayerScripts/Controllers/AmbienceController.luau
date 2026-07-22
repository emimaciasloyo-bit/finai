--!strict
-- Per-zone atmosphere, all procedural (no audio/image assets):
--   * Lighting fog/ambient tweens per zone
--   * Rain particles + lightning flashes in the Storm Zone
--   * Heavy dark fog in the Deep Trench
-- Swap in real skyboxes/audio during an art pass; this keeps zones readable.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Shared = ReplicatedStorage:WaitForChild("Shared")
local ZoneConfig = require(Shared.Config.ZoneConfig)

local AmbienceController = {}

local player = Players.LocalPlayer

type Preset = {
	fogColor: Color3,
	fogEnd: number,
	outdoorAmbient: Color3,
	brightness: number,
}

local PRESETS: { [string]: Preset } = {
	Default = {
		fogColor = Color3.fromRGB(190, 210, 230),
		fogEnd = 5000,
		outdoorAmbient = Color3.fromRGB(128, 128, 128),
		brightness = 2,
	},
	StarterBay = {
		fogColor = Color3.fromRGB(200, 220, 235),
		fogEnd = 4000,
		outdoorAmbient = Color3.fromRGB(140, 140, 135),
		brightness = 2.2,
	},
	OpenOcean = {
		fogColor = Color3.fromRGB(180, 200, 220),
		fogEnd = 2500,
		outdoorAmbient = Color3.fromRGB(120, 125, 135),
		brightness = 2,
	},
	StormZone = {
		fogColor = Color3.fromRGB(90, 95, 105),
		fogEnd = 500,
		outdoorAmbient = Color3.fromRGB(60, 62, 70),
		brightness = 0.8,
	},
	DeepTrench = {
		fogColor = Color3.fromRGB(15, 25, 45),
		fogEnd = 300,
		outdoorAmbient = Color3.fromRGB(40, 50, 75),
		brightness = 0.6,
	},
}

local currentPreset = "Default"
local rainEmitter: ParticleEmitter
local rainAnchor: Part

local function applyPreset(name: string)
	if name == currentPreset then
		return
	end
	currentPreset = name
	local preset = PRESETS[name] or PRESETS.Default
	TweenService:Create(Lighting, TweenInfo.new(2), {
		FogColor = preset.fogColor,
		FogEnd = preset.fogEnd,
		OutdoorAmbient = preset.outdoorAmbient,
		Brightness = preset.brightness,
	}):Play()
	rainEmitter.Enabled = name == "StormZone"
end

-- Occasional lightning while in the Storm Zone: quick exposure spike.
local function lightningLoop()
	while true do
		task.wait(4 + math.random() * 8)
		if currentPreset == "StormZone" then
			local original = Lighting.ExposureCompensation
			Lighting.ExposureCompensation = original + 1.5
			task.wait(0.08)
			Lighting.ExposureCompensation = original + 0.6
			task.wait(0.05)
			Lighting.ExposureCompensation = original
		end
	end
end

function AmbienceController.init()
	-- Invisible anchor above the camera carries the rain emitter.
	rainAnchor = Instance.new("Part")
	rainAnchor.Name = "RainAnchor"
	rainAnchor.Size = Vector3.new(90, 1, 90)
	rainAnchor.Transparency = 1
	rainAnchor.Anchored = true
	rainAnchor.CanCollide = false
	rainAnchor.CanQuery = false
	rainAnchor.Parent = workspace

	rainEmitter = Instance.new("ParticleEmitter")
	rainEmitter.Name = "Rain"
	rainEmitter.Enabled = false
	rainEmitter.Rate = 900
	rainEmitter.Lifetime = NumberRange.new(0.8, 1.1)
	rainEmitter.Speed = NumberRange.new(60, 70)
	rainEmitter.EmissionDirection = Enum.NormalId.Bottom
	rainEmitter.Size = NumberSequence.new(0.12)
	rainEmitter.Transparency = NumberSequence.new(0.35)
	rainEmitter.Color = ColorSequence.new(Color3.fromRGB(190, 210, 235))
	rainEmitter.Parent = rainAnchor

	-- Follow the camera; check the zone once a second.
	RunService.Heartbeat:Connect(function()
		local camera = workspace.CurrentCamera
		if camera then
			rainAnchor.CFrame = CFrame.new(camera.CFrame.Position + Vector3.new(0, 45, 0))
		end
	end)
	task.spawn(function()
		while true do
			task.wait(1)
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if root then
				local zoneId = ZoneConfig.zoneAtPosition(root.Position)
				applyPreset(zoneId or "Default")
			end
		end
	end)
	task.spawn(lightningLoop)
end

return AmbienceController
