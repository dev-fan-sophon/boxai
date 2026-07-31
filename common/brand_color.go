package common

import (
	"math"
	"strconv"
)

// Brand label on a brand-colored fill when white would be too dim.
// Must stay in sync with web/default/src/lib/colors.ts (BRAND_DARK_FOREGROUND).
const BrandDarkForeground = "#0b1633"

// Fallback soft coral used when a dark-mode primary cannot be derived safely.
// Precomputed from the shipped light default #E05A3A via DeriveDarkBrandPrimary.
const DefaultBrandPrimaryDark = "#FF9072"

// BrandColorRelativeLuminance returns WCAG relative luminance for #RRGGBB.
func BrandColorRelativeLuminance(value string) float64 {
	rgb, err := strconv.ParseUint(value[1:], 16, 32)
	if err != nil {
		return 0
	}
	channels := []float64{
		float64((rgb>>16)&0xff) / 255,
		float64((rgb>>8)&0xff) / 255,
		float64(rgb&0xff) / 255,
	}
	for index, channel := range channels {
		if channel <= 0.04045 {
			channels[index] = channel / 12.92
		} else {
			channels[index] = math.Pow((channel+0.055)/1.055, 2.4)
		}
	}
	return 0.2126*channels[0] + 0.7152*channels[1] + 0.0722*channels[2]
}

// BrandPrimaryForeground picks white or the dark label for a brand fill.
// Mirrors brandPrimaryForeground in web/default/src/lib/colors.ts.
func BrandPrimaryForeground(color string) string {
	if !isHexRGB(color) {
		return "#ffffff"
	}
	luminance := BrandColorRelativeLuminance(color)
	whiteContrast := 1.05 / (luminance + 0.05)
	darkContrast := (luminance + 0.05) / (0.0114 + 0.05)
	if whiteContrast >= darkContrast {
		return "#ffffff"
	}
	return BrandDarkForeground
}

// IsAccessibleBrandPrimaryForLight validates a brand fill used on the light canvas.
func IsAccessibleBrandPrimaryForLight(color string) bool {
	return isAccessibleBrandPrimaryForScheme(color, true)
}

// IsAccessibleBrandPrimaryForDark validates a brand fill used on the dark canvas.
func IsAccessibleBrandPrimaryForDark(color string) bool {
	return isAccessibleBrandPrimaryForScheme(color, false)
}

// IsAccessibleBrandPrimary validates a single color against both canvases.
// Kept for callers that still need a dual-scheme check; light/dark primary
// options use the scheme-specific helpers instead.
func IsAccessibleBrandPrimary(color string) bool {
	return IsAccessibleBrandPrimaryForLight(color) && IsAccessibleBrandPrimaryForDark(color)
}

func isAccessibleBrandPrimaryForScheme(color string, light bool) bool {
	if !isHexRGB(color) {
		return false
	}
	luminance := BrandColorRelativeLuminance(color)
	whiteContrast := 1.05 / (luminance + 0.05)
	darkContrast := (luminance + 0.05) / (0.0114 + 0.05)
	foregroundContrast := math.Max(whiteContrast, darkContrast)
	if foregroundContrast < 4.5 {
		return false
	}
	if light {
		lightCanvasContrast := (0.947 + 0.05) / (luminance + 0.05)
		return lightCanvasContrast >= 3
	}
	darkCanvasContrast := (luminance + 0.05) / (0.006 + 0.05)
	return darkCanvasContrast >= 3
}

func isHexRGB(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	_, err := strconv.ParseUint(value[1:], 16, 32)
	return err == nil
}

type oklab struct {
	L, A, B float64
}

func srgbToLinear(c float64) float64 {
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func linearToSrgb(c float64) float64 {
	if c <= 0.0031308 {
		return 12.92 * c
	}
	return 1.055*math.Pow(c, 1.0/2.4) - 0.055
}

func hexToOklab(value string) (oklab, bool) {
	if !isHexRGB(value) {
		return oklab{}, false
	}
	rgb, _ := strconv.ParseUint(value[1:], 16, 32)
	r := srgbToLinear(float64((rgb>>16)&0xff) / 255)
	g := srgbToLinear(float64((rgb>>8)&0xff) / 255)
	b := srgbToLinear(float64(rgb&0xff) / 255)

	l := 0.4122214708*r + 0.5363325363*g + 0.0514459929*b
	m := 0.2119034982*r + 0.6806995451*g + 0.1073969566*b
	s := 0.0883024619*r + 0.2817188376*g + 0.6299787005*b

	l_ := math.Cbrt(l)
	m_ := math.Cbrt(m)
	s_ := math.Cbrt(s)

	return oklab{
		L: 0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
		A: 1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
		B: 0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_,
	}, true
}

func oklabToHex(lab oklab) string {
	l_ := lab.L + 0.3963377774*lab.A + 0.2158037573*lab.B
	m_ := lab.L - 0.1055613458*lab.A - 0.0638541728*lab.B
	s_ := lab.L - 0.0894841775*lab.A - 1.2914855480*lab.B

	l := l_ * l_ * l_
	m := m_ * m_ * m_
	s := s_ * s_ * s_

	r := linearToSrgb(+4.0767416621*l - 3.3077115913*m + 0.2309699292*s)
	g := linearToSrgb(-1.2684380046*l + 2.6097574011*m - 0.3413193965*s)
	b := linearToSrgb(-0.0041960863*l - 0.7034186147*m + 1.7076147010*s)

	return "#" + channelHex(r) + channelHex(g) + channelHex(b)
}

func channelHex(c float64) string {
	if c < 0 {
		c = 0
	}
	if c > 1 {
		c = 1
	}
	v := int(math.Round(c * 255))
	if v < 0 {
		v = 0
	}
	if v > 255 {
		v = 255
	}
	const hexdigits = "0123456789ABCDEF"
	return string([]byte{hexdigits[v>>4], hexdigits[v&0xf]})
}

// DeriveDarkBrandPrimary lifts and slightly desaturates a light-mode brand
// fill so solid CTAs stay readable on navy dark canvases without looking hot.
// Mirrors deriveDarkBrandPrimary in web/default/src/lib/colors.ts.
func DeriveDarkBrandPrimary(color string) string {
	lab, ok := hexToOklab(color)
	if !ok {
		return DefaultBrandPrimaryDark
	}

	// Target a soft mid-high lightness; keep hue, reduce chroma ~12%.
	targetL := lab.L*1.12 + 0.14
	if targetL < 0.64 {
		targetL = 0.64
	}
	if targetL > 0.78 {
		targetL = 0.78
	}
	lab.L = targetL
	lab.A *= 0.88
	lab.B *= 0.88

	hex := oklabToHex(lab)
	for i := 0; i < 10 && !IsAccessibleBrandPrimaryForDark(hex); i++ {
		lab.L = math.Min(0.86, lab.L+0.025)
		hex = oklabToHex(lab)
	}
	if !IsAccessibleBrandPrimaryForDark(hex) {
		return DefaultBrandPrimaryDark
	}
	return hex
}

// EffectiveDarkBrandPrimary returns the configured dark override when valid,
// otherwise a derived dark fill from the light seed.
func EffectiveDarkBrandPrimary(light, darkOverride string) string {
	if IsAccessibleBrandPrimaryForDark(darkOverride) {
		return darkOverride
	}
	if IsAccessibleBrandPrimaryForLight(light) || isHexRGB(light) {
		return DeriveDarkBrandPrimary(light)
	}
	return DefaultBrandPrimaryDark
}
