--!strict
-- Client bootstrap. ClientData first (everything reads it), then the UI
-- controller (owns the ScreenGui), then feature controllers/screens.

local Controllers = script.Parent.Controllers
local UI = script.Parent.UI

local ClientData = require(Controllers.ClientData)
local UIController = require(Controllers.UIController)
local FishingController = require(Controllers.FishingController)
local MinimapController = require(Controllers.MinimapController)
local AmbienceController = require(Controllers.AmbienceController)

local MarketUI = require(UI.MarketUI)
local UpgradeUI = require(UI.UpgradeUI)
local DexUI = require(UI.DexUI)
local BattlePassUI = require(UI.BattlePassUI)
local CrabRacingUI = require(UI.CrabRacingUI)
local TreasureDivingUI = require(UI.TreasureDivingUI)
local StormNavigationUI = require(UI.StormNavigationUI)

ClientData.init()
UIController.init()
FishingController.init(UIController.getGui())
MinimapController.init(UIController.getGui())
AmbienceController.init()

MarketUI.init(UIController)
UpgradeUI.init(UIController)
DexUI.init(UIController)
BattlePassUI.init(UIController)
CrabRacingUI.init(UIController)
TreasureDivingUI.init(UIController)
StormNavigationUI.init(UIController)

print("[CruiseTycoon] Client initialized")
