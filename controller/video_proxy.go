package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
)

// videoProxyError returns a standardized OpenAI-style error response.
func videoProxyError(c *gin.Context, status int, errType, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{
			"message": message,
			"type":    errType,
		},
	})
}

func VideoProxy(c *gin.Context) {
	taskID := c.Param("task_id")
	if taskID == "" {
		videoProxyError(c, http.StatusBadRequest, "invalid_request_error", "task_id is required")
		return
	}

	userID := c.GetInt("id")
	task, exists, err := model.GetByTaskId(userID, taskID)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to query task %s: %s", taskID, err.Error()))
		videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to query task")
		return
	}
	if !exists || task == nil {
		videoProxyError(c, http.StatusNotFound, "invalid_request_error", "Task not found")
		return
	}

	if task.Status != model.TaskStatusSuccess {
		videoProxyError(c, http.StatusBadRequest, "invalid_request_error",
			fmt.Sprintf("Task is not completed yet, current status: %s", task.Status))
		return
	}

	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to get channel for task %s: %s", taskID, err.Error()))
		videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to retrieve channel information")
		return
	}
	baseURL := channel.GetBaseURL()
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}

	var videoURL string
	isXAITask := task.Platform == constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeXai))
	untrustedResultURL := isUntrustedVideoResultURL(isXAITask, channel.Type)
	operatorManagedURL := false

	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "", nil)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to create request: %s", err.Error()))
		videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy request")
		return
	}

	if isXAITask {
		// xAI returns a temporary media URL in the completed task response and
		// does not expose the OpenAI-compatible /content endpoint.
		videoURL = task.GetResultURL()
		if parsed, parseErr := url.Parse(videoURL); parseErr == nil && !parsed.IsAbs() && parsed.Host == "" && strings.HasPrefix(parsed.Path, "/") {
			base, baseErr := url.Parse(baseURL)
			if baseErr != nil {
				videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to resolve video content URL")
				return
			}
			videoURL = base.ResolveReference(parsed).String()
			apiKey := task.PrivateData.Key
			if apiKey == "" {
				apiKey = channel.Key
			}
			req.Header.Set("Authorization", "Bearer "+apiKey)
			untrustedResultURL = false
			operatorManagedURL = true
		}
	} else {
		switch channel.Type {
		case constant.ChannelTypeGemini:
			apiKey := task.PrivateData.Key
			if apiKey == "" {
				logger.LogError(c.Request.Context(), fmt.Sprintf("Missing stored API key for Gemini task %s", taskID))
				videoProxyError(c, http.StatusInternalServerError, "server_error", "API key not stored for task")
				return
			}
			videoURL, err = getGeminiVideoURL(channel, task, apiKey)
			if err != nil {
				logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to resolve Gemini video URL for task %s: %s", taskID, err.Error()))
				videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to resolve Gemini video URL")
				return
			}
			req.Header.Set("x-goog-api-key", apiKey)
		case constant.ChannelTypeVertexAi:
			videoURL, err = getVertexVideoURL(channel, task)
			if err != nil {
				logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to resolve Vertex video URL for task %s: %s", taskID, err.Error()))
				videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to resolve Vertex video URL")
				return
			}
		case constant.ChannelTypeOpenAI, constant.ChannelTypeSora:
			videoURL = fmt.Sprintf("%s/v1/videos/%s/content", baseURL, task.GetUpstreamTaskID())
			apiKey := task.PrivateData.Key
			if apiKey == "" {
				apiKey = channel.Key
			}
			req.Header.Set("Authorization", "Bearer "+apiKey)
		default:
			// Video URL is stored in PrivateData.ResultURL (fallback to FailReason for old data)
			videoURL = task.GetResultURL()
		}
	}

	videoURL = strings.TrimSpace(videoURL)
	if videoURL == "" {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Video URL is empty for task %s", taskID))
		videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to fetch video content")
		return
	}

	if strings.HasPrefix(videoURL, "data:") {
		if err := writeVideoDataURL(c, videoURL); err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to decode video data URL for task %s: %s", taskID, err.Error()))
			videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to fetch video content")
		}
		return
	}

	proxy := channel.GetSetting().Proxy
	client := service.GetSSRFProtectedHTTPClient()
	fetchSetting := system_setting.GetFetchSetting()
	if untrustedResultURL {
		// Media result URLs are upstream-controlled. Resolve and dial them
		// locally with non-configurable destination validation.
		proxy = ""
		client = service.GetStrictUntrustedMediaHTTPClient()
	} else if proxy != "" {
		client, err = service.GetHttpClientWithProxy(proxy)
		if err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to create proxy client for task %s: %s", taskID, err.Error()))
			videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy client")
			return
		}
	} else if operatorManagedURL {
		client = service.GetHttpClient()
	}

	var validateErr error
	if operatorManagedURL {
		validateErr = nil
	} else if untrustedResultURL {
		validateErr = service.ValidateUntrustedMediaURL(videoURL)
	} else if proxy == "" {
		validateErr = service.ValidateSSRFProtectedFetchURL(videoURL)
	} else {
		validateErr = common.ValidateURLWithFetchSetting(videoURL, fetchSetting.EnableSSRFProtection, fetchSetting.AllowPrivateIp, fetchSetting.DomainFilterMode, fetchSetting.IpFilterMode, fetchSetting.DomainList, fetchSetting.IpList, fetchSetting.AllowedPorts, fetchSetting.ApplyIPFilterForDomain)
	}
	if validateErr != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Video URL blocked for task %s: %v", taskID, validateErr))
		videoProxyError(c, http.StatusForbidden, "server_error", fmt.Sprintf("request blocked: %v", validateErr))
		return
	}

	req.URL, err = url.Parse(videoURL)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to parse video URL for task %s", taskID))
		videoProxyError(c, http.StatusInternalServerError, "server_error", "Failed to create proxy request")
		return
	}

	resp, err := client.Do(req)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to fetch video for task %s from host %s", taskID, req.URL.Hostname()))
		videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to fetch video content")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Upstream returned status %d for video task %s from host %s", resp.StatusCode, taskID, req.URL.Hostname()))
		videoProxyError(c, http.StatusBadGateway, "server_error",
			fmt.Sprintf("Upstream service returned status %d", resp.StatusCode))
		return
	}

	header := make([]byte, 512)
	n, readErr := io.ReadFull(resp.Body, header)
	if readErr != nil && readErr != io.EOF && readErr != io.ErrUnexpectedEOF {
		videoProxyError(c, http.StatusBadGateway, "server_error", "Failed to read video content")
		return
	}
	header = header[:n]
	mimeType, kind, err := service.SniffPlaygroundMime(header, resp.Header.Get("Content-Type"))
	if err != nil || kind != "video" {
		videoProxyError(c, http.StatusBadGateway, "server_error", "Upstream returned invalid video content")
		return
	}

	copyVideoResponseHeaders(c.Writer.Header(), resp.Header)
	c.Writer.Header().Set("Content-Type", mimeType)
	c.Writer.Header().Set("X-Content-Type-Options", "nosniff")

	c.Writer.Header().Set("Cache-Control", "private, no-store")
	c.Writer.WriteHeader(resp.StatusCode)
	if _, err = io.Copy(c.Writer, io.MultiReader(bytes.NewReader(header), resp.Body)); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Failed to stream video content: %s", err.Error()))
	}
}

func isUntrustedVideoResultURL(isXAITask bool, channelType int) bool {
	if isXAITask {
		return true
	}
	return channelType != constant.ChannelTypeOpenAI && channelType != constant.ChannelTypeSora
}

func copyVideoResponseHeaders(dst, src http.Header) {
	for _, key := range []string{
		"Accept-Ranges",
		"Content-Disposition",
		"Content-Length",
		"Content-Range",
		"ETag",
		"Last-Modified",
	} {
		for _, value := range src.Values(key) {
			dst.Add(key, value)
		}
	}
}

func writeVideoDataURL(c *gin.Context, dataURL string) error {
	parts := strings.SplitN(dataURL, ",", 2)
	if len(parts) != 2 {
		return fmt.Errorf("invalid data url")
	}

	header := parts[0]
	payload := parts[1]
	if !strings.HasPrefix(header, "data:") || !strings.Contains(header, ";base64") {
		return fmt.Errorf("unsupported data url")
	}

	declaredMime := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")

	videoBytes, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		videoBytes, err = base64.RawStdEncoding.DecodeString(payload)
		if err != nil {
			return err
		}
	}

	sniffHeader := videoBytes
	if len(sniffHeader) > 512 {
		sniffHeader = sniffHeader[:512]
	}
	mimeType, kind, err := service.SniffPlaygroundMime(sniffHeader, declaredMime)
	if err != nil || kind != "video" {
		return fmt.Errorf("data URL does not contain video content")
	}
	c.Writer.Header().Set("Content-Type", mimeType)
	c.Writer.Header().Set("X-Content-Type-Options", "nosniff")
	c.Writer.Header().Set("Cache-Control", "private, no-store")
	c.Writer.WriteHeader(http.StatusOK)
	_, err = c.Writer.Write(videoBytes)
	return err
}
