--!strict
-- Server bootstrap. Order matters:
--   1. Remotes first (clients wait on the folder)
--   2. DataService before anything that reads profiles
--   3. Everything else in dependency order
-- Each service exposes a single init(); services talk to each other via
-- require, never via _G or globals.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Shared = ReplicatedStorage:WaitForChild("Shared")
local Remotes = require(Shared.Remotes)

local Services = script.Parent.Services

Remotes.init()

local DataService = require(Services.DataService)
local BattlePassService = require(Services.BattlePassService)
local MarketService = require(Services.MarketService)
local BoatService = require(Services.BoatService)
local EconomyService = require(Services.EconomyService)
local FishingService = require(Services.FishingService)
local MiniGameManager = require(Services.MiniGameManager)
local MonetizationService = require(Services.MonetizationService)
local PetService = require(Services.PetService)
local WorldService = require(Services.WorldService)

DataService.init()
BattlePassService.init()
MarketService.init()
BoatService.init()
EconomyService.init()
FishingService.init()
MiniGameManager.init()
MonetizationService.init()
PetService.init()
WorldService.init()

print("[CruiseTycoon] Server initialized")
