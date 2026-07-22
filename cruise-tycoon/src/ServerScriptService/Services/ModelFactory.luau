--!strict
-- Procedural placeholder-plus models: boats that visibly evolve per tier,
-- blocky NPC characters, follower pets, race crabs, and buoys.
-- These are deliberately simple part-built models so the game ships with zero
-- uploaded assets; swap any of them for real meshes later without touching
-- game logic (the contracts are just part names + attributes).

local ModelFactory = {}

type PartProps = {
	name: string?,
	size: Vector3,
	cframe: CFrame,
	color: Color3?,
	material: Enum.Material?,
	transparency: number?,
	shape: ("Block" | "Ball" | "Cylinder" | "Wedge")?,
	anchored: boolean?,
	canCollide: boolean?,
}

local function makePart(props: PartProps): BasePart
	local part: BasePart
	if props.shape == "Wedge" then
		part = Instance.new("WedgePart")
	else
		local p = Instance.new("Part")
		if props.shape == "Ball" then
			p.Shape = Enum.PartType.Ball
		elseif props.shape == "Cylinder" then
			p.Shape = Enum.PartType.Cylinder
		end
		part = p
	end
	part.Name = props.name or "Part"
	part.Size = props.size
	part.CFrame = props.cframe
	part.Color = props.color or Color3.fromRGB(128, 128, 128)
	part.Material = props.material or Enum.Material.SmoothPlastic
	part.Transparency = props.transparency or 0
	part.Anchored = props.anchored ~= false
	part.CanCollide = props.canCollide ~= false
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	return part
end

local function weldTo(root: BasePart, part: BasePart)
	part.Anchored = false
	part.Massless = true -- decorations must not change hull physics
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = root
	weld.Part1 = part
	weld.Parent = root
end

--------------------------------------------------------------------------------
-- Boats
--------------------------------------------------------------------------------

-- Builds a driveable boat from a BoatConfig-style tier def. Contract with
-- BoatService: PrimaryPart "Hull" (movers FloatY/Drive/Steer attached),
-- VehicleSeat "DriverSeat", skinnable parts tagged with the SkinTarget
-- attribute. Bow faces -Z.
function ModelFactory.buildBoat(tierDef: any): Model
	local size: Vector3 = tierDef.appearance.size
	local color: Color3 = tierDef.appearance.color
	local tier: number = tierDef.tier or 1

	local model = Instance.new("Model")
	model.Name = "Boat"

	local hull = makePart({
		name = "Hull",
		size = size,
		cframe = CFrame.new(),
		color = color,
		material = if tier <= 2 then Enum.Material.WoodPlanks else Enum.Material.SmoothPlastic,
		anchored = false,
	})
	hull:SetAttribute("SkinTarget", true)
	hull.Parent = model
	model.PrimaryPart = hull

	-- Bow wedge (orientation is cosmetic; slope points forward).
	local bowLength = size.Z * 0.3
	local bow = makePart({
		name = "Bow",
		size = Vector3.new(size.X, size.Y, bowLength),
		cframe = CFrame.new(0, 0, -(size.Z / 2 + bowLength / 2)) * CFrame.Angles(0, math.pi, 0),
		color = color,
		material = hull.Material,
		shape = "Wedge",
	})
	bow:SetAttribute("SkinTarget", true)
	weldTo(hull, bow)
	bow.Parent = model

	-- Deck: lighter strip on top.
	local deck = makePart({
		name = "Deck",
		size = Vector3.new(size.X * 0.85, 0.4, size.Z * 0.9),
		cframe = CFrame.new(0, size.Y / 2 + 0.2, 0),
		color = Color3.fromRGB(190, 160, 110),
		material = Enum.Material.WoodPlanks,
	})
	weldTo(hull, deck)
	deck.Parent = model

	-- Driver seat: rear-center of the deck, facing the bow (-Z).
	local seat = Instance.new("VehicleSeat")
	seat.Name = "DriverSeat"
	seat.Size = Vector3.new(2, 1, 2)
	seat.MaxSpeed = tierDef.speed
	seat.Torque = 10
	seat.TurnSpeed = 20
	seat.Color = Color3.fromRGB(60, 50, 40)
	seat.CFrame = CFrame.new(0, size.Y / 2 + 0.9, size.Z * 0.3)
	weldTo(hull, seat)
	seat.Parent = model

	-- Tier 4+: cabin with a dark windshield.
	if tier >= 4 then
		local cabinSize = Vector3.new(size.X * 0.6, math.max(size.Y * 0.9, 2.4), size.Z * 0.22)
		local cabin = makePart({
			name = "Cabin",
			size = cabinSize,
			cframe = CFrame.new(0, size.Y / 2 + cabinSize.Y / 2 + 0.4, -size.Z * 0.05),
			color = if tier >= 9 then Color3.fromRGB(245, 245, 250) else color:Lerp(Color3.new(1, 1, 1), 0.25),
			material = Enum.Material.SmoothPlastic,
		})
		cabin:SetAttribute("SkinTarget", true)
		weldTo(hull, cabin)
		cabin.Parent = model

		local windshield = makePart({
			name = "Windshield",
			size = Vector3.new(cabinSize.X * 0.85, cabinSize.Y * 0.45, 0.2),
			cframe = cabin.CFrame * CFrame.new(0, cabinSize.Y * 0.15, -cabinSize.Z / 2 - 0.1),
			color = Color3.fromRGB(40, 60, 90),
			material = Enum.Material.Glass,
			transparency = 0.3,
		})
		weldTo(hull, windshield)
		windshield.Parent = model
	end

	-- Tier 7+: sonar mast with a radar ball.
	if tier >= 7 then
		local mastHeight = size.Y + 4
		local mast = makePart({
			name = "Mast",
			size = Vector3.new(0.4, mastHeight, 0.4),
			cframe = CFrame.new(0, size.Y / 2 + mastHeight / 2, size.Z * 0.12),
			color = Color3.fromRGB(90, 90, 100),
		})
		weldTo(hull, mast)
		mast.Parent = model
		local radar = makePart({
			name = "Radar",
			size = Vector3.new(1.4, 1.4, 1.4),
			cframe = mast.CFrame * CFrame.new(0, mastHeight / 2 + 0.7, 0),
			color = Color3.fromRGB(230, 230, 235),
			shape = "Ball",
		})
		weldTo(hull, radar)
		radar.Parent = model
	end

	-- Tier 9+: long dark window stripes along each side (yacht/liner look).
	if tier >= 9 then
		for _, xSign in { -1, 1 } do
			local stripe = makePart({
				name = "WindowStripe",
				size = Vector3.new(0.2, size.Y * 0.25, size.Z * 0.7),
				cframe = CFrame.new(xSign * (size.X / 2 + 0.1), size.Y * 0.15, 0),
				color = Color3.fromRGB(35, 45, 70),
				material = Enum.Material.Glass,
				transparency = 0.2,
			})
			weldTo(hull, stripe)
			stripe.Parent = model
		end
	end

	-- Tier 10: cruise liner superstructure + two red funnels.
	if tier == 10 then
		local upperDeck = makePart({
			name = "UpperDeck",
			size = Vector3.new(size.X * 0.75, 3, size.Z * 0.6),
			cframe = CFrame.new(0, size.Y / 2 + 4.4, size.Z * 0.02),
			color = Color3.fromRGB(250, 250, 255),
		})
		upperDeck:SetAttribute("SkinTarget", true)
		weldTo(hull, upperDeck)
		upperDeck.Parent = model
		for index, zOffset in { -size.Z * 0.12, size.Z * 0.12 } do
			local funnel = makePart({
				name = `Funnel{index}`,
				size = Vector3.new(2.2, 5, 2.2),
				cframe = CFrame.new(0, size.Y / 2 + 8.4, zOffset),
				color = Color3.fromRGB(200, 60, 60),
				shape = "Cylinder",
			})
			-- Cylinders lie along X by default; stand it upright.
			funnel.CFrame *= CFrame.Angles(0, 0, math.rad(90))
			weldTo(hull, funnel)
			funnel.Parent = model
		end
	end

	-- Physics movers (Y float + XZ drive + yaw steer), driven by
	-- BoatService.driveBoats. BodyMovers are deprecated-but-stable; they keep
	-- greybox physics dead simple. Swap for constraints during a physics pass.
	local float = Instance.new("BodyPosition")
	float.Name = "FloatY"
	float.MaxForce = Vector3.new(0, math.huge, 0)
	float.Position = Vector3.new(0, 2, 0)
	float.Parent = hull

	local drive = Instance.new("BodyVelocity")
	drive.Name = "Drive"
	drive.MaxForce = Vector3.new(1e6, 0, 1e6)
	drive.Velocity = Vector3.zero
	drive.Parent = hull

	local steer = Instance.new("BodyGyro")
	steer.Name = "Steer"
	steer.MaxTorque = Vector3.new(1e6, 1e7, 1e6)
	steer.CFrame = CFrame.new()
	steer.Parent = hull

	return model
end

--------------------------------------------------------------------------------
-- NPCs
--------------------------------------------------------------------------------

-- Blocky anchored character statue (R6 proportions). Returns the model; the
-- caller attaches billboards/prompts (that contract lives in WorldService).
function ModelFactory.buildNPC(name: string, outfitColor: Color3, position: Vector3, facingYaw: number?): Model
	local model = Instance.new("Model")
	model.Name = name
	local base = CFrame.new(position) * CFrame.Angles(0, facingYaw or 0, 0)
	local skin = Color3.fromRGB(234, 184, 146)
	local pants = Color3.fromRGB(50, 60, 75)

	local torso = makePart({
		name = "Torso",
		size = Vector3.new(2, 2, 1),
		cframe = base * CFrame.new(0, 3, 0),
		color = outfitColor,
	})
	torso.Parent = model
	model.PrimaryPart = torso

	makePart({
		name = "Head",
		size = Vector3.new(1.2, 1.2, 1.2),
		cframe = base * CFrame.new(0, 4.6, 0),
		color = skin,
	}).Parent =
		model

	for _, side in { -1, 1 } do
		makePart({
			name = "Arm",
			size = Vector3.new(0.9, 2, 0.9),
			cframe = base * CFrame.new(side * 1.45, 3, 0),
			color = outfitColor,
		}).Parent =
			model
		makePart({
			name = "Leg",
			size = Vector3.new(0.9, 2, 0.9),
			cframe = base * CFrame.new(side * 0.5, 1, 0),
			color = pants,
		}).Parent =
			model
	end
	return model
end

--------------------------------------------------------------------------------
-- Pets (all-anchored; PetService PivotTo's the whole model to follow)
--------------------------------------------------------------------------------

function ModelFactory.buildPet(petId: string): Model
	local model = Instance.new("Model")
	model.Name = `Pet_{petId}`

	local body: BasePart
	if petId == "Crab" then
		body = makePart({
			name = "Body",
			size = Vector3.new(1.6, 0.8, 1.2),
			cframe = CFrame.new(),
			color = Color3.fromRGB(220, 80, 60),
			canCollide = false,
		})
		for _, side in { -1, 1 } do
			makePart({
				name = "Claw",
				size = Vector3.new(0.5, 0.5, 0.7),
				cframe = CFrame.new(side * 1, 0, -0.6),
				color = Color3.fromRGB(240, 100, 80),
				canCollide = false,
			}).Parent =
				model
		end
	elseif petId == "Parrot" then
		body = makePart({
			name = "Body",
			size = Vector3.new(0.9, 1.1, 1.2),
			cframe = CFrame.new(),
			color = Color3.fromRGB(60, 170, 80),
			canCollide = false,
		})
		makePart({
			name = "Head",
			size = Vector3.new(0.7, 0.7, 0.7),
			cframe = CFrame.new(0, 0.8, -0.3),
			color = Color3.fromRGB(220, 70, 70),
			shape = "Ball",
			canCollide = false,
		}).Parent =
			model
	else -- Seagull (default)
		body = makePart({
			name = "Body",
			size = Vector3.new(0.9, 0.9, 1.4),
			cframe = CFrame.new(),
			color = Color3.fromRGB(240, 240, 245),
			shape = "Ball",
			canCollide = false,
		})
		for _, side in { -1, 1 } do
			makePart({
				name = "Wing",
				size = Vector3.new(1.2, 0.15, 0.7),
				cframe = CFrame.new(side * 0.9, 0.2, 0),
				color = Color3.fromRGB(210, 210, 220),
				canCollide = false,
			}).Parent =
				model
		end
		makePart({
			name = "Beak",
			size = Vector3.new(0.25, 0.2, 0.5),
			cframe = CFrame.new(0, 0.1, -0.9),
			color = Color3.fromRGB(240, 170, 60),
			canCollide = false,
		}).Parent =
			model
	end
	body.Parent = model
	model.PrimaryPart = body
	return model
end

--------------------------------------------------------------------------------
-- Race crabs (anchored; CrabRacing PivotTo's them along the track)
--------------------------------------------------------------------------------

function ModelFactory.buildCrab(color: Color3): Model
	local model = Instance.new("Model")
	model.Name = "RaceCrab"
	local body = makePart({
		name = "Body",
		size = Vector3.new(2.2, 1, 1.6),
		cframe = CFrame.new(),
		color = color,
		canCollide = false,
	})
	body.Parent = model
	model.PrimaryPart = body
	for _, side in { -1, 1 } do
		makePart({
			name = "Claw",
			size = Vector3.new(0.7, 0.7, 0.9),
			cframe = CFrame.new(side * 1.4, 0, -0.8),
			color = color:Lerp(Color3.new(1, 1, 1), 0.2),
			canCollide = false,
		}).Parent =
			model
		for legIndex = 1, 3 do
			makePart({
				name = "Leg",
				size = Vector3.new(0.25, 0.8, 0.25),
				cframe = CFrame.new(side * 1.3, -0.5, -0.6 + legIndex * 0.5),
				color = color,
				canCollide = false,
			}).Parent =
				model
		end
	end
	for _, side in { -1, 1 } do
		makePart({
			name = "Eye",
			size = Vector3.new(0.25, 0.4, 0.25),
			cframe = CFrame.new(side * 0.4, 0.7, -0.7),
			color = Color3.fromRGB(20, 20, 20),
			canCollide = false,
		}).Parent =
			model
	end
	return model
end

--------------------------------------------------------------------------------
-- Buoys (zone boundary markers)
--------------------------------------------------------------------------------

function ModelFactory.buildBuoy(color: Color3, position: Vector3): Model
	local model = Instance.new("Model")
	model.Name = "Buoy"
	local float = makePart({
		name = "Float",
		size = Vector3.new(3, 3, 3),
		cframe = CFrame.new(position.X, 1, position.Z),
		color = color,
		shape = "Ball",
	})
	float.Parent = model
	model.PrimaryPart = float
	local pole = makePart({
		name = "Pole",
		size = Vector3.new(0.4, 5, 0.4),
		cframe = CFrame.new(position.X, 4, position.Z),
		color = Color3.fromRGB(220, 220, 220),
	})
	pole.Parent = model
	local light = makePart({
		name = "Lamp",
		size = Vector3.new(0.9, 0.9, 0.9),
		cframe = CFrame.new(position.X, 6.8, position.Z),
		color = color,
		material = Enum.Material.Neon,
		shape = "Ball",
	})
	light.Parent = model
	local pointLight = Instance.new("PointLight")
	pointLight.Color = color
	pointLight.Range = 24
	pointLight.Parent = light
	return model
end

return ModelFactory
