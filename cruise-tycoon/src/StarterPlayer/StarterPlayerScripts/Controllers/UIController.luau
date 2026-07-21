--!strict
-- Owns the ScreenGui, the HUD, toast notifications, modal window management,
-- and routing of physical ProximityPrompts (dockmaster/market/mini-game
-- stations) to their screens. One modal open at a time.

local Players = game:GetService("Players")
local ProximityPromptService = game:GetService("ProximityPromptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService = game:GetService("TweenService")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)
local BoatConfig = require(Shared.Config.BoatConfig)
local ZoneConfig = require(Shared.Config.ZoneConfig)
local Format = require(Shared.Util.Format)

local ClientData = require(script.Parent.ClientData)
local Theme = require(script.Parent.Parent.UI.Theme)

local UIController = {}

local player = Players.LocalPlayer

local screenGui: ScreenGui
local currencyLabel: TextLabel
local pearlLabel: TextLabel
local boatLabel: TextLabel
local zoneLabel: TextLabel
local cargoLabel: TextLabel
local toastContainer: Frame

-- name -> { open: () -> (), close: () -> () }
local modals: { [string]: { open: () -> (), close: () -> () } } = {}
local openModal: string? = nil

--------------------------------------------------------------------------------
-- Modal management
--------------------------------------------------------------------------------

function UIController.registerModal(name: string, handlers: { open: () -> (), close: () -> () })
	modals[name] = handlers
end

function UIController.open(name: string)
	if openModal == name then
		return
	end
	if openModal then
		modals[openModal].close()
	end
	local modal = modals[name]
	if modal then
		openModal = name
		modal.open()
	end
end

function UIController.close()
	if openModal then
		modals[openModal].close()
		openModal = nil
	end
end

function UIController.getGui(): ScreenGui
	return screenGui
end

--------------------------------------------------------------------------------
-- Toasts
--------------------------------------------------------------------------------

local KIND_COLORS = {
	info = Theme.Colors.Accent,
	success = Theme.Colors.Success,
	error = Theme.Colors.Danger,
}

function UIController.toast(message: string, kind: string?)
	local toast = Instance.new("TextLabel")
	toast.Size = UDim2.new(1, 0, 0, 36)
	toast.BackgroundColor3 = KIND_COLORS[kind or "info"] or Theme.Colors.Accent
	toast.BackgroundTransparency = 0.1
	toast.Text = message
	toast.TextColor3 = Theme.Colors.Text
	toast.Font = Theme.FontBold
	toast.TextScaled = true
	toast.TextWrapped = true
	local sizeConstraint = Instance.new("UITextSizeConstraint")
	sizeConstraint.MaxTextSize = 16
	sizeConstraint.Parent = toast
	Theme.corner(toast)
	Theme.padding(toast, 6)
	toast.Parent = toastContainer

	task.delay(3.5, function()
		local tween = TweenService:Create(toast, TweenInfo.new(0.4), { BackgroundTransparency = 1, TextTransparency = 1 })
		tween:Play()
		tween.Completed:Wait()
		toast:Destroy()
	end)
end

--------------------------------------------------------------------------------
-- HUD
--------------------------------------------------------------------------------

local function hudChip(parent: Instance, order: number): (Frame, TextLabel)
	local chip = Instance.new("Frame")
	chip.Size = UDim2.fromOffset(120, 36)
	chip.BackgroundColor3 = Theme.Colors.Panel
	chip.BackgroundTransparency = 0.15
	chip.LayoutOrder = order
	Theme.corner(chip, 18)
	chip.Parent = parent
	local text = Theme.label({
		parent = chip,
		text = "",
		size = UDim2.fromScale(1, 1),
		bold = true,
		alignX = Enum.TextXAlignment.Center,
	})
	return chip, text
end

local function refreshHud()
	local data = ClientData.get()
	if not data then
		return
	end
	currencyLabel.Text = `🪙 {Format.abbreviate(data.doubloons)}`
	pearlLabel.Text = `⚪ {Format.abbreviate(data.pearls)}`
	local tierDef = BoatConfig.getTier(data.boatTier)
	boatLabel.Text = tierDef and `⛵ {tierDef.displayName}` or "⛵ ?"
	if tierDef then
		cargoLabel.Text = `🐟 {#data.fishInventory}/{tierDef.storage}`
	end
end

local function buildHud()
	local topBar = Instance.new("Frame")
	topBar.Name = "TopBar"
	topBar.Position = UDim2.new(0, 8, 0, 8)
	topBar.Size = UDim2.new(1, -16, 0, 36)
	topBar.BackgroundTransparency = 1
	topBar.Parent = screenGui
	local layout = Theme.list(topBar, 8)
	layout.FillDirection = Enum.FillDirection.Horizontal

	local _, currencyText = hudChip(topBar, 1)
	currencyLabel = currencyText
	local _, pearlText = hudChip(topBar, 2)
	pearlLabel = pearlText
	local boatChip, boatText = hudChip(topBar, 3)
	boatChip.Size = UDim2.fromOffset(180, 36)
	boatLabel = boatText
	local _, cargoText = hudChip(topBar, 4)
	cargoLabel = cargoText

	-- Current zone indicator (simple minimap stand-in; a real minimap is a
	-- Studio/asset task — see README).
	zoneLabel = Theme.label({
		parent = screenGui,
		text = "",
		size = UDim2.new(0, 220, 0, 24),
		position = UDim2.new(0, 8, 0, 50),
		textColor = Theme.Colors.TextDim,
		bold = true,
	})
	task.spawn(function()
		while true do
			task.wait(1)
			local character = player.Character
			local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
			if root then
				local zoneId = ZoneConfig.zoneAtPosition(root.Position)
				local zone = zoneId and ZoneConfig.getZone(zoneId)
				zoneLabel.Text = zone and `📍 {zone.displayName}` or "📍 Uncharted Waters"
			end
		end
	end)

	-- Side menu buttons (Dex, Battle Pass) — right edge, stacked, thumb-sized.
	local sideMenu = Instance.new("Frame")
	sideMenu.AnchorPoint = Vector2.new(1, 0.5)
	sideMenu.Position = UDim2.new(1, -8, 0.5, 0)
	sideMenu.Size = UDim2.fromOffset(56, 200)
	sideMenu.BackgroundTransparency = 1
	sideMenu.Parent = screenGui
	Theme.list(sideMenu, 10)

	local sideButtons = {
		{ icon = "📖", modal = "Dex", order = 1 },
		{ icon = "🏆", modal = "BattlePass", order = 2 },
	}
	for _, entry in sideButtons do
		local button = Instance.new("TextButton")
		button.Size = UDim2.fromOffset(56, 56)
		button.BackgroundColor3 = Theme.Colors.Panel
		button.BackgroundTransparency = 0.15
		button.Text = entry.icon
		button.TextSize = 28
		button.LayoutOrder = entry.order
		Theme.corner(button, 28)
		button.Activated:Connect(function()
			UIController.open(entry.modal)
		end)
		button.Parent = sideMenu
	end

	toastContainer = Instance.new("Frame")
	toastContainer.Name = "Toasts"
	toastContainer.AnchorPoint = Vector2.new(0.5, 0)
	toastContainer.Position = UDim2.new(0.5, 0, 0, 92)
	toastContainer.Size = UDim2.new(0.9, 0, 0, 200)
	toastContainer.BackgroundTransparency = 1
	local maxWidth = Instance.new("UISizeConstraint")
	maxWidth.MaxSize = Vector2.new(420, 200)
	maxWidth.Parent = toastContainer
	Theme.list(toastContainer, 6)
	toastContainer.Parent = screenGui
end

--------------------------------------------------------------------------------

function UIController.init()
	screenGui = Instance.new("ScreenGui")
	screenGui.Name = "CruiseTycoonUI"
	screenGui.ResetOnSpawn = false
	screenGui.IgnoreGuiInset = false
	screenGui.Parent = player:WaitForChild("PlayerGui")

	buildHud()

	ClientData.Changed:Connect(refreshHud)
	refreshHud()

	Remotes.getEvent("Notify").OnClientEvent:Connect(function(message, kind)
		UIController.toast(tostring(message), kind)
	end)

	-- Physical interactions: prompts created by WorldService carry a UIAction
	-- attribute ("UpgradeShop" | "Market" | "MiniGame:<id>").
	ProximityPromptService.PromptTriggered:Connect(function(prompt, promptPlayer)
		if promptPlayer ~= player then
			return
		end
		local action = prompt:GetAttribute("UIAction")
		if typeof(action) ~= "string" then
			return
		end
		local miniGameId = string.match(action, "^MiniGame:(.+)$")
		if miniGameId then
			UIController.open(`MiniGame_{miniGameId}`)
		else
			UIController.open(action)
		end
	end)
end

return UIController
