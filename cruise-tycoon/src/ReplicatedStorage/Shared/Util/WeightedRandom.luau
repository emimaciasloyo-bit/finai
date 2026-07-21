--!strict
-- Weighted random selection with an optional "luck" skew.
-- Luck shifts probability mass from early entries toward later entries, so
-- weight tables MUST be ordered common -> rare when luck is used.

local WeightedRandom = {}

local rng = Random.new()

export type WeightedEntry<T> = { value: T, weight: number }

-- Pick from an ordered list of {value, weight}. luck (0..1) multiplies each
-- entry's weight by (1 + luck * indexBias) where later entries get more bias.
function WeightedRandom.pick<T>(entries: { WeightedEntry<T> }, luck: number?): T?
	local appliedLuck = math.clamp(luck or 0, 0, 1)
	local total = 0
	local weights = table.create(#entries)
	for index, entry in entries do
		-- indexBias: 0 for the first entry, rising to 3 for the last, so max
		-- luck (1.0) quadruples the relative weight of the rarest entry.
		local indexBias = if #entries > 1 then 3 * (index - 1) / (#entries - 1) else 0
		local weight = entry.weight * (1 + appliedLuck * indexBias)
		weights[index] = weight
		total += weight
	end
	if total <= 0 then
		return nil
	end
	local roll = rng:NextNumber() * total
	for index, entry in entries do
		roll -= weights[index]
		if roll <= 0 then
			return entry.value
		end
	end
	return entries[#entries].value
end

function WeightedRandom.range(min: number, max: number): number
	return min + rng:NextNumber() * (max - min)
end

-- Biased range roll: bias 0 = uniform, bias 1 = strongly favors max.
-- Used to reward accurate reeling with heavier fish.
function WeightedRandom.biasedRange(min: number, max: number, bias: number): number
	local sample = rng:NextNumber()
	local shaped = sample ^ (1 / (1 + math.clamp(bias, 0, 1)))
	return min + shaped * (max - min)
end

return WeightedRandom
