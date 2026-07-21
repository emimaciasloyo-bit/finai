--!strict
-- Boat spawning, upgrades (via the physical dockmaster NPC), and the tier-10
-- cruise liner passive income loop.
--
-- Boats are placeholder hulls built from config `appearance` values: a hull
-- part + VehicleSeat, driven by native Roblox vehicle physics. Swap in real
-- models in Studio by dropping a Model named "BoatModel_<tier>" into
-- ServerStorage; buildBoat() will prefer it over the placeholder.

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

local BoatService = {}

-- Where the dockmaster NPC stands; upgrades must happen within interact range.
BoatService.DOCKMASTER_POSITION = Vector3.new(-40, 5, -60)
local BOAT_SPAWN = Vector3.new(0, 3, -30)

local boats: { [Player]: Model } = {}

--------------------------------------------------------------------------------
-- Boat construction
--------------------------------------------------------------------------------

local function buildBoat(player: Player, data: any): Model
	local tierDef = assert(BoatConfig.getTier(data.boatTier), "invalid boat tier")

	-- Prefer a hand-built Studio model if one exists.
	local template = ServerStorage:FindFirstChild(`BoatModel_{tierDef.tier}`) :: Model?
	local boat: Model
	if template then
		boat = template:Clone()
	else
		boat = Instance.new("Model")
		local hull = Instance.new("Part")
		hull.Name = "Hull"
		hull.Size = tierDef.appearance.size
		hull.Color = tierDef.appearance.color
		hull.Material = Enum.Material.SmoothPlastic
		hull.TopSurface = Enum.SurfaceType.Smooth
		hull.Parent = boat

		local seat = Instance.new("VehicleSeat")
		seat.Name = "DriverSeat"
		seat.Size = Vector3.new(2, 1, 2)
		seat.MaxSpeed = tierDef.speed
		seat.Torque = 10
		seat.TurnSpeed = 20
		seat.CFrame = CFrame.new(0, tierDef.appearance.size.Y / 2 + 0.5, -tierDef.appearance.size.Z / 4)
		seat.Parent = boat

		local weld = Instance.new("WeldConstraint")
		weld.Part0 = hull
		weld.Part1 = seat
		weld.Parent = hull

		-- Buoyancy + drive placeholders. A VehicleSeat alone only powers wheels,
		-- so the greybox hull gets explicit movers driven by the Heartbeat loop
		-- below (driveBoats). Replace with real water physics in the Studio pass.
		hull.Anchored = false
		local float = Instance.new("BodyPosition") -- Y-only float; simple + predictable
		float.Name = "FloatY"
		float.MaxForce = Vector3.new(0, math.huge, 0)
		float.Position = Vector3.new(0, 2, 0)
		float.Parent = hull

		local drive = Instance.new("BodyVelocity")
		drive.Name = "Drive"
		drive.MaxForce = Vector3.new(1e5, 0, 1e5) -- XZ only; FloatY owns the Y axis
		drive.Velocity = Vector3.zero
		drive.Parent = hull

		local steer = Instance.new("BodyGyro")
		steer.Name = "Steer"
		steer.MaxTorque = Vector3.new(1e5, 1e6, 1e5) -- strong Y for turning, some XZ to stay upright
		steer.CFrame = CFrame.new()
		steer.Parent = hull

		boat.PrimaryPart = hull
	end

	-- Apply equipped boat skin (cosmetic only — recolors the hull).
	local skinId = data.cosmetics.equipped.boatSkin
	local skin = skinId and MonetizationConfig.BoatSkins[skinId]
	if skin then
		for _, part in boat:GetDescendants() do
			if part:IsA("BasePart") and part.Name == "Hull" then
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
	boat:PivotTo(CFrame.new(BOAT_SPAWN + Vector3.new((player.UserId % 7) * 20, 0, 0)))
	boat.Parent = workspace
	boats[player] = boat
	Remotes.getEvent("BoatSpawned"):FireClient(player, boat)
end

-- Heartbeat drive for placeholder hulls: reads VehicleSeat Throttle/Steer and
-- feeds the BodyVelocity/BodyGyro movers. Skips boats without a "Drive" mover
-- (i.e. real Studio models that bring their own physics).
local function driveBoats(deltaTime: number)
	for _, boat in boats do
		local hull = boat.PrimaryPart
		local seat = boat:FindFirstChild("DriverSeat") :: VehicleSeat?
		if not hull or not seat then
			continue
		end
		local drive = hull:FindFirstChild("Drive") :: BodyVelocity?
		local steer = hull:FindFirstChild("Steer") :: BodyGyro?
		if not drive or not steer then
			continue
		end
		local _, yaw, _ = steer.CFrame:ToEulerAnglesYXZ()
		if seat.Occupant then
			-- Steer.CFrame accumulates yaw; throttle pushes along current heading.
			yaw -= seat.Steer * math.rad(45) * deltaTime
			steer.CFrame = CFrame.Angles(0, yaw, 0)
			local forward = steer.CFrame.LookVector
			drive.Velocity = forward * seat.Throttle * seat.MaxSpeed
		else
			drive.Velocity = Vector3.zero
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
				Remotes.getEvent("Notify"):FireClient(
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
