--!strict
-- Registry + router for mini-games.
--
-- CONTRACT — each module in ./MiniGames/<id>.luau returns a table with:
--   init(context) -> ()        called once at server start
--   handleAction(player, action: string, payload: any) -> ()
--                              all client input for that game, pre-routed
-- and receives a `context` with:
--   config          the entry from MiniGameConfig.Games[id].config
--   broadcast(state) fires MiniGameState(gameId, state) to all clients
--   sendTo(player, state)      same but to one client
--   awardDoubloons(player, n)  the ONLY payout path (goes through DataService)
--   chargeDoubloons(player, n) -> boolean  for entry fees / bets
--   grantWinXP(player)         battle pass XP for a win
--   reportScore(player, score) updates the persisted high score if beaten
--
-- Adding a game = new config entry + new module. Nothing else changes.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local MiniGameConfig = require(Shared.Config.MiniGameConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)
local BattlePassService = require(script.Parent.BattlePassService)

local MiniGameManager = {}

export type MiniGameContext = {
	config: any,
	broadcast: (state: any) -> (),
	sendTo: (player: Player, state: any) -> (),
	awardDoubloons: (player: Player, amount: number) -> (),
	chargeDoubloons: (player: Player, amount: number) -> boolean,
	grantWinXP: (player: Player) -> (),
	reportScore: (player: Player, score: number) -> (),
}

local games: { [string]: any } = {}

local function makeContext(gameId: string): MiniGameContext
	local entry = MiniGameConfig.Games[gameId]
	return {
		config = entry.config,
		broadcast = function(state)
			Remotes.getEvent("MiniGameState"):FireAllClients(gameId, state)
		end,
		sendTo = function(player, state)
			Remotes.getEvent("MiniGameState"):FireClient(player, gameId, state)
		end,
		awardDoubloons = function(player, amount)
			if amount > 0 then
				DataService.adjustDoubloons(player, math.floor(amount))
			end
		end,
		chargeDoubloons = function(player, amount)
			return amount > 0 and DataService.adjustDoubloons(player, -math.floor(amount))
		end,
		grantWinXP = function(player)
			BattlePassService.grantXP(player, GameConfig.XP_PER_MINIGAME_WIN)
		end,
		reportScore = function(player, score)
			local data = DataService.get(player)
			if data and score > (data.miniGameHighScores[gameId] or 0) then
				data.miniGameHighScores[gameId] = score
				DataService.replicate(player, { "miniGameHighScores" })
			end
		end,
	}
end

function MiniGameManager.init()
	for gameId, entry in MiniGameConfig.Games do
		if not entry.enabled then
			continue
		end
		local moduleInstance = script.Parent.MiniGames:FindFirstChild(gameId)
		if not moduleInstance then
			warn(`[MiniGameManager] Enabled game '{gameId}' has no module — skipping`)
			continue
		end
		local ok, gameModule = pcall(require, moduleInstance)
		if not ok then
			warn(`[MiniGameManager] Failed to load '{gameId}': {gameModule}`)
			continue
		end
		games[gameId] = gameModule
		gameModule.init(makeContext(gameId))
	end

	Remotes.getEvent("MiniGameAction").OnServerEvent:Connect(function(player, gameId, action, payload)
		if typeof(gameId) ~= "string" or typeof(action) ~= "string" then
			return
		end
		local gameModule = games[gameId]
		if gameModule then
			gameModule.handleAction(player, action, payload)
		end
	end)
end

return MiniGameManager
