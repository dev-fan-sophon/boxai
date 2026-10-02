package dto

// ImageModelCapabilities is the per-model contract the image studio renders
// from. Every list is also enforced by the relay validator, so a control shown
// here is always accepted by the gateway.
type ImageModelCapabilities struct {
	// Family is gpt-image, xai or gemini.
	Family string `json:"family"`
	// Modes lists generate and/or edit (edit = reference images supplied).
	Modes              []string `json:"modes"`
	MaxReferenceImages int      `json:"maxReferenceImages"`
	// SizeMode is "pixels" (WxH sizes) or "aspect" (aspect ratio + resolution).
	SizeMode      string             `json:"sizeMode"`
	Sizes         []string           `json:"sizes"`
	AspectRatios  []string           `json:"aspectRatios"`
	Resolutions   []string           `json:"resolutions"`
	Qualities     []string           `json:"qualities"`
	MaxN          int                `json:"maxN"`
	SupportsMask  bool               `json:"supportsMask"`
	Backgrounds   []string           `json:"backgrounds"`
	OutputFormats []string           `json:"outputFormats"`
	Moderation    []string           `json:"moderation"`
	Defaults      ImageModelDefaults `json:"defaults"`
}

type ImageModelDefaults struct {
	Size         string `json:"size,omitempty"`
	AspectRatio  string `json:"aspectRatio,omitempty"`
	Resolution   string `json:"resolution,omitempty"`
	Quality      string `json:"quality,omitempty"`
	Background   string `json:"background,omitempty"`
	OutputFormat string `json:"outputFormat,omitempty"`
}
