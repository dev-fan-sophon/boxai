package service

import (
	"fmt"
	"strings"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
)

var videoModes = []string{"text", "frames", "references"}

// ResolveVideoCapabilities computes the contract shared by every channel that
// routing may select. An unclassified candidate makes the result unavailable.
func ResolveVideoCapabilities(groups []string, publicModel string) (map[string]dto.VideoModelCapabilities, error) {
	var candidates []model.Channel
	for _, group := range groups {
		channels, err := model.GetEnabledChannelsForGroupModel(group, publicModel)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, channels...)
	}
	if len(candidates) == 0 {
		return map[string]dto.VideoModelCapabilities{}, nil
	}

	result := make(map[string]dto.VideoModelCapabilities)
	seenChannels := map[int]bool{}
	first := true
	for _, channel := range candidates {
		if seenChannels[channel.Id] {
			continue
		}
		seenChannels[channel.Id] = true
		mapped, err := mappedVideoModel(channel.GetModelMapping(), publicModel)
		if err != nil {
			return map[string]dto.VideoModelCapabilities{}, nil
		}
		profiles := profilesForChannel(&channel, mapped)
		for _, mode := range videoModes {
			profile, ok := profiles[mode]
			if !ok {
				delete(result, mode)
				continue
			}
			if first {
				result[mode] = profile
				continue
			}
			if current, exists := result[mode]; exists {
				if merged, compatible := intersectVideoProfile(current, profile); compatible {
					result[mode] = merged
				} else {
					delete(result, mode)
				}
			}
		}
		first = false
	}
	return result, nil
}

func mappedVideoModel(mappingJSON, name string) (string, error) {
	if mappingJSON == "" || mappingJSON == "{}" {
		return name, nil
	}
	mapping := map[string]string{}
	if err := common.UnmarshalJsonStr(mappingJSON, &mapping); err != nil {
		return "", err
	}
	seen := map[string]bool{name: true}
	for {
		next, ok := mapping[name]
		if !ok || strings.TrimSpace(next) == "" || next == name {
			return name, nil
		}
		if seen[next] {
			return "", fmt.Errorf("model mapping cycle")
		}
		seen[next], name = true, next
	}
}

func profilesForChannel(channel *model.Channel, mappedModel string) map[string]dto.VideoModelCapabilities {
	if configured := channel.GetSetting().VideoCapabilities[mappedModel]; configured != nil {
		return configured
	}
	if (channel.Type == constant.ChannelTypeSora || channel.Type == constant.ChannelTypeDoubaoVideo) && isModeledSeedanceModel(mappedModel) {
		family, maxDuration, maxReferences := "seedance-2", 15, 9
		resolutions := []string{"480p", "720p", "1080p"}
		lower := strings.ToLower(mappedModel)
		if strings.Contains(lower, "2-5") || strings.Contains(lower, "2.5") {
			family, maxDuration, maxReferences = "seedance-2.5", 30, 30
		} else if strings.Contains(lower, "fast") || strings.Contains(lower, "mini") {
			family, resolutions = "seedance-2-fast", []string{"480p", "720p"}
		}
		base := dto.VideoModelCapabilities{Family: family, AspectRatios: []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"}, Resolutions: resolutions, ImageOnlyResolutions: []string{}, Durations: []int{4, 5, 6, 8, 10, 12, 15}, DurationRange: dto.VideoDurationRange{Min: 4, Max: maxDuration}, Defaults: dto.VideoDefaults{AspectRatio: "16:9", Resolution: "720p", Duration: 5}, SupportsAudioToggle: true, UsesVolcengineMetadata: true}
		if maxDuration == 30 {
			base.Durations = append(base.Durations, 20, 25, 30)
		}
		frames := base
		frames.SupportsLastFrame = true
		references := base
		references.MaxReferenceImages = maxReferences
		if family == "seedance-2.5" {
			frames.AspectRatios = []string{"adaptive"}
			frames.Defaults.AspectRatio = "adaptive"
		}
		return map[string]dto.VideoModelCapabilities{"text": base, "frames": frames, "references": references}
	}
	// Relay dispatch recognizes this exact model on compatibility channels too.
	if mappedModel != "grok-imagine-video" {
		return nil
	}
	p := dto.VideoModelCapabilities{Family: "xai", AspectRatios: []string{"16:9", "9:16"}, Resolutions: []string{"720p", "1080p"}, ImageOnlyResolutions: []string{"1080p"}, Durations: []int{3, 5, 8, 10, 15}, DurationRange: dto.VideoDurationRange{Min: 1, Max: 15}, Defaults: dto.VideoDefaults{AspectRatio: "16:9", Resolution: "720p", Duration: 5}}
	return map[string]dto.VideoModelCapabilities{"frames": p}
}

func isModeledSeedanceModel(name string) bool {
	for _, modeled := range []string{"seedance-2-0", "seedance-2-0-fast", "seedance-2-0-mini", "seedance-2-5", "dreamina-seedance-2-5", "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615", "doubao-seedance-2-5-260628", "cdance2.0-0611", "cdance2.0-fast-0611", "cdance2.0-mini-0611", "cdance2.5-0807"} {
		if strings.EqualFold(name, modeled) {
			return true
		}
	}
	return false
}

func isSeedanceCapabilityModel(modelName string) bool {
	name := strings.ToLower(modelName)
	return strings.Contains(name, "seedance-2") || strings.Contains(name, "seedance-2.") || strings.Contains(name, "cdance2")
}

func intersectVideoProfile(a, b dto.VideoModelCapabilities) (dto.VideoModelCapabilities, bool) {
	if a.Family != b.Family || a.RequiresImage != b.RequiresImage || a.UsesVolcengineMetadata != b.UsesVolcengineMetadata {
		return dto.VideoModelCapabilities{}, false
	}
	a.AspectRatios = intersectStrings(a.AspectRatios, b.AspectRatios)
	a.Resolutions = intersectStrings(a.Resolutions, b.Resolutions)
	a.ImageOnlyResolutions = unionStrings(a.ImageOnlyResolutions, b.ImageOnlyResolutions)
	a.Durations = intersectInts(a.Durations, b.Durations)
	a.DurationRange.Min = max(a.DurationRange.Min, b.DurationRange.Min)
	a.DurationRange.Max = min(a.DurationRange.Max, b.DurationRange.Max)
	a.Durations = filterDurationRange(a.Durations, a.DurationRange)
	a.MaxReferenceImages = min(a.MaxReferenceImages, b.MaxReferenceImages)
	a.SupportsLastFrame = a.SupportsLastFrame && b.SupportsLastFrame
	a.SupportsAudioToggle = a.SupportsAudioToggle && b.SupportsAudioToggle
	if len(a.AspectRatios) == 0 || len(a.Resolutions) == 0 || a.DurationRange.Min > a.DurationRange.Max {
		return dto.VideoModelCapabilities{}, false
	}
	if !stringIn(a.Defaults.AspectRatio, a.AspectRatios) {
		a.Defaults.AspectRatio = a.AspectRatios[0]
	}
	if !stringIn(a.Defaults.Resolution, a.Resolutions) {
		a.Defaults.Resolution = a.Resolutions[0]
	}
	if a.Defaults.Duration < a.DurationRange.Min || a.Defaults.Duration > a.DurationRange.Max {
		a.Defaults.Duration = a.DurationRange.Min
	}
	return a, true
}

func unionStrings(a, b []string) []string {
	out := append([]string{}, a...)
	for _, v := range b {
		if !stringIn(v, out) {
			out = append(out, v)
		}
	}
	return out
}
func filterDurationRange(values []int, r dto.VideoDurationRange) []int {
	out := []int{}
	for _, v := range values {
		if v >= r.Min && v <= r.Max {
			out = append(out, v)
		}
	}
	return out
}

func intersectStrings(a, b []string) []string {
	out := []string{}
	for _, v := range a {
		if stringIn(v, b) {
			out = append(out, v)
		}
	}
	return out
}
func stringIn(v string, values []string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}
func intersectInts(a, b []int) []int {
	out := []int{}
	for _, v := range a {
		for _, x := range b {
			if x == v {
				out = append(out, v)
				break
			}
		}
	}
	return out
}

// VideoProfileForSelectedChannel is used after mapping on every UI retry.
func VideoProfileForSelectedChannel(channelType int, setting dto.ChannelSettings, mappedModel, mode string) (dto.VideoModelCapabilities, bool) {
	ch := &model.Channel{Type: channelType}
	ch.SetSetting(setting)
	p, ok := profilesForChannel(ch, mappedModel)[mode]
	if ok {
		if p.AspectRatios == nil {
			p.AspectRatios = []string{}
		}
		if p.Resolutions == nil {
			p.Resolutions = []string{}
		}
		if p.ImageOnlyResolutions == nil {
			p.ImageOnlyResolutions = []string{}
		}
		if p.Durations == nil {
			p.Durations = []int{}
		}
	}
	return p, ok
}
