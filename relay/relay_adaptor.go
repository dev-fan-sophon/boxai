package relay

import (
	"strconv"

	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/relay/channel"
	"github.com/dev-fan-sophon/boxai/relay/channel/advancedcustom"
	"github.com/dev-fan-sophon/boxai/relay/channel/ali"
	"github.com/dev-fan-sophon/boxai/relay/channel/aws"
	"github.com/dev-fan-sophon/boxai/relay/channel/baidu"
	"github.com/dev-fan-sophon/boxai/relay/channel/baidu_v2"
	"github.com/dev-fan-sophon/boxai/relay/channel/claude"
	"github.com/dev-fan-sophon/boxai/relay/channel/cloudflare"
	"github.com/dev-fan-sophon/boxai/relay/channel/codex"
	"github.com/dev-fan-sophon/boxai/relay/channel/cohere"
	"github.com/dev-fan-sophon/boxai/relay/channel/coze"
	"github.com/dev-fan-sophon/boxai/relay/channel/deepseek"
	"github.com/dev-fan-sophon/boxai/relay/channel/dify"
	"github.com/dev-fan-sophon/boxai/relay/channel/gemini"
	"github.com/dev-fan-sophon/boxai/relay/channel/jimeng"
	"github.com/dev-fan-sophon/boxai/relay/channel/jina"
	"github.com/dev-fan-sophon/boxai/relay/channel/minimax"
	"github.com/dev-fan-sophon/boxai/relay/channel/mistral"
	"github.com/dev-fan-sophon/boxai/relay/channel/mokaai"
	"github.com/dev-fan-sophon/boxai/relay/channel/moonshot"
	"github.com/dev-fan-sophon/boxai/relay/channel/newapi"
	"github.com/dev-fan-sophon/boxai/relay/channel/ollama"
	"github.com/dev-fan-sophon/boxai/relay/channel/openai"
	"github.com/dev-fan-sophon/boxai/relay/channel/palm"
	"github.com/dev-fan-sophon/boxai/relay/channel/perplexity"
	"github.com/dev-fan-sophon/boxai/relay/channel/replicate"
	"github.com/dev-fan-sophon/boxai/relay/channel/siliconflow"
	"github.com/dev-fan-sophon/boxai/relay/channel/sub2api"
	"github.com/dev-fan-sophon/boxai/relay/channel/submodel"
	taskali "github.com/dev-fan-sophon/boxai/relay/channel/task/ali"
	taskdoubao "github.com/dev-fan-sophon/boxai/relay/channel/task/doubao"
	taskGemini "github.com/dev-fan-sophon/boxai/relay/channel/task/gemini"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/hailuo"
	taskjimeng "github.com/dev-fan-sophon/boxai/relay/channel/task/jimeng"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/kling"
	tasksora "github.com/dev-fan-sophon/boxai/relay/channel/task/sora"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/suno"
	taskvertex "github.com/dev-fan-sophon/boxai/relay/channel/task/vertex"
	taskVidu "github.com/dev-fan-sophon/boxai/relay/channel/task/vidu"
	taskxai "github.com/dev-fan-sophon/boxai/relay/channel/task/xai"
	"github.com/dev-fan-sophon/boxai/relay/channel/tencent"
	"github.com/dev-fan-sophon/boxai/relay/channel/vertex"
	"github.com/dev-fan-sophon/boxai/relay/channel/volcengine"
	"github.com/dev-fan-sophon/boxai/relay/channel/xai"
	"github.com/dev-fan-sophon/boxai/relay/channel/xunfei"
	"github.com/dev-fan-sophon/boxai/relay/channel/zhipu"
	"github.com/dev-fan-sophon/boxai/relay/channel/zhipu_4v"
	"github.com/gin-gonic/gin"
)

func GetAdaptor(apiType int) channel.Adaptor {
	switch apiType {
	case constant.APITypeAli:
		return &ali.Adaptor{}
	case constant.APITypeAnthropic:
		return &claude.Adaptor{}
	case constant.APITypeBaidu:
		return &baidu.Adaptor{}
	case constant.APITypeGemini:
		return &gemini.Adaptor{}
	case constant.APITypeOpenAI:
		return &openai.Adaptor{}
	case constant.APITypePaLM:
		return &palm.Adaptor{}
	case constant.APITypeTencent:
		return &tencent.DispatchAdaptor{}
	case constant.APITypeXunfei:
		return &xunfei.Adaptor{}
	case constant.APITypeZhipu:
		return &zhipu.Adaptor{}
	case constant.APITypeZhipuV4:
		return &zhipu_4v.Adaptor{}
	case constant.APITypeOllama:
		return &ollama.Adaptor{}
	case constant.APITypePerplexity:
		return &perplexity.Adaptor{}
	case constant.APITypeAws:
		return &aws.Adaptor{}
	case constant.APITypeCohere:
		return &cohere.Adaptor{}
	case constant.APITypeDify:
		return &dify.Adaptor{}
	case constant.APITypeJina:
		return &jina.Adaptor{}
	case constant.APITypeCloudflare:
		return &cloudflare.Adaptor{}
	case constant.APITypeSiliconFlow:
		return &siliconflow.Adaptor{}
	case constant.APITypeVertexAi:
		return &vertex.Adaptor{}
	case constant.APITypeMistral:
		return &mistral.Adaptor{}
	case constant.APITypeDeepSeek:
		return &deepseek.Adaptor{}
	case constant.APITypeMokaAI:
		return &mokaai.Adaptor{}
	case constant.APITypeVolcEngine:
		return &volcengine.Adaptor{}
	case constant.APITypeBaiduV2:
		return &baidu_v2.Adaptor{}
	case constant.APITypeOpenRouter:
		return &openai.Adaptor{}
	case constant.APITypeXinference:
		return &openai.Adaptor{}
	case constant.APITypeXai:
		return &xai.Adaptor{}
	case constant.APITypeCoze:
		return &coze.Adaptor{}
	case constant.APITypeJimeng:
		return &jimeng.Adaptor{}
	case constant.APITypeMoonshot:
		return &moonshot.Adaptor{} // Moonshot uses Claude API
	case constant.APITypeSubmodel:
		return &submodel.Adaptor{}
	case constant.APITypeMiniMax:
		return &minimax.Adaptor{}
	case constant.APITypeReplicate:
		return &replicate.Adaptor{}
	case constant.APITypeCodex:
		return &codex.Adaptor{}
	case constant.APITypeAdvancedCustom:
		return &advancedcustom.Adaptor{}
	case constant.APITypeSub2API:
		return &sub2api.Adaptor{}
	case constant.APITypeNewAPI:
		return &newapi.Adaptor{}
	}
	return nil
}

func GetTaskPlatform(c *gin.Context) constant.TaskPlatform {
	channelType := c.GetInt("channel_type")
	if channelType > 0 {
		return constant.TaskPlatform(strconv.Itoa(channelType))
	}
	return constant.TaskPlatform(c.GetString("platform"))
}

func GetTaskAdaptor(platform constant.TaskPlatform) channel.TaskAdaptor {
	switch platform {
	//case constant.APITypeAIProxyLibrary:
	//	return &aiproxy.Adaptor{}
	case constant.TaskPlatformSuno:
		return &suno.TaskAdaptor{}
	}
	if channelType, err := strconv.ParseInt(string(platform), 10, 64); err == nil {
		switch channelType {
		case constant.ChannelTypeAli:
			return &taskali.TaskAdaptor{}
		case constant.ChannelTypeKling:
			return &kling.TaskAdaptor{}
		case constant.ChannelTypeJimeng:
			return &taskjimeng.TaskAdaptor{}
		case constant.ChannelTypeVertexAi:
			return &taskvertex.TaskAdaptor{}
		case constant.ChannelTypeVidu:
			return &taskVidu.TaskAdaptor{}
		case constant.ChannelTypeDoubaoVideo, constant.ChannelTypeVolcEngine:
			return &taskdoubao.TaskAdaptor{}
		case constant.ChannelTypeSora, constant.ChannelTypeOpenAI:
			return &tasksora.TaskAdaptor{}
		case constant.ChannelTypeGemini:
			return &taskGemini.TaskAdaptor{}
		case constant.ChannelTypeMiniMax:
			return &hailuo.TaskAdaptor{}
		case constant.ChannelTypeXai:
			return &taskxai.TaskAdaptor{}
		}
	}
	return nil
}
