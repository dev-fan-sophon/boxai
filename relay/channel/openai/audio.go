package openai

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/relay/helper"
	"github.com/dev-fan-sophon/boxai/service"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
)

func OpenaiTTSHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) *dto.Usage {
	// the status code has been judged before, if there is a body reading failure,
	// it should be regarded as a non-recoverable error, so it should not return err for external retry.
	// Analogous to nginx's load balancing, it will only retry if it can't be requested or
	// if the upstream returns a specific status code, once the upstream has already written the header,
	// the subsequent failure of the response body should be regarded as a non-recoverable error,
	// and can be terminated directly.
	defer service.CloseResponseBodyGracefully(resp)
	usage := &dto.Usage{}
	usage.PromptTokens = info.GetEstimatePromptTokens()
	usage.TotalTokens = info.GetEstimatePromptTokens()
	for k, v := range resp.Header {
		if !service.ShouldCopyUpstreamHeader(c, k, v) {
			continue
		}
		c.Writer.Header().Set(k, v[0])
	}
	c.Writer.WriteHeader(resp.StatusCode)

	if info.IsStream {
		helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
			if service.SundaySearch(data, "usage") {
				var simpleResponse dto.SimpleResponse
				if err := common.Unmarshal([]byte(data), &simpleResponse); err != nil {
					logger.LogError(c, err.Error())
					sr.Error(err)
				} else if simpleResponse.Usage.TotalTokens != 0 {
					usage.PromptTokens = simpleResponse.Usage.InputTokens
					usage.CompletionTokens = simpleResponse.OutputTokens
					usage.TotalTokens = simpleResponse.TotalTokens
				}
			}
			if err := helper.StringData(c, data); err != nil {
				sr.Error(err)
			}
		})
	} else {
		common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
		audioFormat := "mp3" // 默认格式
		if audioReq, ok := info.Request.(*dto.AudioRequest); ok && audioReq.ResponseFormat != "" {
			audioFormat = audioReq.ResponseFormat
		}

		var duration float64
		var durationErr error
		// PCM needs only a byte count. Other formats require seekable input;
		// retain at most 64 MiB locally, never archive a paid response. Respect
		// a smaller configured download limit as well. Probe failures use the
		// existing size-based estimate without interrupting audio delivery.
		spoolLimit := int64(64 << 20)
		if constant.MaxFileDownloadMB > 0 && constant.MaxFileDownloadMB < 64 {
			spoolLimit = int64(constant.MaxFileDownloadMB) << 20
		}
		var spool *os.File
		if audioFormat != "pcm" {
			spool, durationErr = os.CreateTemp("", "boxai-tts-*")
			if spool != nil {
				defer os.Remove(spool.Name())
				defer spool.Close()
			}
		}
		// Closing the body unblocks a pending upstream read on cancellation.
		stopCancel := context.AfterFunc(c.Request.Context(), func() { resp.Body.Close() })
		defer stopCancel()
		var bodySize int64
		buffer := make([]byte, 32*1024)
		c.Writer.WriteHeaderNow()
		for {
			if err := c.Request.Context().Err(); err != nil {
				logger.LogError(c, fmt.Sprintf("TTS response canceled: %v", err))
				return usage
			}
			n, readErr := resp.Body.Read(buffer)
			if n > 0 {
				bodySize += int64(n)
				written, writeErr := c.Writer.Write(buffer[:n])
				if writeErr == nil && written != n {
					writeErr = io.ErrShortWrite
				}
				if writeErr != nil {
					logger.LogError(c, fmt.Sprintf("failed to write TTS response: %v", writeErr))
					// Do not drain or retry a paid request after client disconnect.
					durationErr = writeErr
					break
				}
				c.Writer.Flush()
				if spool != nil && durationErr == nil {
					if bodySize > spoolLimit {
						durationErr = fmt.Errorf("TTS duration probe exceeds %d bytes", spoolLimit)
					} else {
						_, durationErr = spool.Write(buffer[:n])
					}
					if durationErr != nil {
						spool.Close()
						os.Remove(spool.Name())
					}
				}
			}
			if readErr != nil {
				if readErr != io.EOF {
					logger.LogError(c, fmt.Sprintf("failed to read TTS response body: %v", readErr))
					return usage
				}
				break
			}
		}

		if audioFormat == "pcm" {
			// PCM 格式没有文件头，根据 OpenAI TTS 的 PCM 参数计算时长
			// 采样率: 24000 Hz, 位深度: 16-bit (2 bytes), 声道数: 1
			const sampleRate = 24000
			const bytesPerSample = 2
			const channels = 1
			duration = float64(bodySize) / float64(sampleRate*bytesPerSample*channels)
		} else if durationErr == nil {
			if _, durationErr = spool.Seek(0, io.SeekStart); durationErr == nil {
				duration, durationErr = common.GetAudioDuration(c.Request.Context(), spool, "."+audioFormat)
			}
		}

		usage.PromptTokensDetails.TextTokens = usage.PromptTokens

		if durationErr != nil {
			logger.LogWarn(c, fmt.Sprintf("failed to get audio duration: %v", durationErr))
			// 如果无法获取时长，则设置保底的 CompletionTokens，根据body大小计算
			sizeInKB := float64(bodySize) / 1000.0
			estimatedTokens := common.QuotaFromFloat(math.Ceil(sizeInKB)) // 粗略估算每KB约等于1 token
			usage.CompletionTokens = estimatedTokens
			usage.CompletionTokenDetails.AudioTokens = estimatedTokens
		} else if duration > 0 {
			// 计算 token: ceil(duration) / 60.0 * 1000，即每分钟 1000 tokens。
			// duration 解析自上游返回的音频元数据，饱和转换防止 int 回绕。
			completionTokens := common.QuotaRound(math.Ceil(duration) / 60.0 * 1000)
			usage.CompletionTokens = completionTokens
			usage.CompletionTokenDetails.AudioTokens = completionTokens
		}
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}

	return usage
}

func OpenaiSTTHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo, responseFormat string) (*types.NewAPIError, *dto.Usage) {
	defer service.CloseResponseBodyGracefully(resp)

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError), nil
	}
	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	var responseData struct {
		Usage *dto.Usage `json:"usage"`
	}
	if err := common.Unmarshal(responseBody, &responseData); err == nil && responseData.Usage != nil {
		if responseData.Usage.TotalTokens > 0 {
			usage := responseData.Usage
			if usage.PromptTokens == 0 {
				usage.PromptTokens = usage.InputTokens
			}
			if usage.CompletionTokens == 0 {
				usage.CompletionTokens = usage.OutputTokens
			}
			return nil, usage
		}
	}

	usage := &dto.Usage{}
	usage.PromptTokens = info.GetEstimatePromptTokens()
	usage.CompletionTokens = 0
	usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	return nil, usage
}
