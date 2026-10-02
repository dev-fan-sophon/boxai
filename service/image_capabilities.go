package service

import (
	"strings"

	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
)

// ResolveImageCapabilities computes the image contract shared by every
// channel that routing may select for publicModel. It returns nil when no
// channel serves the model, a channel maps it to an unmodeled model, or the
// channels disagree on the model family.
func ResolveImageCapabilities(groups []string, publicModel string) (*dto.ImageModelCapabilities, error) {
	var candidates []model.Channel
	for _, group := range groups {
		channels, err := model.GetEnabledChannelsForGroupModel(group, publicModel)
		if err != nil {
			return nil, err
		}
		candidates = append(candidates, channels...)
	}

	var result *dto.ImageModelCapabilities
	seenChannels := map[int]bool{}
	for _, channel := range candidates {
		if seenChannels[channel.Id] {
			continue
		}
		seenChannels[channel.Id] = true
		mapped, err := mappedVideoModel(channel.GetModelMapping(), publicModel)
		if err != nil {
			return nil, nil
		}
		profile := relaycommon.DefaultImageCapabilities(mapped)
		if profile == nil {
			return nil, nil
		}
		if strings.TrimSpace(channel.GetSetting().ImageGenerationViaResponsesModel) != "" {
			// The Responses image_generation tool returns one image per call.
			profile.MaxN = 1
		}
		if channel.GetSetting().ImageIgnoresSizeOptions {
			profile.AspectRatios = []string{}
			profile.Resolutions = []string{}
			profile.Defaults.AspectRatio = ""
			profile.Defaults.Resolution = ""
		}
		if result == nil {
			result = profile
			continue
		}
		merged, compatible := intersectImageProfile(*result, *profile)
		if !compatible {
			return nil, nil
		}
		result = &merged
	}
	return result, nil
}

func intersectImageProfile(a, b dto.ImageModelCapabilities) (dto.ImageModelCapabilities, bool) {
	if a.Family != b.Family || a.SizeMode != b.SizeMode {
		return dto.ImageModelCapabilities{}, false
	}
	a.Modes = intersectStrings(a.Modes, b.Modes)
	a.Sizes = intersectStrings(a.Sizes, b.Sizes)
	a.AspectRatios = intersectStrings(a.AspectRatios, b.AspectRatios)
	a.Resolutions = intersectStrings(a.Resolutions, b.Resolutions)
	a.Qualities = intersectStrings(a.Qualities, b.Qualities)
	a.Backgrounds = intersectStrings(a.Backgrounds, b.Backgrounds)
	a.OutputFormats = intersectStrings(a.OutputFormats, b.OutputFormats)
	a.Moderation = intersectStrings(a.Moderation, b.Moderation)
	a.MaxReferenceImages = min(a.MaxReferenceImages, b.MaxReferenceImages)
	a.MaxN = min(a.MaxN, b.MaxN)
	a.SupportsMask = a.SupportsMask && b.SupportsMask
	if len(a.Modes) == 0 || a.MaxN < 1 {
		return dto.ImageModelCapabilities{}, false
	}
	a.Defaults.Size = defaultInList(a.Defaults.Size, a.Sizes)
	a.Defaults.AspectRatio = defaultInList(a.Defaults.AspectRatio, a.AspectRatios)
	a.Defaults.Resolution = defaultInList(a.Defaults.Resolution, a.Resolutions)
	a.Defaults.Quality = defaultInList(a.Defaults.Quality, a.Qualities)
	a.Defaults.Background = defaultInList(a.Defaults.Background, a.Backgrounds)
	a.Defaults.OutputFormat = defaultInList(a.Defaults.OutputFormat, a.OutputFormats)
	return a, true
}

func defaultInList(value string, options []string) string {
	if stringIn(value, options) {
		return value
	}
	if len(options) == 0 {
		return ""
	}
	return options[0]
}
