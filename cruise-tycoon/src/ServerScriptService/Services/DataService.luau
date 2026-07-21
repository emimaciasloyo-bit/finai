--!strict
-- Player persistence with session locking and retry/backoff.
--
-- Design (ProfileService-style, self-contained):
--   * Every profile carries a lock {jobId, timestamp}. A server may only load
--     a profile if the lock is free, owned by itself, or stale (> LOCK_TIMEOUT).
--     This prevents the classic dupe: join server B while server A still holds
--     unsaved state, sell items twice, let the stale save overwrite.
--   * All writes go through UpdateAsync so we never blind-Set over newer data.
--   * Autosave loop + PlayerRemoving save + BindToClose flush.
--   * Schema migrations run on load keyed off schemaVersion.
--
-- Other services never touch DataStores; they call DataService.get(player) and
-- mutate through the helpers here so dirty-tracking and replication stay honest.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local BattlePassConfig = require(Shared.Config.BattlePassConfig)
local Remotes = require(Shared.Remotes)

local DataService = {}

local STORE_NAME = "PlayerData_v1"
local SCHEMA_VERSION = 1
local LOCK_TIMEOUT = 30 * 60 -- seconds before a foreign lock is considered stale
local AUTOSAVE_INTERVAL = 120
local MAX_RETRIES = 5

local store = DataStoreService:GetDataStore(STORE_NAME)

export type Profile = {
	data: any, -- Types.PlayerData; `any` here avoids a require cycle in strict mode
	loaded: boolean,
}

local profiles: { [Player]: Profile } = {}

--------------------------------------------------------------------------------
-- Defaults & migrations
--------------------------------------------------------------------------------

local function defaultData(): any
	return {
		schemaVersion = SCHEMA_VERSION,
		doubloons = GameConfig.STARTING_DOUBLOONS,
		pearls = GameConfig.STARTING_PEARLS,
		boatTier = 1,
		rodTier = 1,
		equippedBait = nil,
		baitInventory = {},
		fishInventory = {},
		fishDex = {},
		cosmetics = {
			boatSkins = {},
			rodSkins = {},
			pets = {},
			equipped = {},
		},
		miniGameHighScores = {},
		battlePass = {
			season = BattlePassConfig.SEASON.number,
			xp = 0,
			ownsPremium = false,
			claimedFree = {},
			claimedPremium = {},
		},
		stats = { totalCatches = 0, totalEarned = 0, joinCount = 0 },
		redeemedReceipts = {},
	}
end

-- Runs on every load. Add numbered steps as the schema evolves; never delete old ones.
local function migrate(data: any): any
	-- v0 -> v1 example slot (no-op today):
	-- if (data.schemaVersion or 0) < 1 then ... end
	data.schemaVersion = SCHEMA_VERSION

	-- Season rollover: wipe per-season battle pass progress, keep granted items.
	if data.battlePass.season ~= BattlePassConfig.SEASON.number then
		data.battlePass = {
			season = BattlePassConfig.SEASON.number,
			xp = 0,
			ownsPremium = false, -- premium is per-season by design
			claimedFree = {},
			claimedPremium = {},
		}
	end
	return data
end

--------------------------------------------------------------------------------
-- DataStore plumbing
--------------------------------------------------------------------------------

local function keyFor(userId: number): string
	return "player_" .. tostring(userId)
end

-- UpdateAsync with exponential backoff. Returns (ok, resultOrError).
local function safeUpdate(key: string, transform: (any) -> any?): (boolean, any)
	local delaySeconds = 1
	for attempt = 1, MAX_RETRIES do
		local ok, result = pcall(function()
			return store:UpdateAsync(key, transform)
		end)
		if ok then
			return true, result
		end
		warn(`[DataService] UpdateAsync failed for {key} (attempt {attempt}): {result}`)
		if attempt < MAX_RETRIES then
			task.wait(delaySeconds)
			delaySeconds = math.min(delaySeconds * 2, 16)
		end
	end
	return false, nil
end

local function acquireProfile(userId: number): (any?, string?)
	local jobId = game.JobId ~= "" and game.JobId or "studio"
	local loadedData: any = nil
	local blocked = false

	local ok = safeUpdate(keyFor(userId), function(stored)
		stored = stored or { data = defaultData(), lock = nil }
		local lock = stored.lock
		local lockIsOurs = lock and lock.jobId == jobId
		local lockIsStale = lock and (os.time() - (lock.timestamp or 0)) > LOCK_TIMEOUT
		if lock and not lockIsOurs and not lockIsStale then
			-- Another live server owns this profile. Abort the write.
			blocked = true
			return nil
		end
		stored.lock = { jobId = jobId, timestamp = os.time() }
		loadedData = stored.data
		return stored
	end)

	if not ok then
		return nil, "DataStore unavailable"
	end
	if blocked then
		return nil, "Profile is locked by another server"
	end
	return migrate(loadedData or defaultData()), nil
end

local function writeProfile(userId: number, data: any, releaseLock: boolean): boolean
	local jobId = game.JobId ~= "" and game.JobId or "studio"
	local ok = safeUpdate(keyFor(userId), function(stored)
		stored = stored or {}
		-- Only write if we still own (or nobody owns) the lock — a stale-lock
		-- takeover by another server must not be clobbered.
		local lock = stored.lock
		if lock and lock.jobId ~= jobId then
			return nil
		end
		stored.data = data
		stored.lock = if releaseLock then nil else { jobId = jobId, timestamp = os.time() }
		return stored
	end)
	return ok
end

--------------------------------------------------------------------------------
-- Public API
--------------------------------------------------------------------------------

-- Returns live PlayerData or nil if the profile hasn't loaded (callers must
-- treat nil as "reject the request", never fall back to defaults).
function DataService.get(player: Player): any?
	local profile = profiles[player]
	if profile and profile.loaded then
		return profile.data
	end
	return nil
end

-- Push a partial snapshot to the owning client. Services call this after any
-- mutation the HUD/UI cares about; keys mirror PlayerData fields.
function DataService.replicate(player: Player, keys: { string }?)
	local data = DataService.get(player)
	if not data then
		return
	end
	local snapshot: { [string]: any } = {}
	if keys then
		for _, key in keys do
			snapshot[key] = data[key]
		end
	else
		for key, value in data do
			snapshot[key] = value
		end
	end
	Remotes.getEvent("DataChanged"):FireClient(player, snapshot)
end

-- Currency helpers: the ONLY sanctioned way to change balances. Amount may be
-- negative; returns false (and changes nothing) if funds are insufficient.
function DataService.adjustDoubloons(player: Player, amount: number): boolean
	local data = DataService.get(player)
	if not data then
		return false
	end
	local newBalance = data.doubloons + amount
	if newBalance < 0 then
		return false
	end
	data.doubloons = math.floor(newBalance)
	if amount > 0 then
		data.stats.totalEarned += amount
	end
	DataService.replicate(player, { "doubloons", "stats" })
	return true
end

function DataService.adjustPearls(player: Player, amount: number): boolean
	local data = DataService.get(player)
	if not data then
		return false
	end
	local newBalance = data.pearls + amount
	if newBalance < 0 then
		return false
	end
	data.pearls = math.floor(newBalance)
	DataService.replicate(player, { "pearls" })
	return true
end

--------------------------------------------------------------------------------
-- Lifecycle
--------------------------------------------------------------------------------

local function onPlayerAdded(player: Player)
	local data, err = acquireProfile(player.UserId)
	if not data then
		warn(`[DataService] Failed to load {player.Name}: {err}`)
		player:Kick("Your data could not be loaded safely. Please rejoin in a minute.")
		return
	end
	if not player.Parent then
		-- Player left mid-load; release the lock we just took.
		writeProfile(player.UserId, data, true)
		return
	end
	data.stats.joinCount += 1
	profiles[player] = { data = data, loaded = true }
	DataService.replicate(player)
end

local function onPlayerRemoving(player: Player)
	local profile = profiles[player]
	profiles[player] = nil
	if profile and profile.loaded then
		task.spawn(function()
			if not writeProfile(player.UserId, profile.data, true) then
				warn(`[DataService] FINAL SAVE FAILED for {player.Name} ({player.UserId})`)
			end
		end)
	end
end

function DataService.init()
	Players.PlayerAdded:Connect(onPlayerAdded)
	for _, player in Players:GetPlayers() do
		task.spawn(onPlayerAdded, player)
	end
	Players.PlayerRemoving:Connect(onPlayerRemoving)

	-- Autosave (keeps the lock; refreshes its timestamp so it never goes stale mid-session)
	task.spawn(function()
		while true do
			task.wait(AUTOSAVE_INTERVAL)
			for player, profile in profiles do
				if profile.loaded then
					writeProfile(player.UserId, profile.data, false)
				end
			end
		end
	end)

	-- Flush everything on shutdown. Studio gets a short grace period.
	game:BindToClose(function()
		if RunService:IsStudio() then
			task.wait(2)
		end
		local pending = 0
		for player, profile in profiles do
			if profile.loaded then
				pending += 1
				task.spawn(function()
					writeProfile(player.UserId, profile.data, true)
					pending -= 1
				end)
			end
		end
		local deadline = os.clock() + 25
		while pending > 0 and os.clock() < deadline do
			task.wait(0.1)
		end
	end)
end

return DataService
