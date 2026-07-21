--!strict
-- Single source of truth for every remote. The server calls Remotes.init()
-- once at startup to create the instances; the client waits for them.
-- Never create remotes anywhere else — auditing the client/server surface
-- should only require reading this file.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")

local FOLDER_NAME = "Remotes"

local EVENTS = {
	-- Fishing (client -> server intents, server -> client state)
	"CastRequest", -- C->S ()
	"CancelCast", -- C->S ()
	"BiteAlert", -- S->C (reelParams: {sweetSpotSize, timeLimit})
	"ReelResult", -- C->S (accuracy: number 0..1)
	"CatchResult", -- S->C (fish: CaughtFish?, escaped: boolean)

	-- Economy / progression pushes
	"DataChanged", -- S->C (partial PlayerData snapshot for HUD/UI)
	"Notify", -- S->C (message: string, kind: "info"|"success"|"error")

	-- Mini-games
	"MiniGameState", -- S->C broadcast (gameId, state table)
	"MiniGameAction", -- C->S (gameId, action, payload)

	-- Boat
	"BoatSpawned", -- S->C (boatModel reference via Workspace name)
}

local FUNCTIONS = {
	"GetData", -- C->S: full sanitized PlayerData snapshot
	"SellAllFish", -- C->S: -> {ok, earned?, message?}
	"UpgradeBoat", -- C->S: -> {ok, newTier?, message?}
	"UpgradeRod", -- C->S: -> {ok, newTier?, message?}
	"BuyBait", -- C->S (baitId, amount) -> {ok, message?}
	"EquipBait", -- C->S (baitId?) -> {ok}
	"BuyCosmetic", -- C->S (category, itemId) -> {ok, message?}
	"EquipCosmetic", -- C->S (category, itemId?) -> {ok}
	"ClaimBattlePassTier", -- C->S (tierIndex, premium: boolean) -> {ok, message?}
	"GetMarketPrices", -- C->S: -> {[rarity]: demandMultiplier}
}

local Remotes = {}

local function getFolder(): Folder
	if RunService:IsServer() then
		local folder = ReplicatedStorage:FindFirstChild(FOLDER_NAME) :: Folder?
		if not folder then
			local newFolder = Instance.new("Folder")
			newFolder.Name = FOLDER_NAME
			newFolder.Parent = ReplicatedStorage
			folder = newFolder
		end
		return folder :: Folder
	end
	return ReplicatedStorage:WaitForChild(FOLDER_NAME) :: Folder
end

-- Server-only: create all remotes up front so the client never races them.
function Remotes.init()
	assert(RunService:IsServer(), "Remotes.init must run on the server")
	local folder = getFolder()
	for _, name in EVENTS do
		if not folder:FindFirstChild(name) then
			local remote = Instance.new("RemoteEvent")
			remote.Name = name
			remote.Parent = folder
		end
	end
	for _, name in FUNCTIONS do
		if not folder:FindFirstChild(name) then
			local remote = Instance.new("RemoteFunction")
			remote.Name = name
			remote.Parent = folder
		end
	end
end

function Remotes.getEvent(name: string): RemoteEvent
	local folder = getFolder()
	if RunService:IsServer() then
		return folder:FindFirstChild(name) :: RemoteEvent
	end
	return folder:WaitForChild(name) :: RemoteEvent
end

function Remotes.getFunction(name: string): RemoteFunction
	local folder = getFolder()
	if RunService:IsServer() then
		return folder:FindFirstChild(name) :: RemoteFunction
	end
	return folder:WaitForChild(name) :: RemoteFunction
end

return Remotes
