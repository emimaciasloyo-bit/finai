--!strict
-- Treasure Diving — STUB. Set `enabled = true` in MiniGameConfig once built.
--
-- DESIGN (follow CrabRacing.luau as the reference implementation):
--   * Player starts a solo dive at the dive station (action = "StartDive").
--   * Server spawns `config.treasureCount` treasure markers at random points
--     inside a wreck volume and starts a `config.divingSeconds` air timer.
--   * Client swims and fires action = "Collect" with a treasure id; server
--     validates PROXIMITY (character within ~10 studs of that marker) and that
--     the timer hasn't expired — never trust the client's word for a pickup.
--   * Payout on surfacing: collected * config.payoutPerTreasure, plus
--     context.grantWinXP on collecting more than half.
--   * reportScore(player, collectedCount) for the high-score board.
--
-- TODO:
--   [ ] Treasure spawn volume + placeholder markers (Part + ProximityPrompt)
--   [ ] Air timer with client HUD sync via context.sendTo
--   [ ] Server-side proximity validation on Collect
--   [ ] Payout + XP + high score on "Surface" action or timer expiry
--   [ ] Underwater wreck environment in Studio (see README)

local TreasureDiving = {}

function TreasureDiving.init(_context: any)
	warn("[TreasureDiving] Stub loaded — game is disabled in MiniGameConfig until implemented")
end

function TreasureDiving.handleAction(_player: Player, _action: string, _payload: any)
	-- Intentionally empty: no actions are accepted until the game is implemented.
end

return TreasureDiving
