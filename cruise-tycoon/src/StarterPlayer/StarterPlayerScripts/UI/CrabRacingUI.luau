--!strict
-- Crab Racing screen: live race state (betting countdown, odds, progress
-- bars), bet placement, and payout results. Driven entirely by MiniGameState
-- broadcasts from the server module.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)

local Theme = require(script.Parent.Theme)

local CrabRacingUI = {}

local GAME_ID = "CrabRacing"

local overlay: Frame
local content: ScrollingFrame
local uiController: any
local isOpen = false

local phaseLabel: TextLabel
local crabRows: { { frame: Frame, nameLabel: TextLabel, progressFill: Frame, betButton: TextButton } } = {}
local resultLabel: TextLabel
local betAmount = 50 -- default stake; adjusted with +/- buttons
local betAmountLabel: TextLabel

local function placeBet(crabIndex: number)
	Remotes.getEvent("MiniGameAction"):FireServer(GAME_ID, "Bet", {
		crabIndex = crabIndex,
		amount = betAmount,
	})
end

local function buildLayout()
	local config = MiniGameConfig.Games.CrabRacing.config

	phaseLabel = Theme.label({
		parent = content,
		text = "Waiting for the next race...",
		size = UDim2.new(1, 0, 0, 28),
		bold = true,
		textColor = Theme.Colors.Gold,
		layoutOrder = 0,
	})

	-- Stake selector
	local stakeRow = Theme.rowCard(content, 52, 1)
	Theme.button({
		parent = stakeRow,
		text = "-",
		size = UDim2.fromOffset(44, 36),
		color = Theme.Colors.PanelLight,
		onClick = function()
			betAmount = math.max(config.minBet, betAmount - 50)
			betAmountLabel.Text = `Stake: {betAmount} 🪙`
		end,
	})
	betAmountLabel = Theme.label({
		parent = stakeRow,
		text = `Stake: {betAmount} 🪙`,
		size = UDim2.new(1, -110, 1, 0),
		position = UDim2.new(0, 52, 0, 0),
		bold = true,
		alignX = Enum.TextXAlignment.Center,
	})
	local plusButton = Theme.button({
		parent = stakeRow,
		text = "+",
		size = UDim2.fromOffset(44, 36),
		color = Theme.Colors.PanelLight,
		onClick = function()
			betAmount = math.min(config.maxBet, betAmount + 50)
			betAmountLabel.Text = `Stake: {betAmount} 🪙`
		end,
	})
	plusButton.AnchorPoint = Vector2.new(1, 0)
	plusButton.Position = UDim2.new(1, 0, 0, 0)

	-- Crab lanes
	for index = 1, config.crabCount do
		local row = Theme.rowCard(content, 72, 1 + index)
		local nameLabel = Theme.label({
			parent = row,
			text = `Crab {index}`,
			size = UDim2.new(1, 0, 0, 22),
			bold = true,
		})
		local track = Instance.new("Frame")
		track.Size = UDim2.new(1, 0, 0, 12)
		track.Position = UDim2.new(0, 0, 0, 26)
		track.BackgroundColor3 = Theme.Colors.Background
		Theme.corner(track, 6)
		track.Parent = row
		local fill = Instance.new("Frame")
		fill.Size = UDim2.fromScale(0, 1)
		fill.BackgroundColor3 = Theme.Colors.Accent
		Theme.corner(fill, 6)
		fill.Parent = track
		local betButton = Theme.button({
			parent = row,
			text = "BET",
			size = UDim2.new(0.4, 0, 0, 26),
			position = UDim2.new(0.6, 0, 1, -26),
			color = Theme.Colors.Success,
			onClick = function()
				placeBet(index)
			end,
		})
		crabRows[index] = { frame = row, nameLabel = nameLabel, progressFill = fill, betButton = betButton }
	end

	resultLabel = Theme.label({
		parent = content,
		text = "",
		size = UDim2.new(1, 0, 0, 26),
		bold = true,
		alignX = Enum.TextXAlignment.Center,
		layoutOrder = 99,
	})
end

local function onState(state: any)
	if not isOpen then
		return
	end
	if state.error then
		uiController.toast(state.error, "error")
		return
	end
	if state.betPlaced then
		uiController.toast(`Bet {state.betPlaced.amount} 🪙 on {state.betPlaced.crabName}!`, "success")
		return
	end
	if state.personal then
		if state.personal.won then
			resultLabel.Text = `🎉 {state.personal.crabName} won — you got {state.personal.amount} 🪙!`
			resultLabel.TextColor3 = Theme.Colors.Success
		else
			resultLabel.Text = `{state.personal.crabName} won. Better luck next race!`
			resultLabel.TextColor3 = Theme.Colors.Danger
		end
		return
	end

	if state.phase == "Betting" then
		phaseLabel.Text = `🏁 Place your bets! {state.secondsLeft}s`
		resultLabel.Text = ""
	elseif state.phase == "Racing" then
		phaseLabel.Text = "🦀 They're off!"
	elseif state.phase == "Payout" and state.winnerName then
		phaseLabel.Text = `Winner: {state.winnerName}!`
	end

	for index, crab in state.crabs or {} do
		local row = crabRows[index]
		if row then
			row.nameLabel.Text = `{crab.name}  ({crab.odds}x)`
			row.progressFill.Size = UDim2.fromScale(crab.progress or 0, 1)
			row.betButton.Visible = state.phase == "Betting"
		end
	end
end

function CrabRacingUI.init(controller: any)
	uiController = controller
	overlay, content = Theme.modal({
		parent = controller.getGui(),
		name = "CrabRacingModal",
		title = "🦀 Crab Racing",
		onClose = controller.close,
	})
	buildLayout()
	controller.registerModal(`MiniGame_{GAME_ID}`, {
		open = function()
			isOpen = true
			overlay.Visible = true
		end,
		close = function()
			isOpen = false
			overlay.Visible = false
		end,
	})
	Remotes.getEvent("MiniGameState").OnClientEvent:Connect(function(gameId, state)
		if gameId == GAME_ID then
			onState(state)
		end
	end)
end

return CrabRacingUI
