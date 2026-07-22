--!strict
-- Storm Navigation — solo timed slalom in a loaner skiff.
--
-- Flow: "Start" at the station -> server builds a zigzag course of neon
-- checkpoint gates with rock hazards between them, spawns a skiff (shared
-- drive loop via BoatService.registerExternalBoat), and seats the player.
-- Checkpoints must be hit IN ORDER (server-side Touched detection on the
-- skiff's parts only); each hazard hit cuts the payout. Finish all gates
-- before the clock for the full payout; timer expiry pays consolation per
-- gate. High score = time remaining in ms on a clean finish-friendly scale.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)

local BoatService = require(script.Parent.Parent.BoatService)
local ModelFactory = require(script.Parent.Parent.ModelFactory)

local StormNavigation = {}

local context: any = nil
local config: any = nil

type Session = {
	startedAt: number,
	endsAt: number,
	nextCheckpoint: number,
	hits: number,
	lastHitAt: number,
	folder: Folder,
	skiff: Model,
	returnCFrame: CFrame,
	finished: boolean,
}

local sessions: { [Player]: Session } = {}

local SKIFF_DEF = {
	tier = 3,
	displayName = "Storm Skiff",
	speed = 0, -- filled from config at init
	appearance = { size = Vector3.new(5, 2, 11), color = Color3.fromRGB(70, 80, 100) },
}

local function sendState(player: Player, session: Session)
	context.sendTo(player, {
		phase = "Active",
		timeLeft = math.max(0, math.floor(session.endsAt - os.clock())),
		checkpoints = session.nextCheckpoint - 1,
		totalCheckpoints = config.checkpointCount,
		hits = session.hits,
	})
end

local function isSessionHull(session: Session, hit: BasePart): boolean
	return hit:IsDescendantOf(session.skiff)
end

local function endSession(player: Player, session: Session, finishedCourse: boolean)
	if session.finished then
		return
	end
	session.finished = true
	sessions[player] = nil
	BoatService.unregisterExternalBoat(session.skiff)

	local payout: number
	local elapsed = os.clock() - session.startedAt
	if finishedCourse then
		local multiplier = math.max(1 - session.hits * config.hitPenalty, 0.1)
		payout = math.floor(config.basePayout * multiplier)
		context.grantWinXP(player)
		-- Higher = better: remaining milliseconds, only on a real finish.
		context.reportScore(player, math.floor((config.courseSeconds - elapsed) * 1000))
	else
		payout = (session.nextCheckpoint - 1) * config.consolationPerCheckpoint
	end
	if payout > 0 then
		context.awardDoubloons(player, payout)
	end

	local character = player.Character
	if character and character.Parent then
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.Sit = false
		end
		task.wait(0.1) -- let the seat weld release before teleporting
		character:PivotTo(session.returnCFrame)
	end
	session.folder:Destroy()
	session.skiff:Destroy()

	context.sendTo(player, {
		phase = "Done",
		finished = finishedCourse,
		hits = session.hits,
		payout = payout,
		timeTaken = math.floor(elapsed),
	})
end

-- Zigzag course heading south (+X wiggle, -Z advance) from the start buoy.
local function checkpointPosition(start: Vector3, index: number): Vector3
	local advance = 55
	local wiggle = 35
	return start + Vector3.new(math.sin(index * 1.9) * wiggle, 0, -index * advance)
end

local function buildCourse(player: Player, session: Session, start: Vector3)
	for index = 1, config.checkpointCount do
		local position = checkpointPosition(start, index)
		local isFinish = index == config.checkpointCount

		local gate = Instance.new("Part")
		gate.Name = `Checkpoint{index}`
		gate.Size = Vector3.new(16, 12, 2)
		gate.CFrame = CFrame.new(Vector3.new(position.X, 4, position.Z))
		gate.Anchored = true
		gate.CanCollide = false
		gate.Transparency = 0.5
		gate.Color = if isFinish then Color3.fromRGB(240, 195, 80) else Color3.fromRGB(70, 210, 110)
		gate.Material = Enum.Material.Neon
		gate.Touched:Connect(function(hit)
			if session.finished or not isSessionHull(session, hit) then
				return
			end
			if index ~= session.nextCheckpoint then
				return -- out of order: ignore (no skipping gates)
			end
			session.nextCheckpoint += 1
			gate.Transparency = 0.9
			if session.nextCheckpoint > config.checkpointCount then
				endSession(player, session, true)
			else
				sendState(player, session)
			end
		end)
		gate.Parent = session.folder

		-- Hazard rocks scattered in the gap before this gate.
		if index > 1 then
			local previous = checkpointPosition(start, index - 1)
			for hazardIndex = 1, config.hazardsPerGap do
				local t = hazardIndex / (config.hazardsPerGap + 1)
				local mid = previous:Lerp(position, t)
				local rock = Instance.new("Part")
				rock.Name = "Hazard"
				rock.Shape = Enum.PartType.Ball
				rock.Size = Vector3.new(6, 6, 6)
				rock.Position = Vector3.new(mid.X + (math.random() - 0.5) * 24, 0.5, mid.Z)
				rock.Anchored = true
				rock.CanCollide = true
				rock.Color = Color3.fromRGB(80, 80, 90)
				rock.Material = Enum.Material.Slate
				rock.Touched:Connect(function(hit)
					if session.finished or not isSessionHull(session, hit) then
						return
					end
					-- 1s debounce so one scrape isn't five hits.
					if os.clock() - session.lastHitAt < 1 then
						return
					end
					session.lastHitAt = os.clock()
					session.hits += 1
					sendState(player, session)
				end)
				rock.Parent = session.folder
			end
		end
	end
end

local function startRun(player: Player)
	if sessions[player] then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if not character or not root or not humanoid then
		return
	end

	local start: Vector3 = GameConfig.WORLD.STORM_COURSE_START

	local folder = Instance.new("Folder")
	folder.Name = `StormRun_{player.UserId}`
	folder.Parent = workspace

	local skiff = ModelFactory.buildBoat(SKIFF_DEF)
	skiff.Name = `StormSkiff_{player.UserId}`
	-- Face the course (-Z).
	skiff:PivotTo(CFrame.new(start))
	skiff.Parent = workspace
	BoatService.registerExternalBoat(skiff)

	local session: Session = {
		startedAt = os.clock(),
		endsAt = os.clock() + config.courseSeconds,
		nextCheckpoint = 1,
		hits = 0,
		lastHitAt = 0,
		folder = folder,
		skiff = skiff,
		returnCFrame = root.CFrame,
		finished = false,
	}
	sessions[player] = session
	buildCourse(player, session, start)

	-- Seat the player in the skiff.
	local seat = skiff:FindFirstChild("DriverSeat") :: VehicleSeat
	character:PivotTo(seat.CFrame * CFrame.new(0, 3, 0))
	task.wait(0.1)
	seat:Sit(humanoid)
	sendState(player, session)

	-- Clock + 1s ticker.
	task.spawn(function()
		while not session.finished do
			task.wait(1)
			if session.finished then
				return
			end
			if os.clock() >= session.endsAt or not player.Parent then
				endSession(player, session, false)
				return
			end
			sendState(player, session)
		end
	end)
end

--------------------------------------------------------------------------------
-- MiniGameManager contract
--------------------------------------------------------------------------------

function StormNavigation.init(managerContext: any)
	context = managerContext
	config = managerContext.config
	SKIFF_DEF.speed = config.skiffSpeed
	Players.PlayerRemoving:Connect(function(player)
		local session = sessions[player]
		if session then
			session.finished = true
			sessions[player] = nil
			BoatService.unregisterExternalBoat(session.skiff)
			session.folder:Destroy()
			session.skiff:Destroy()
		end
	end)
end

function StormNavigation.handleAction(player: Player, action: string, _payload: any)
	if action == "Start" then
		startRun(player)
	elseif action == "Abort" then
		local session = sessions[player]
		if session then
			endSession(player, session, false)
		end
	end
end

return StormNavigation
