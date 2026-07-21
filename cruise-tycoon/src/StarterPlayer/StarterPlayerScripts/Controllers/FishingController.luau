--!strict
-- Client fishing loop: cast button -> wait -> reel timing-bar minigame.
--
-- The reel minigame: a marker sweeps left-right across a bar; a "sweet spot"
-- band (width from the server's BiteAlert, i.e. rod tier) sits at a random
-- position. Tap/click to stop the marker; accuracy = how close to the band's
-- center you stopped (0 outside the band). Accuracy goes to the server, which
-- clamps it and only uses it for weight bias + escape chance — so this stays
-- a skill garnish, not a trust point.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local FishConfig = require(Shared.Config.FishConfig)
local Format = require(Shared.Util.Format)

local Theme = require(script.Parent.Parent.UI.Theme)

local FishingController = {}

type Phase = "Idle" | "Waiting" | "Reeling"
local phase: Phase = "Idle"

-- UI refs built once in init()
local screenGui: ScreenGui
local castButton: TextButton
local reelFrame: Frame
local marker: Frame
local sweetSpot: Frame
local statusLabel: TextLabel

local reelConnection: RBXScriptConnection? = nil

local function setStatus(text: string, seconds: number?)
	statusLabel.Text = text
	statusLabel.Visible = text ~= ""
	if seconds then
		task.delay(seconds, function()
			if statusLabel.Text == text then
				statusLabel.Visible = false
			end
		end)
	end
end

--------------------------------------------------------------------------------
-- Reel minigame
--------------------------------------------------------------------------------

local function stopReel(accuracy: number)
	if reelConnection then
		reelConnection:Disconnect()
		reelConnection = nil
	end
	reelFrame.Visible = false
	phase = "Idle"
	castButton.Text = "CAST"
	Remotes.getEvent("ReelResult"):FireServer(accuracy)
end

local function startReel(params: { sweetSpotSize: number, timeLimit: number })
	phase = "Reeling"
	reelFrame.Visible = true
	castButton.Text = "REEL!"

	-- Random band position; width from rod tier (server-provided).
	local bandWidth = math.clamp(params.sweetSpotSize, 0.05, 0.6)
	local bandCenter = bandWidth / 2 + math.random() * (1 - bandWidth)
	sweetSpot.Size = UDim2.fromScale(bandWidth, 1)
	sweetSpot.Position = UDim2.fromScale(bandCenter - bandWidth / 2, 0)

	local startedAt = os.clock()
	local sweepSpeed = 0.9 -- full-bar sweeps per second; ping-pongs
	reelConnection = RunService.RenderStepped:Connect(function()
		local elapsed = os.clock() - startedAt
		if elapsed > params.timeLimit then
			stopReel(0) -- ran out the clock: guaranteed escape
			return
		end
		-- Triangle wave 0..1..0
		local cycle = (elapsed * sweepSpeed) % 2
		local markerPosition = if cycle <= 1 then cycle else 2 - cycle
		marker.Position = UDim2.fromScale(markerPosition, 0)
		marker:SetAttribute("Pos", markerPosition)
	end)
end

local function onReelTap()
	local markerPosition = marker:GetAttribute("Pos") :: number? or 0
	local bandWidth = sweetSpot.Size.X.Scale
	local bandCenter = sweetSpot.Position.X.Scale + bandWidth / 2
	local distance = math.abs(markerPosition - bandCenter)
	-- 1.0 dead-center, tapering to 0 at the band edge; 0 outside.
	local accuracy = if distance <= bandWidth / 2 then 1 - (distance / (bandWidth / 2)) * 0.6 else 0
	stopReel(accuracy)
end

--------------------------------------------------------------------------------
-- Cast flow
--------------------------------------------------------------------------------

local function onCastTap()
	if phase == "Idle" then
		phase = "Waiting"
		castButton.Text = "WAITING..."
		setStatus("Line cast. Watch for a bite!", 2)
		Remotes.getEvent("CastRequest"):FireServer()
		-- The server may silently reject (cooldown/zone/full hold); Notify
		-- handles messaging, we just need to not get stuck visually.
		task.delay(15, function()
			if phase == "Waiting" then
				phase = "Idle"
				castButton.Text = "CAST"
			end
		end)
	elseif phase == "Waiting" then
		phase = "Idle"
		castButton.Text = "CAST"
		Remotes.getEvent("CancelCast"):FireServer()
	elseif phase == "Reeling" then
		onReelTap()
	end
end

--------------------------------------------------------------------------------

function FishingController.init(parentGui: ScreenGui)
	screenGui = parentGui

	-- Cast/reel mega-button: bottom-center, thumb-reachable on phones.
	castButton = Instance.new("TextButton")
	castButton.Name = "CastButton"
	castButton.AnchorPoint = Vector2.new(0.5, 1)
	castButton.Position = UDim2.new(0.5, 0, 1, -24)
	castButton.Size = UDim2.fromOffset(160, 64)
	castButton.BackgroundColor3 = Theme.Colors.Accent
	castButton.Text = "CAST"
	castButton.TextColor3 = Theme.Colors.Text
	castButton.Font = Theme.FontBold
	castButton.TextSize = 24
	Theme.corner(castButton, 16)
	castButton.Activated:Connect(onCastTap)
	castButton.Parent = screenGui

	-- Reel bar sits above the button.
	reelFrame = Instance.new("Frame")
	reelFrame.Name = "ReelBar"
	reelFrame.AnchorPoint = Vector2.new(0.5, 1)
	reelFrame.Position = UDim2.new(0.5, 0, 1, -104)
	reelFrame.Size = UDim2.new(0.8, 0, 0, 36)
	reelFrame.BackgroundColor3 = Theme.Colors.Panel
	reelFrame.Visible = false
	local maxWidth = Instance.new("UISizeConstraint")
	maxWidth.MaxSize = Vector2.new(480, 36)
	maxWidth.Parent = reelFrame
	Theme.corner(reelFrame)
	reelFrame.Parent = screenGui

	sweetSpot = Instance.new("Frame")
	sweetSpot.Name = "SweetSpot"
	sweetSpot.BackgroundColor3 = Theme.Colors.Success
	sweetSpot.BackgroundTransparency = 0.25
	sweetSpot.BorderSizePixel = 0
	Theme.corner(sweetSpot, 6)
	sweetSpot.Parent = reelFrame

	marker = Instance.new("Frame")
	marker.Name = "Marker"
	marker.Size = UDim2.new(0, 6, 1, 0)
	marker.BackgroundColor3 = Theme.Colors.Gold
	marker.BorderSizePixel = 0
	marker.ZIndex = 2
	marker.Parent = reelFrame

	statusLabel = Instance.new("TextLabel")
	statusLabel.Name = "FishingStatus"
	statusLabel.AnchorPoint = Vector2.new(0.5, 1)
	statusLabel.Position = UDim2.new(0.5, 0, 1, -152)
	statusLabel.Size = UDim2.new(0.8, 0, 0, 28)
	statusLabel.BackgroundTransparency = 1
	statusLabel.TextColor3 = Theme.Colors.Text
	statusLabel.TextStrokeTransparency = 0.4
	statusLabel.Font = Theme.FontBold
	statusLabel.TextScaled = true
	statusLabel.Visible = false
	statusLabel.Parent = screenGui

	-- Server events
	Remotes.getEvent("BiteAlert").OnClientEvent:Connect(function(params)
		if phase ~= "Waiting" then
			return
		end
		setStatus("BITE! Tap in the green zone!", 2)
		startReel(params)
	end)

	Remotes.getEvent("CatchResult").OnClientEvent:Connect(function(catch, escaped)
		if reelConnection then -- server auto-failed us (timeout)
			stopReel(0)
		end
		phase = "Idle"
		castButton.Text = "CAST"
		if escaped or not catch then
			setStatus("It got away...", 2)
			return
		end
		local def = FishConfig.getFish(catch.fishId)
		if def then
			local rarityColor = FishConfig.RARITY_INFO[def.rarity].color
			statusLabel.TextColor3 = rarityColor
			setStatus(`Caught a {def.rarity} {def.displayName} ({Format.weight(catch.weight)})!`, 3)
			task.delay(3, function()
				statusLabel.TextColor3 = Theme.Colors.Text
			end)
		end
	end)

	-- Desktop convenience: Space casts/reels too.
	UserInputService.InputBegan:Connect(function(input, gameProcessed)
		if gameProcessed then
			return
		end
		if input.KeyCode == Enum.KeyCode.Space and phase == "Reeling" then
			onReelTap()
		end
	end)
end

return FishingController
