package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay"
	"github.com/dev-fan-sophon/boxai/relay/channel/ai360"
	"github.com/dev-fan-sophon/boxai/relay/channel/lingyiwanwu"
	"github.com/dev-fan-sophon/boxai/relay/channel/minimax"
	"github.com/dev-fan-sophon/boxai/relay/channel/moonshot"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/setting/operation_setting"
	"github.com/dev-fan-sophon/boxai/setting/ratio_setting"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// https://platform.openai.com/docs/api-reference/models/list

var openAIModels []dto.OpenAIModels
var openAIModelsMap map[string]dto.OpenAIModels
var channelId2Models map[int][]string

func init() {
	// https://platform.openai.com/docs/models/model-endpoint-compatibility
	for i := 0; i < constant.APITypeDummy; i++ {
		if i == constant.APITypeAIProxyLibrary {
			continue
		}
		adaptor := relay.GetAdaptor(i)
		channelName := adaptor.GetChannelName()
		modelNames := adaptor.GetModelList()
		for _, modelName := range modelNames {
			openAIModels = append(openAIModels, dto.OpenAIModels{
				Id:      modelName,
				Object:  "model",
				Created: 1626777600,
				OwnedBy: channelName,
			})
		}
	}
	for _, modelName := range ai360.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: ai360.ChannelName,
		})
	}
	for _, modelName := range moonshot.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: moonshot.ChannelName,
		})
	}
	for _, modelName := range lingyiwanwu.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: lingyiwanwu.ChannelName,
		})
	}
	for _, modelName := range minimax.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: minimax.ChannelName,
		})
	}
	for modelName, _ := range constant.MidjourneyModel2Action {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: "midjourney",
		})
	}
	openAIModelsMap = make(map[string]dto.OpenAIModels)
	for _, aiModel := range openAIModels {
		openAIModelsMap[aiModel.Id] = aiModel
	}
	channelId2Models = make(map[int][]string)
	for i := 1; i <= constant.ChannelTypeDummy; i++ {
		apiType, success := common.ChannelType2APIType(i)
		if !success || apiType == constant.APITypeAIProxyLibrary {
			continue
		}
		meta := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: i,
		}}
		adaptor := relay.GetAdaptor(apiType)
		adaptor.Init(meta)
		channelId2Models[i] = adaptor.GetModelList()
	}
	openAIModels = lo.UniqBy(openAIModels, func(m dto.OpenAIModels) string {
		return m.Id
	})
}

func channelOwnerName(channelType int) string {
	apiType, success := common.ChannelType2APIType(channelType)
	if !success {
		return strings.ToLower(constant.GetChannelTypeName(channelType))
	}
	adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return strings.ToLower(constant.GetChannelTypeName(channelType))
	}
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: channelType,
	}})
	if name := strings.TrimSpace(adaptor.GetChannelName()); name != "" {
		return name
	}
	return strings.ToLower(constant.GetChannelTypeName(channelType))
}

func getPreferredModelOwners(modelNames []string, groups []string) map[string]string {
	channelTypes, err := model.GetPreferredModelOwnerChannelTypes(modelNames, groups)
	if err != nil {
		common.SysLog(fmt.Sprintf("GetPreferredModelOwnerChannelTypes error: %v", err))
		return map[string]string{}
	}

	ownerByChannelType := make(map[int]string)
	owners := make(map[string]string, len(channelTypes))
	for modelName, channelType := range channelTypes {
		owner, ok := ownerByChannelType[channelType]
		if !ok {
			owner = channelOwnerName(channelType)
			ownerByChannelType[channelType] = owner
		}
		if owner != "" {
			owners[modelName] = owner
		}
	}
	return owners
}

func buildOpenAIModel(modelName string, ownerByModel map[string]string, pricingByName map[string]model.Pricing) dto.OpenAIModels {
	var oaiModel dto.OpenAIModels
	if staticModel, ok := openAIModelsMap[modelName]; ok {
		oaiModel = dto.OpenAIModels{
			Id:      staticModel.Id,
			Object:  staticModel.Object,
			Created: staticModel.Created,
			OwnedBy: staticModel.OwnedBy,
		}
	} else {
		oaiModel = dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: "custom",
		}
	}
	if owner, ok := ownerByModel[modelName]; ok && owner != "" {
		oaiModel.OwnedBy = owner
	}
	oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(modelName)
	if pricing, ok := pricingByName[modelName]; ok {
		applyPricingCatalogToOpenAIModel(&oaiModel, pricing)
	}
	return oaiModel
}

func applyPricingCatalogToOpenAIModel(oaiModel *dto.OpenAIModels, pricing model.Pricing) {
	oaiModel.DisplayName = pricing.DisplayName
	oaiModel.Description = pricing.Description
	oaiModel.SupportedReasoning = pricing.SupportedReasoning
	oaiModel.ReasoningEfforts = append([]string(nil), pricing.ReasoningEfforts...)
	oaiModel.ReasoningOptions = copyReasoningOptions(pricing.ReasoningOptions)
	oaiModel.ContextLength = pricing.ContextLength
	oaiModel.MaxInputTokens = pricing.MaxInputTokens
	oaiModel.MaxOutputTokens = pricing.MaxOutputTokens
	oaiModel.KnowledgeCutoff = pricing.KnowledgeCutoff
	oaiModel.ReleaseDate = pricing.ReleaseDate
	oaiModel.LastUpdated = pricing.LastUpdated
	oaiModel.InputModalities = append([]string(nil), pricing.InputModalities...)
	oaiModel.OutputModalities = append([]string(nil), pricing.OutputModalities...)
	oaiModel.Capabilities = append([]string(nil), pricing.Capabilities...)
	oaiModel.Temperature = pricing.Temperature
	oaiModel.Attachment = pricing.Attachment
	oaiModel.OpenWeights = pricing.OpenWeights
	oaiModel.Interleaved = pricing.Interleaved
	for _, capability := range pricing.Capabilities {
		if strings.HasPrefix(capability, "family:") {
			oaiModel.Family = strings.TrimPrefix(capability, "family:")
			break
		}
	}
	if oaiModel.Family == "" {
		for _, tag := range strings.Split(pricing.Tags, ",") {
			tag = strings.TrimSpace(tag)
			if strings.HasPrefix(tag, "family:") {
				oaiModel.Family = strings.TrimPrefix(tag, "family:")
				break
			}
		}
	}
}

func copyReasoningOptions(options []model.ReasoningOption) []dto.ReasoningOption {
	if len(options) == 0 {
		return nil
	}
	copied := make([]dto.ReasoningOption, len(options))
	for i, option := range options {
		copied[i] = dto.ReasoningOption{
			Type:   option.Type,
			Values: append([]string(nil), option.Values...),
			Min:    option.Min,
			Max:    option.Max,
		}
	}
	return copied
}

func catalogPricingByName(pricings []model.Pricing) map[string]model.Pricing {
	byName := make(map[string]model.Pricing, len(pricings))
	for _, pricing := range pricings {
		byName[pricing.ModelName] = pricing
	}
	return byName
}

type modelListGroups struct {
	userGroup   string
	tokenGroup  string
	ownerGroups []string
}

func getModelListGroups(c *gin.Context) (modelListGroups, error) {
	tokenGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if userGroup == "" && (tokenGroup == "" || tokenGroup == "auto") {
		var err error
		userGroup, err = model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			return modelListGroups{}, err
		}
	}

	if tokenGroup == "auto" {
		return modelListGroups{
			userGroup:   userGroup,
			tokenGroup:  tokenGroup,
			ownerGroups: service.GetRequestAutoGroups(c, userGroup),
		}, nil
	}

	group := userGroup
	if tokenGroup != "" {
		group = tokenGroup
	}
	return modelListGroups{
		userGroup:   userGroup,
		tokenGroup:  tokenGroup,
		ownerGroups: []string{group},
	}, nil
}

// accountModelNames resolves the models the caller's account and token may
// actually use, honouring the token's group and per-token model limit.
//
// Any endpoint that answers "what can this account run" must go through here
// rather than reading group models directly, or it will hand out models the
// token is not allowed to call.
func accountModelNames(c *gin.Context) ([]string, modelListGroups, error) {
	acceptUnsetRatioModel := operation_setting.SelfUseModeEnabled
	if !acceptUnsetRatioModel {
		userId := c.GetInt("id")
		if userId > 0 {
			userSettings, _ := model.GetUserSetting(userId, false)
			if userSettings.AcceptUnsetRatioModel {
				acceptUnsetRatioModel = true
			}
		}
	}

	userModelNames := make([]string, 0)
	groups, err := getModelListGroups(c)
	if err != nil {
		return nil, modelListGroups{}, err
	}
	ownerGroups := groups.ownerGroups
	modelLimitEnable := common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled)
	var tokenModelLimit map[string]bool
	if modelLimitEnable {
		s, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
		if ok {
			tokenModelLimit, _ = s.(map[string]bool)
		}
		if tokenModelLimit == nil {
			tokenModelLimit = map[string]bool{}
		}
	}
	models := service.GetGroupsEnabledModels(ownerGroups)
	for _, modelName := range models {
		if modelLimitEnable {
			matchingName := ratio_setting.FormatMatchingModelName(modelName)
			if !tokenModelLimit[modelName] && !tokenModelLimit[matchingName] {
				continue
			}
		}
		if !acceptUnsetRatioModel && !helper.HasModelBillingConfig(modelName) {
			continue
		}
		userModelNames = append(userModelNames, modelName)
	}

	return userModelNames, groups, nil
}

func ListModels(c *gin.Context, modelType int) {
	userModelNames, groups, err := accountModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "get user group failed",
		})
		return
	}
	ownerGroups := groups.ownerGroups

	ownerByModel := map[string]string{}
	if len(ownerGroups) > 0 {
		ownerByModel = getPreferredModelOwners(userModelNames, ownerGroups)
	}
	pricingByName := catalogPricingByName(model.GetPricing())
	userOpenAiModels := make([]dto.OpenAIModels, 0, len(userModelNames))
	for _, modelName := range userModelNames {
		userOpenAiModels = append(userOpenAiModels, buildOpenAIModel(modelName, ownerByModel, pricingByName))
	}

	switch modelType {
	case constant.ChannelTypeAnthropic:
		useranthropicModels := make([]dto.AnthropicModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			useranthropicModels[i] = dto.AnthropicModel{
				ID:          model.Id,
				CreatedAt:   time.Unix(int64(model.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: model.Id,
				Type:        "model",
			}
		}
		firstID := ""
		lastID := ""
		if len(useranthropicModels) > 0 {
			firstID = useranthropicModels[0].ID
			lastID = useranthropicModels[len(useranthropicModels)-1].ID
		}
		c.JSON(200, gin.H{
			"data":     useranthropicModels,
			"first_id": firstID,
			"has_more": false,
			"last_id":  lastID,
		})
	case constant.ChannelTypeGemini:
		userGeminiModels := make([]dto.GeminiModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			userGeminiModels[i] = dto.GeminiModel{
				Name:        model.Id,
				DisplayName: model.Id,
			}
		}
		c.JSON(200, gin.H{
			"models":        userGeminiModels,
			"nextPageToken": nil,
		})
	default:
		c.JSON(200, gin.H{
			"success": true,
			"data":    userOpenAiModels,
			"object":  "list",
		})
	}
}

func ChannelListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    openAIModels,
	})
}

func DashboardListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    channelId2Models,
	})
}

func EnabledListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    model.GetEnabledModels(),
	})
}

func RetrieveModel(c *gin.Context, modelType int) {
	modelId := c.Param("model")
	userModelNames, groups, err := accountModelNames(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"error": types.OpenAIError{
				Message: "get user group failed",
				Type:    "invalid_request_error",
				Param:   "model",
				Code:    "model_not_found",
			},
		})
		return
	}
	allowed := false
	for _, name := range userModelNames {
		if name == modelId {
			allowed = true
			break
		}
	}
	if !allowed {
		c.JSON(200, gin.H{
			"error": types.OpenAIError{
				Message: fmt.Sprintf("The model '%s' does not exist", modelId),
				Type:    "invalid_request_error",
				Param:   "model",
				Code:    "model_not_found",
			},
		})
		return
	}

	ownerByModel := map[string]string{}
	if len(groups.ownerGroups) > 0 {
		ownerByModel = getPreferredModelOwners([]string{modelId}, groups.ownerGroups)
	}
	aiModel := buildOpenAIModel(modelId, ownerByModel, catalogPricingByName(model.GetPricing()))
	switch modelType {
	case constant.ChannelTypeAnthropic:
		c.JSON(200, dto.AnthropicModel{
			ID:          aiModel.Id,
			CreatedAt:   time.Unix(int64(aiModel.Created), 0).UTC().Format(time.RFC3339),
			DisplayName: firstNonEmpty(aiModel.DisplayName, aiModel.Id),
			Type:        "model",
		})
	case constant.ChannelTypeGemini:
		c.JSON(200, dto.GeminiModel{
			Name:             aiModel.Id,
			DisplayName:      firstNonEmpty(aiModel.DisplayName, aiModel.Id),
			Description:      aiModel.Description,
			InputTokenLimit:  aiModel.ContextLength,
			OutputTokenLimit: aiModel.MaxOutputTokens,
			Thinking:         aiModel.SupportedReasoning,
		})
	default:
		c.JSON(200, aiModel)
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
