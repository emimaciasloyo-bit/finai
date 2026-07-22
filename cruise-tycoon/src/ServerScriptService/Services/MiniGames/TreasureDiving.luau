--!strict
-- Treasure Diving — solo timed dive at the sunken wreck.
--
-- Flow: "Start" at the station -> server teleports the diver into the water
-- above the wreck, scatters glowing treasure chests on the seafloor, and runs
-- an air timer. Treasures are collected via their ProximityPrompts (fired
-- server-side; the server re-validates distance and session ownership, so a
-- hacked client can't vacuum the wreck from the surface). "Surface" or timer
-- expiry ends the dive: payout per treasure, XP for a half-or-better haul,
-- high score = most treasures in one dive.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local GameConfig = require(Shared.Config.GameConfig)

local TreasureDiving = {}

local context: any = nil
local config: any = nil

type Session = {
	endsAt: number,
	collected: number,
	treasures: { [Part]: boolean },
	folder: Folder,
	returnCFrame: CFrame,
	finished: boolean,
}

local sessions: { [Player]: Session } = {}

local function sendState(player: Player, session: Session)
	context.sendTo(player, {
		phase = "Active",
		timeLeft = math.max(0, math.floor(session.endsAt - os.clock())),
		collected = session.collected,
		total = config.treasureCount,
	})
end

local function endSession(player: Player, session: Session)
	if session.finished then
		return
	end
	session.finished = true
	sessions[player] = nil
	session.folder:Destroy()

	local payout = session.collected * config.payoutPerTreasure
	if payout > 0 then
		context.awardDoubloons(player, payout)
	end
	if session.collected >= math.ceil(config.treasureCount / 2) then
		context.grantWinXP(player)
	end
	context.reportScore(player, session.collected)

	-- Return the diver to the station platform.
	local character = player.Character
	if character and character.Parent then
		character:PivotTo(session.returnCFrame)
	end
	context.sendTo(player, {
		phase = "Done",
		collected = session.collected,
		total = config.treasureCount,
		payout = payout,
	})
end

local function spawnTreasure(player: Player, session: Session, position: Vector3)
	local chest = Instance.new("Part")
	chest.Name = "Treasure"
	chest.Size = Vector3.new(2, 1.4, 1.4)
	chest.Position = position
	chest.Anchored = true
	chest.CanCollide = false
	chest.Color = Color3.fromRGB(240, 195, 80)
	chest.Material = Enum.Material.Neon
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 210, 110)
	light.Range = 12
	light.Parent = chest

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Grab Treasure"
	prompt.MaxActivationDistance = 10
	prompt.RequiresLineOfSight = false
	prompt.Parent = chest

	-- ProximityPrompt.Triggered runs on the server; validate the grabber is
	-- THIS session's diver and actually near the chest (anti-exploit).
	prompt.Triggered:Connect(function(triggeringPlayer)
		if triggeringPlayer ~= player or session.finished or not session.treasures[chest] then
			return
		end
		local character = triggeringPlayer.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not root or (root.Position - chest.Position).Magnitude > config.collectRange then
			return
		end
		session.treasures[chest] = nil
		session.collected += 1
		chest:Destroy()
		sendState(player, session)
	end)

	session.treasures[chest] = true
	chest.Parent = session.folder
end

local function startDive(player: Player)
	if sessions[player] then
		return
	end
	local character = player.Character
	local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
	if not character or not root then
		return
	end

	local site: Vector3 = GameConfig.WORLD.DIVE_SITE
	local folder = Instance.new("Folder")
	folder.Name = `Dive_{player.UserId}`
	folder.Parent = workspace

	local session: Session = {
		endsAt = os.clock() + config.divingSeconds,
		collected = 0,
		treasures = {},
		folder = folder,
		returnCFrame = root.CFrame,
		finished = false,
	}
	sessions[player] = session

	-- Scatter chests on the seafloor around the wreck.
	for _ = 1, config.treasureCount do
		local angle = math.random() * math.pi * 2
		local radius = 6 + math.random() * (config.scatterRadius - 6)
		spawnTreasure(
			player,
			session,
			site + Vector3.new(math.cos(angle) * radius, 1 + math.random() * 3, math.sin(angle) * radius)
		)
	end

	-- Drop the diver into the water above the wreck.
	character:PivotTo(CFrame.new(site + Vector3.new(0, 18, 0)))
	sendState(player, session)

	-- Air timer + 1s state ticker.
	task.spawn(function()
		while not session.finished do
			task.wait(1)
			if session.finished then
				return
			end
			if os.clock() >= session.endsAt or session.collected >= config.treasureCount or not player.Parent then
				endSession(player, session)
				return
			end
			sendState(player, session)
		end
	end)
end

--------------------------------------------------------------------------------
-- MiniGameManager contract
--------------------------------------------------------------------------------

function TreasureDiving.init(managerContext: any)
	context = managerContext
	config = managerContext.config
	Players.PlayerRemoving:Connect(function(player)
		local session = sessions[player]
		if session then
			session.finished = true
			sessions[player] = nil
			session.folder:Destroy()
		end
	end)
end

function TreasureDiving.handleAction(player: Player, action: string, _payload: any)
	if action == "Start" then
		startDive(player)
	elseif action == "Surface" then
		local session = sessions[player]
		if session then
			endSession(player, session)
		end
	end
end

return TreasureDiving
