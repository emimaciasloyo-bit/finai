--!strict
-- Tiny programmatic UI kit. Mobile-first: every interactive element is at
-- least 44x44 pt equivalent, text is TextScaled, and screens are single-column
-- cards that fit phone aspect ratios. All UI in the game is built through
-- these helpers so a restyle is a one-file change.

local Theme = {}

Theme.Colors = {
	Background = Color3.fromRGB(24, 32, 44),
	Panel = Color3.fromRGB(34, 44, 60),
	PanelLight = Color3.fromRGB(46, 58, 78),
	Accent = Color3.fromRGB(64, 156, 255),
	Success = Color3.fromRGB(72, 190, 120),
	Danger = Color3.fromRGB(230, 90, 90),
	Gold = Color3.fromRGB(240, 195, 80),
	Pearl = Color3.fromRGB(220, 225, 240),
	Text = Color3.fromRGB(235, 240, 248),
	TextDim = Color3.fromRGB(160, 172, 190),
}

Theme.Font = Enum.Font.GothamMedium
Theme.FontBold = Enum.Font.GothamBold

function Theme.corner(parent: Instance, radius: number?)
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, radius or 10)
	corner.Parent = parent
end

function Theme.padding(parent: Instance, pixels: number)
	local pad = Instance.new("UIPadding")
	pad.PaddingTop = UDim.new(0, pixels)
	pad.PaddingBottom = UDim.new(0, pixels)
	pad.PaddingLeft = UDim.new(0, pixels)
	pad.PaddingRight = UDim.new(0, pixels)
	pad.Parent = parent
end

function Theme.list(parent: Instance, gap: number?): UIListLayout
	local layout = Instance.new("UIListLayout")
	layout.Padding = UDim.new(0, gap or 8)
	layout.SortOrder = Enum.SortOrder.LayoutOrder
	layout.Parent = parent
	return layout
end

function Theme.label(props: {
	parent: Instance,
	text: string,
	size: UDim2,
	position: UDim2?,
	textColor: Color3?,
	bold: boolean?,
	alignX: Enum.TextXAlignment?,
	layoutOrder: number?,
}): TextLabel
	local labelInstance = Instance.new("TextLabel")
	labelInstance.BackgroundTransparency = 1
	labelInstance.Size = props.size
	labelInstance.Position = props.position or UDim2.new()
	labelInstance.Text = props.text
	labelInstance.TextColor3 = props.textColor or Theme.Colors.Text
	labelInstance.Font = if props.bold then Theme.FontBold else Theme.Font
	labelInstance.TextScaled = true
	labelInstance.TextXAlignment = props.alignX or Enum.TextXAlignment.Left
	labelInstance.LayoutOrder = props.layoutOrder or 0
	local sizeConstraint = Instance.new("UITextSizeConstraint")
	sizeConstraint.MaxTextSize = 22
	sizeConstraint.Parent = labelInstance
	labelInstance.Parent = props.parent
	return labelInstance
end

-- Big tap-friendly button. Minimum height enforced for touch.
function Theme.button(props: {
	parent: Instance,
	text: string,
	size: UDim2?,
	position: UDim2?,
	color: Color3?,
	layoutOrder: number?,
	onClick: () -> (),
}): TextButton
	local buttonInstance = Instance.new("TextButton")
	buttonInstance.Size = props.size or UDim2.new(1, 0, 0, 48)
	buttonInstance.Position = props.position or UDim2.new()
	buttonInstance.BackgroundColor3 = props.color or Theme.Colors.Accent
	buttonInstance.Text = props.text
	buttonInstance.TextColor3 = Theme.Colors.Text
	buttonInstance.Font = Theme.FontBold
	buttonInstance.TextScaled = true
	buttonInstance.AutoButtonColor = true
	buttonInstance.LayoutOrder = props.layoutOrder or 0
	local sizeConstraint = Instance.new("UITextSizeConstraint")
	sizeConstraint.MaxTextSize = 20
	sizeConstraint.Parent = buttonInstance
	local minSize = Instance.new("UISizeConstraint")
	minSize.MinSize = Vector2.new(44, 44)
	minSize.Parent = buttonInstance
	Theme.corner(buttonInstance)
	buttonInstance.Activated:Connect(props.onClick)
	buttonInstance.Parent = props.parent
	return buttonInstance
end

-- Full-screen modal card with a title bar and close button.
-- Returns the content frame (with a UIListLayout) to fill.
function Theme.modal(props: {
	parent: Instance,
	name: string,
	title: string,
	onClose: () -> (),
}): (Frame, ScrollingFrame)
	local overlay = Instance.new("Frame")
	overlay.Name = props.name
	overlay.Size = UDim2.fromScale(1, 1)
	overlay.BackgroundColor3 = Color3.new(0, 0, 0)
	overlay.BackgroundTransparency = 0.45
	overlay.Visible = false
	overlay.ZIndex = 10
	overlay.Parent = props.parent

	local card = Instance.new("Frame")
	card.Name = "Card"
	card.AnchorPoint = Vector2.new(0.5, 0.5)
	card.Position = UDim2.fromScale(0.5, 0.5)
	-- Phone-friendly: near-full-screen on small viewports, capped on desktop.
	card.Size = UDim2.fromScale(0.92, 0.85)
	card.BackgroundColor3 = Theme.Colors.Background
	card.ZIndex = 11
	local maxSize = Instance.new("UISizeConstraint")
	maxSize.MaxSize = Vector2.new(560, 720)
	maxSize.Parent = card
	Theme.corner(card, 14)
	card.Parent = overlay

	local titleBar = Instance.new("Frame")
	titleBar.Size = UDim2.new(1, 0, 0, 52)
	titleBar.BackgroundTransparency = 1
	titleBar.ZIndex = 12
	titleBar.Parent = card
	Theme.padding(titleBar, 8)

	local titleLabel = Theme.label({
		parent = titleBar,
		text = props.title,
		size = UDim2.new(1, -56, 1, 0),
		bold = true,
	})
	titleLabel.ZIndex = 12

	local closeButton = Instance.new("TextButton")
	closeButton.AnchorPoint = Vector2.new(1, 0)
	closeButton.Position = UDim2.new(1, 0, 0, 0)
	closeButton.Size = UDim2.fromOffset(44, 44)
	closeButton.BackgroundColor3 = Theme.Colors.Danger
	closeButton.Text = "X"
	closeButton.TextColor3 = Theme.Colors.Text
	closeButton.Font = Theme.FontBold
	closeButton.TextSize = 20
	closeButton.ZIndex = 12
	Theme.corner(closeButton)
	closeButton.Activated:Connect(props.onClose)
	closeButton.Parent = titleBar

	local content = Instance.new("ScrollingFrame")
	content.Name = "Content"
	content.Position = UDim2.new(0, 0, 0, 56)
	content.Size = UDim2.new(1, 0, 1, -56)
	content.BackgroundTransparency = 1
	content.BorderSizePixel = 0
	content.ScrollBarThickness = 6
	content.AutomaticCanvasSize = Enum.AutomaticSize.Y
	content.CanvasSize = UDim2.new()
	content.ZIndex = 11
	content.Parent = card
	Theme.padding(content, 12)
	Theme.list(content, 8)

	return overlay, content
end

-- Simple row card used inside modals (shop entries, dex entries...)
function Theme.rowCard(parent: Instance, heightPixels: number?, layoutOrder: number?): Frame
	local row = Instance.new("Frame")
	row.Size = UDim2.new(1, 0, 0, heightPixels or 64)
	row.BackgroundColor3 = Theme.Colors.Panel
	row.LayoutOrder = layoutOrder or 0
	row.ZIndex = 11
	Theme.corner(row)
	Theme.padding(row, 8)
	row.Parent = parent
	return row
end

return Theme
