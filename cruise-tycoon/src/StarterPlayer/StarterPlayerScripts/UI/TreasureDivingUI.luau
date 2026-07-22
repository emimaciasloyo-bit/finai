--!strict
-- Treasure Diving screen + in-dive HUD. The modal (opened at the station)
-- explains the game and starts the dive; during the dive the modal closes and
-- a compact air-timer strip shows at the top of the screen.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.Parent.Controllers.ClientData)
local Theme = require(script.Parent.Theme)

local TreasureDivingUI = {}

local GAME_ID = "TreasureDiving"

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
	local config = MiniGameConfig.Games.TreasureDiving.config
	local data = ClientData.get()
	local best = data and data.miniGameHighScores and data.miniGameHighScores[GAME_ID] or 0

	Theme.label({
		parent = content,
		text = `Dive the sunken wreck and grab as many glowing chests as you can in {config.divingSeconds}s.`,
		size = UDim2.new(1, 0, 0, 48),
		layoutOrder = 1,
	})
	Theme.label({
		parent = content,
		text = `{config.payoutPerTreasure} 🪙 per chest • {config.treasureCount} chests down there • Best haul: {best}`,
		size = UDim2.new(1, 0, 0, 24),
		textColor = Theme.Colors.TextDim,
		layoutOrder = 2,
	})
	Theme.button({
		parent = content,
		text = "🤿 START DIVE",
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
		sessionLabel.Text = `🫧 Air {Format.clock(state.timeLeft)}  •  💰 {state.collected}/{state.total}`
	elseif state.phase == "Done" then
		sessionStrip.Visible = false
		uiController.toast(
			`Dive over! {state.collected}/{state.total} chests — +{state.payout} 🪙`,
			if state.payout > 0 then "success" else "info"
		)
	end
end

function TreasureDivingUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "TreasureDivingModal",
		title = "🤿 Treasure Diving",
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

	-- In-dive HUD strip (top-center) with a Surface button.
	sessionStrip = Instance.new("Frame")
	sessionStrip.Name = "DiveStrip"
	sessionStrip.AnchorPoint = Vector2.new(0.5, 0)
	sessionStrip.Position = UDim2.new(0.5, 0, 0, 52)
	sessionStrip.Size = UDim2.fromOffset(300, 40)
	sessionStrip.BackgroundColor3 = Theme.Colors.Panel
	sessionStrip.BackgroundTransparency = 0.15
	sessionStrip.Visible = false
	Theme.corner(sessionStrip)
	sessionStrip.Parent = controller.getGui()

	sessionLabel = Theme.label({
		parent = sessionStrip,
		text = "",
		size = UDim2.new(1, -84, 1, 0),
		position = UDim2.new(0, 8, 0, 0),
		bold = true,
	})
	Theme.button({
		parent = sessionStrip,
		text = "Surface",
		size = UDim2.fromOffset(72, 32),
		position = UDim2.new(1, -76, 0.5, -16),
		color = Theme.Colors.Danger,
		onClick = function()
			sendAction("Surface")
		end,
	})

	Remotes.getEvent("MiniGameState").OnClientEvent:Connect(function(gameId, state)
		if gameId == GAME_ID then
			onState(state)
		end
	end)
end

return TreasureDivingUI
