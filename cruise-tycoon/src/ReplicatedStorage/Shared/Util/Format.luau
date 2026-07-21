--!strict
-- Small display-formatting helpers shared by all UI.

local Format = {}

-- 1234567 -> "1.23M", 4200 -> "4.2K", 999 -> "999"
function Format.abbreviate(amount: number): string
	local absAmount = math.abs(amount)
	local sign = if amount < 0 then "-" else ""
	if absAmount >= 1_000_000_000 then
		return string.format("%s%.2fB", sign, absAmount / 1_000_000_000)
	elseif absAmount >= 1_000_000 then
		return string.format("%s%.2fM", sign, absAmount / 1_000_000)
	elseif absAmount >= 10_000 then
		return string.format("%s%.1fK", sign, absAmount / 1_000)
	elseif absAmount >= 1_000 then
		return string.format("%s%.2fK", sign, absAmount / 1_000)
	end
	return sign .. tostring(math.floor(absAmount))
end

-- 1234567 -> "1,234,567" for precise contexts (shop prices)
function Format.comma(amount: number): string
	local formatted = tostring(math.floor(amount))
	while true do
		local replaced
		formatted, replaced = string.gsub(formatted, "^(-?%d+)(%d%d%d)", "%1,%2")
		if replaced == 0 then
			break
		end
	end
	return formatted
end

function Format.weight(kg: number): string
	if kg >= 100 then
		return string.format("%d kg", math.floor(kg))
	end
	return string.format("%.1f kg", kg)
end

function Format.clock(seconds: number): string
	local mins = math.floor(seconds / 60)
	local secs = math.floor(seconds % 60)
	return string.format("%d:%02d", mins, secs)
end

return Format
