--!strict
-- Client-side replica of the player's PlayerData.
-- Boots from GetData, then merges DataChanged partial snapshots. UI reads
-- ClientData.get() and subscribes to Changed — never talks to remotes for data.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)

local ClientData = {}

local data: any = nil
local changedEvent = Instance.new("BindableEvent")

-- Fired with the set of top-level keys that changed.
ClientData.Changed = changedEvent.Event

function ClientData.get(): any
	return data
end

-- Convenience: waits until the initial snapshot has arrived.
function ClientData.await(): any
	while data == nil do
		task.wait(0.1)
	end
	return data
end

function ClientData.init()
	Remotes.getEvent("DataChanged").OnClientEvent:Connect(function(snapshot: { [string]: any })
		if data == nil then
			data = snapshot
		else
			for key, value in snapshot do
				data[key] = value
			end
		end
		local keys = {}
		for key in snapshot do
			table.insert(keys, key)
		end
		changedEvent:Fire(keys)
	end)

	task.spawn(function()
		local snapshot = Remotes.getFunction("GetData"):InvokeServer()
		-- A DataChanged may have raced us with fresher info; only fill gaps.
		if snapshot then
			if data == nil then
				data = snapshot
			else
				for key, value in snapshot do
					if data[key] == nil then
						data[key] = value
					end
				end
			end
			changedEvent:Fire({ "all" })
		end
	end)
end

return ClientData
