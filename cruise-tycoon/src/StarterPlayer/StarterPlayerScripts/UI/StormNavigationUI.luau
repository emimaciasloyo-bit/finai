--!strict
-- Storm Navigation screen + in-run HUD. Modal starts the run; during the run
-- a compact strip shows the clock, gate count, and hazard hits.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local StormNavigationUI = {}

local GAME_ID = "StormNavigation"

local overlay: Frame
local content: ScrollingFrame
local uiController: any

local sessionStrip: Frame
local sessionLabel: TextLabel

local function sendAction(action: string)
	Remotes.getEvent("MiniGameAction"):FireServer(GAME_ID, action, nil)
end

local function rebuildModal()
	for _, child in content:GetChildren() do
		if child:IsA("Frame") or child:IsA("TextLabel") or child:IsA("TextButton") then
			child:Destroy()
		end
	end
	local config = MiniGameConfig.Games.StormNavigation.config
	local data = ClientData.get()
	local best = data and data.miniGameHighScores and data.miniGameHighScores[GAME_ID] or 0

	Theme.label({
		parent = content,
		text = `Steer a loaner skiff through {config.checkpointCount} gates IN ORDER before the clock runs out. Rocks cost {math.floor(
			config.hitPenalty * 100
		)}% of the payout each.`,
		size = UDim2.new(1, 0, 0, 64),
		layoutOrder = 1,
	})
	Theme.label({
		parent = content,
		text = `Clean run pays {config.basePayout} 🪙 • {config.courseSeconds}s limit • Best time bonus: {Format.comma(
			best
		)}`,
		size = UDim2.new(1, 0, 0, 24),
		textColor = Theme.Colors.TextDim,
		layoutOrder = 2,
	})
	Theme.button({
		parent = content,
		text = "🌊 START RUN",
		color = Theme.Colors.Success,
		layoutOrder = 3,
		onClick = function()
			sendAction("Start")
			uiController.close()
		end,
	})
end

local function onState(state: any)
	if state.phase == "Active" then
		sessionStrip.Visible = true
		sessionLabel.Text =
			`⏱ {Format.clock(state.timeLeft)}  •  🚩 {state.checkpoints}/{state.totalCheckpoints}  •  💥 {state.hits}`
	elseif state.phase == "Done" then
		sessionStrip.Visible = false
		if state.finished then
			uiController.toast(
				`Course complete in {state.timeTaken}s ({state.hits} hits) — +{state.payout} 🪙!`,
				"success"
			)
		else
			uiController.toast(`Run over — +{state.payout} 🪙 consolation.`, "info")
		end
	end
end

function StormNavigationUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "StormNavigationModal",
		title = "🌩 Storm Navigation",
		onClose = controller.close,
	})
	controller.registerModal(`MiniGame_{GAME_ID}`, {
		open = function()
			rebuildModal()
			overlay.Visible = true
		end,
		close = function()
			overlay.Visible = false
		end,
	})

	sessionStrip = Instance.new("Frame")
	sessionStrip.Name = "StormStrip"
	sessionStrip.AnchorPoint = Vector2.new(0.5, 0)
	sessionStrip.Position = UDim2.new(0.5, 0, 0, 52)
	sessionStrip.Size = UDim2.fromOffset(320, 40)
	sessionStrip.BackgroundColor3 = Theme.Colors.Panel
	sessionStrip.BackgroundTransparency = 0.15
	sessionStrip.Visible = false
	Theme.corner(sessionStrip)
	sessionStrip.Parent = controller.getGui()

	sessionLabel = Theme.label({
		parent = sessionStrip,
		text = "",
		size = UDim2.new(1, -76, 1, 0),
		position = UDim2.new(0, 8, 0, 0),
		bold = true,
	})
	Theme.button({
		parent = sessionStrip,
		text = "Quit",
		size = UDim2.fromOffset(64, 32),
		position = UDim2.new(1, -68, 0.5, -16),
		color = Theme.Colors.Danger,
		onClick = function()
			sendAction("Abort")
		end,
	})

	Remotes.getEvent("MiniGameState").OnClientEvent:Connect(function(gameId, state)
		if gameId == GAME_ID then
			onState(state)
		end
	end)
end

return StormNavigationUI
