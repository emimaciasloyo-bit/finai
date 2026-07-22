--!strict
-- Crab Racing — fully implemented reference mini-game.
--
-- Loop: Betting (20s, players bet on a crab) -> Racing (~15s simulated with
-- hidden per-crab speeds, progress broadcast every tick) -> Payout -> repeat.
-- Odds are derived from the hidden speeds and shown during betting, so smart
-- players can bet value. All money movement is server-side via the manager
-- context; the client only ever sends {action = "Bet", crabIndex, amount}.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local MiniGameConfig = require(Shared.Config.MiniGameConfig)

local ModelFactory = require(script.Parent.Parent.ModelFactory)

local CrabRacing = {}

local CRAB_NAMES = { "Sir Pinchalot", "Clawdia", "Shellby", "Bubbles", "Snippy", "General Krust" }
local CRAB_COLORS = {
	Color3.fromRGB(220, 80, 60),
	Color3.fromRGB(80, 140, 220),
	Color3.fromRGB(110, 200, 90),
	Color3.fromRGB(230, 180, 60),
	Color3.fromRGB(180, 90, 210),
	Color3.fromRGB(240, 240, 245),
}

-- World-space track next to the station platform; crabs are physical models
-- pivoted along their lanes from race progress, so races are watchable live.
local TRACK_START_Z = 26 -- offsets from the station position
local TRACK_LENGTH = 36
local LANE_SPACING = 6

type Bet = { crabIndex: number, amount: number }

local context: any = nil
local config: any = nil

local phase: "Betting" | "Racing" | "Payout" = "Betting"
local phaseEndsAt = 0
local crabs: { { name: string, speed: number, progress: number, odds: number } } = {}
local bets: { [Player]: Bet } = {}
local crabModels: { Model } = {}
local trackOrigin: Vector3 = Vector3.zero

local function buildTrack()
	local station = MiniGameConfig.Games.CrabRacing.stationPosition
	trackOrigin = Vector3.new(station.X, 2.6, station.Z + TRACK_START_Z)

	local platform = Instance.new("Part")
	platform.Name = "CrabTrack"
	platform.Size = Vector3.new(config.crabCount * LANE_SPACING + 8, 1, TRACK_LENGTH + 12)
	platform.Position = Vector3.new(station.X, 2, station.Z + TRACK_START_Z + TRACK_LENGTH / 2)
	platform.Anchored = true
	platform.Color = Color3.fromRGB(200, 180, 140)
	platform.Material = Enum.Material.Sand
	platform.Parent = workspace

	for _, lineInfo in
		{ { z = 0, color = Color3.fromRGB(240, 240, 245) }, { z = TRACK_LENGTH, color = Color3.fromRGB(240, 195, 80) } }
	do
		local line = Instance.new("Part")
		line.Name = "TrackLine"
		line.Size = Vector3.new(platform.Size.X, 0.2, 1)
		line.Position = Vector3.new(station.X, 2.6, trackOrigin.Z + lineInfo.z)
		line.Anchored = true
		line.CanCollide = false
		line.Color = lineInfo.color
		line.Material = Enum.Material.Neon
		line.Parent = workspace
	end
end

local function laneX(index: number): number
	local station = MiniGameConfig.Games.CrabRacing.stationPosition
	return station.X + (index - (config.crabCount + 1) / 2) * LANE_SPACING
end

local function updateCrabModels()
	for index, crab in crabs do
		local model = crabModels[index]
		if model then
			model:PivotTo(CFrame.new(laneX(index), trackOrigin.Y + 0.8, trackOrigin.Z + crab.progress * TRACK_LENGTH))
		end
	end
end

local function respawnCrabModels()
	for _, model in crabModels do
		model:Destroy()
	end
	crabModels = {}
	for index = 1, #crabs do
		local model = ModelFactory.buildCrab(CRAB_COLORS[(index - 1) % #CRAB_COLORS + 1])
		model.Parent = workspace
		crabModels[index] = model
	end
	updateCrabModels()
end

local function broadcastState(extra: any?)
	local crabView = {}
	for index, crab in crabs do
		crabView[index] = {
			name = crab.name,
			progress = crab.progress,
			odds = crab.odds,
		}
	end
	local state = {
		phase = phase,
		secondsLeft = math.max(0, math.floor(phaseEndsAt - os.clock())),
		crabs = crabView,
	}
	if extra then
		for key, value in extra do
			state[key] = value
		end
	end
	context.broadcast(state)
end

local function setupRace()
	crabs = {}
	local usedNames = {}
	for _ = 1, config.crabCount do
		local name
		repeat
			name = CRAB_NAMES[math.random(1, #CRAB_NAMES)]
		until not usedNames[name]
		usedNames[name] = true
		table.insert(crabs, {
			name = name,
			-- Hidden speed. Race sim adds noise so the favorite doesn't always win.
			speed = 0.8 + math.random() * 0.4,
			progress = 0,
			odds = 0,
		})
	end
	-- Fair-ish decimal odds from inverse speed share, min 1.1x.
	local totalSpeed = 0
	for _, crab in crabs do
		totalSpeed += crab.speed
	end
	for _, crab in crabs do
		crab.odds = math.max(1.1, math.floor((totalSpeed / crab.speed) * 10) / 10)
	end
	respawnCrabModels()
end

local function runRace()
	phase = "Racing"
	phaseEndsAt = os.clock() + config.raceSeconds
	local winner: number? = nil
	while winner == nil do
		task.wait(0.25)
		for index, crab in crabs do
			-- Per-tick noise: speed dominates but any crab can surge.
			local step = (crab.speed * 0.6 + math.random() * 0.8) / (config.raceSeconds * 4)
			crab.progress = math.min(1, crab.progress + step)
			if crab.progress >= 1 then
				winner = winner or index -- first to finish this tick wins
			end
		end
		updateCrabModels()
		broadcastState()
	end
	return winner :: number
end

local function payout(winnerIndex: number)
	phase = "Payout"
	phaseEndsAt = os.clock() + 6
	local winnerCrab = crabs[winnerIndex]
	for player, bet in bets do
		if player.Parent ~= Players then
			continue
		end
		if bet.crabIndex == winnerIndex then
			local winnings = math.floor(bet.amount * winnerCrab.odds)
			context.awardDoubloons(player, winnings)
			context.grantWinXP(player)
			context.reportScore(player, winnings)
			context.sendTo(player, {
				phase = "Payout",
				personal = { won = true, amount = winnings, crabName = winnerCrab.name },
				crabs = {},
			})
		else
			context.sendTo(player, {
				phase = "Payout",
				personal = { won = false, amount = bet.amount, crabName = winnerCrab.name },
				crabs = {},
			})
		end
	end
	broadcastState({ winner = winnerIndex, winnerName = winnerCrab.name })
	bets = {}
	task.wait(6)
end

local function gameLoop()
	while true do
		setupRace()
		phase = "Betting"
		phaseEndsAt = os.clock() + config.bettingSeconds
		broadcastState()
		-- Re-broadcast the countdown each second so late joiners sync.
		for _ = 1, config.bettingSeconds do
			task.wait(1)
			broadcastState()
		end
		local winnerIndex = runRace()
		payout(winnerIndex)
	end
end

--------------------------------------------------------------------------------
-- MiniGameManager contract
--------------------------------------------------------------------------------

function CrabRacing.init(managerContext: any)
	context = managerContext
	config = managerContext.config
	buildTrack()
	Players.PlayerRemoving:Connect(function(player)
		bets[player] = nil -- forfeit: bet was already escrowed on placement
	end)
	task.spawn(gameLoop)
end

function CrabRacing.handleAction(player: Player, action: string, payload: any)
	if action ~= "Bet" then
		return
	end
	if phase ~= "Betting" then
		context.sendTo(player, { phase = phase, error = "Betting is closed." })
		return
	end
	if bets[player] then
		context.sendTo(player, { phase = phase, error = "You already placed a bet this race." })
		return
	end
	-- Strict payload validation — this is a money path.
	if typeof(payload) ~= "table" then
		return
	end
	local crabIndex = payload.crabIndex
	local amount = payload.amount
	if typeof(crabIndex) ~= "number" or crabs[crabIndex] == nil then
		return
	end
	if typeof(amount) ~= "number" or amount ~= math.floor(amount) then
		return
	end
	if amount < config.minBet or amount > config.maxBet then
		context.sendTo(player, { phase = phase, error = `Bets are {config.minBet}-{config.maxBet} Doubloons.` })
		return
	end
	-- Escrow the stake immediately; chargeDoubloons fails on insufficient funds.
	if not context.chargeDoubloons(player, amount) then
		context.sendTo(player, { phase = phase, error = "Not enough Doubloons." })
		return
	end
	bets[player] = { crabIndex = crabIndex, amount = amount }
	context.sendTo(player, {
		phase = phase,
		betPlaced = { crabIndex = crabIndex, amount = amount, crabName = crabs[crabIndex].name },
	})
end

return CrabRacing
