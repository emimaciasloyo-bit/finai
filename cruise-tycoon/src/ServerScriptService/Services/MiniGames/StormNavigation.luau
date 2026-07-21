--!strict
-- Storm Navigation — STUB. Set `enabled = true` in MiniGameConfig once built.
--
-- DESIGN (follow CrabRacing.luau as the reference implementation):
--   * Player starts a run at the storm station (action = "StartRun"); server
--     teleports their boat to a course start and spawns `config.hazardCount`
--     hazards (rocks/whirlpools) along a lane.
--   * Server watches the boat via Touched events / periodic raycasts — hazard
--     hits are detected SERVER-side and each hit cuts the payout multiplier.
--   * Finishing within `config.courseSeconds` pays
--     config.basePayout * (1 - hits * 0.2), minimum 10%; clean run grants
--     context.grantWinXP and a hidden "Storm Ace" flourish.
--   * reportScore(player, finishTimeMillis) — lower is better, so store
--     (courseSeconds*1000 - time) to keep "higher = better" score semantics.
--
-- TODO:
--   [ ] Course generation (checkpoint parts + hazard parts, server-owned)
--   [ ] Server-side hit detection & checkpoint order enforcement
--   [ ] Timer + payout math + XP
--   [ ] Storm VFX/audio pass in Studio (see README)

local StormNavigation = {}

function StormNavigation.init(_context: any)
	warn("[StormNavigation] Stub loaded — game is disabled in MiniGameConfig until implemented")
end

function StormNavigation.handleAction(_player: Player, _action: string, _payload: any)
	-- Intentionally empty: no actions are accepted until the game is implemented.
end

return StormNavigation
