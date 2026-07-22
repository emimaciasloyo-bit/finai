--!strict
-- Boat spawning, upgrades (via the physical dockmaster NPC), and the tier-10
-- cruise liner passive income loop.
--
-- Player boats come from ModelFactory (procedural, tier-differentiated). To
-- use hand-built art instead, drop a Model named "BoatModel_<tier>" into
-- ServerStorage (PrimaryPart "Hull" with FloatY/Drive/Steer movers +
-- VehicleSeat "DriverSeat") and it will be preferred automatically.
-- Mini-games can register their own driveable boats via registerExternalBoat
-- so they share the same Heartbeat drive loop.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local ServerStorage = game:GetService("ServerStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)
local BoatConfig = require(Shared.Config.BoatConfig)
local MonetizationConfig = require(Shared.Config.MonetizationConfig)
local Remotes = require(Shared.Remotes)

local DataService = require(script.Parent.DataService)
local ModelFactory = require(script.Parent.ModelFactory)

local BoatService = {}

BoatService.DOCKMASTER_POSITION = GameConfig.WORLD.DOCKMASTER_POSITION
local BOAT_SPAWN = GameConfig.WORLD.BOAT_SPAWN

local boats: { [Player]: Model } = {}
local externalBoats: { [Model]: boolean } = {}

--------------------------------------------------------------------------------
-- Boat construction
--------------------------------------------------------------------------------

local function buildBoat(player: Player, data: any): Model
	local tierDef = assert(BoatConfig.getTier(data.boatTier), "invalid boat tier")

	-- Prefer a hand-built Studio model if one exists.
	local template = ServerStorage:FindFirstChild(`BoatModel_{tierDef.tier}`) :: Model?
	local boat = if template then template:Clone() else ModelFactory.buildBoat(tierDef)

	-- Apply equipped boat skin: recolor every part tagged SkinTarget
	-- (or named "Hull" for hand-built models without tags).
	local skinId = data.cosmetics.equipped.boatSkin
	local skin = skinId and MonetizationConfig.BoatSkins[skinId]
	if skin then
		for _, part in boat:GetDescendants() do
			if part:IsA("BasePart") and (part:GetAttribute("SkinTarget") or part.Name == "Hull") then
				part.Color = skin.color
			end
		end
	end

	boat.Name = `Boat_{player.UserId}`
	boat:SetAttribute("OwnerUserId", player.UserId)
	boat:SetAttribute("Tier", tierDef.tier)
	return boat
end

function BoatService.spawnBoat(player: Player)
	local data = DataService.get(player)
	if not data then
		return
	end
	local old = boats[player]
	if old then
		old:Destroy()
	end
	local boat = buildBoat(player, data)
	boat:PivotTo(CFrame.new(BOAT_SPAWN + Vector3.new((player.UserId % 7) * 20 - 60, 0, 0)))
	boat.Parent = workspace
	boats[player] = boat
	Remotes.getEvent("BoatSpawned"):FireClient(player, boat)
end

--------------------------------------------------------------------------------
-- Drive loop (player boats + registered external boats)
--------------------------------------------------------------------------------

-- Mini-games (e.g. Storm Navigation's skiff) opt their boats into the shared
-- drive loop. Unregister (or just Destroy the model) when done.
function BoatService.registerExternalBoat(boat: Model)
	externalBoats[boat] = true
end

function BoatService.unregisterExternalBoat(boat: Model)
	externalBoats[boat] = nil
end

local function driveOne(boat: Model, deltaTime: number)
	local hull = boat.PrimaryPart
	local seat = boat:FindFirstChild("DriverSeat") :: VehicleSeat?
	if not hull or not seat then
		return
	end
	local drive = hull:FindFirstChild("Drive") :: BodyVelocity?
	local steer = hull:FindFirstChild("Steer") :: BodyGyro?
	if not drive or not steer then
		return -- hand-built model bringing its own physics
	end
	local _, yaw, _ = steer.CFrame:ToEulerAnglesYXZ()
	if seat.Occupant then
		-- Steer.CFrame accumulates yaw; throttle pushes along current heading.
		yaw -= seat.Steer * math.rad(45) * deltaTime
		steer.CFrame = CFrame.Angles(0, yaw, 0)
		drive.Velocity = steer.CFrame.LookVector * seat.Throttle * seat.MaxSpeed
	else
		drive.Velocity = Vector3.zero
	end
end

local function driveBoats(deltaTime: number)
	for _, boat in boats do
		driveOne(boat, deltaTime)
	end
	for boat in externalBoats do
		if boat.Parent then
			driveOne(boat, deltaTime)
		else
			externalBoats[boat] = nil -- destroyed; self-clean
		end
	end
end

--------------------------------------------------------------------------------
-- Upgrades
--------------------------------------------------------------------------------

local function nearDockmaster(player: Player): boolean
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not root then
		return false
	end
	return (root.Position - BoatService.DOCKMASTER_POSITION).Magnitude <= GameConfig.DOCK_INTERACT_DISTANCE
end

local function onUpgradeBoat(player: Player): any
	local data = DataService.get(player)
	if not data then
		return { ok = false, message = "Data not loaded" }
	end
	-- Physical interaction requirement: no upgrading from the middle of the ocean.
	if not nearDockmaster(player) then
		return { ok = false, message = "Visit the dockmaster to upgrade your boat." }
	end
	local nextTier = BoatConfig.getTier(data.boatTier + 1)
	if not nextTier then
		return { ok = false, message = "You already own the finest ship on the sea!" }
	end
	-- adjustDoubloons is atomic: it refuses and changes nothing on insufficient funds.
	if not DataService.adjustDoubloons(player, -nextTier.cost) then
		return { ok = false, message = `You need {nextTier.cost} Doubloons for the {nextTier.displayName}.` }
	end
	data.boatTier = nextTier.tier
	DataService.replicate(player, { "boatTier" })
	BoatService.spawnBoat(player)
	Remotes.getEvent("Notify"):FireClient(player, `Upgraded to {nextTier.displayName}!`, "success")
	return { ok = true, newTier = nextTier.tier }
end

--------------------------------------------------------------------------------
-- Cruise liner passive income (endgame reward)
--------------------------------------------------------------------------------

local function passiveIncomeLoop()
	local cfg = GameConfig.CRUISE_PASSIVE
	while true do
		task.wait(cfg.INTERVAL_SECONDS)
		for _, player in Players:GetPlayers() do
			local data = DataService.get(player)
			if data and data.boatTier >= cfg.REQUIRED_TIER then
				DataService.adjustDoubloons(player, cfg.DOUBLOONS_PER_TICK)
				Remotes.getEvent("Notify")
					:FireClient(
						player,
						`Your cruise passengers paid {cfg.DOUBLOONS_PER_TICK} Doubloons in fares!`,
						"info"
					)
			end
		end
	end
end

--------------------------------------------------------------------------------

function BoatService.init()
	Remotes.getFunction("UpgradeBoat").OnServerInvoke = onUpgradeBoat

	-- Spawn a boat once the profile is ready (DataService kicks players whose
	-- data fails to load, so polling get() briefly is safe).
	Players.PlayerAdded:Connect(function(player)
		task.spawn(function()
			local deadline = os.clock() + 30
			while os.clock() < deadline and player.Parent do
				if DataService.get(player) then
					BoatService.spawnBoat(player)
					return
				end
				task.wait(0.5)
			end
		end)
	end)
	Players.PlayerRemoving:Connect(function(player)
		local boat = boats[player]
		boats[player] = nil
		if boat then
			boat:Destroy()
		end
	end)

	RunService.Heartbeat:Connect(driveBoats)
	task.spawn(passiveIncomeLoop)
end

return BoatService
