--!strict
-- Spawns/despawns the equipped cosmetic pet and makes it bob along behind the
-- player's shoulder. Purely visual — the pet's tiny luck/sell bonuses are read
-- directly from data by Fishing/Market services, never from the model.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")

local DataService = require(script.Parent.DataService)
local ModelFactory = require(script.Parent.ModelFactory)

local PetService = {}

local pets: { [Player]: { petId: string, model: Model } } = {}

local function syncPet(player: Player)
	local data = DataService.get(player)
	local wantedId = data and data.cosmetics.equipped.pet or nil
	local current = pets[player]
	if current and current.petId == wantedId then
		return
	end
	if current then
		current.model:Destroy()
		pets[player] = nil
	end
	if wantedId then
		local model = ModelFactory.buildPet(wantedId)
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		model:PivotTo(CFrame.new((root and root.Position or Vector3.zero) + Vector3.new(2, 3, 2)))
		model.Parent = workspace
		pets[player] = { petId = wantedId, model = model }
	end
end

local function followStep(deltaTime: number)
	local now = os.clock()
	for player, pet in pets do
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart") :: BasePart?
		if not root or not pet.model.Parent then
			continue
		end
		-- Hover behind-right of the shoulder with a gentle sine bob.
		local bob = math.sin(now * 3 + player.UserId % 10) * 0.4
		local target = root.CFrame * CFrame.new(2.5, 2 + bob, 2.5)
		local current = pet.model:GetPivot()
		pet.model:PivotTo(current:Lerp(target, math.min(deltaTime * 6, 1)))
	end
end

function PetService.init()
	-- Equip changes flow through DataService.replicate("cosmetics"); polling
	-- once a second keeps this decoupled from EconomyService internals.
	task.spawn(function()
		while true do
			task.wait(1)
			for _, player in Players:GetPlayers() do
				syncPet(player)
			end
		end
	end)
	RunService.Heartbeat:Connect(followStep)
	Players.PlayerRemoving:Connect(function(player)
		local pet = pets[player]
		pets[player] = nil
		if pet then
			pet.model:Destroy()
		end
	end)
end

return PetService
