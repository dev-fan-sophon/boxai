package controller

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/rand"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/pkg/modelsdev"

	"github.com/gin-gonic/gin"
)

func getUpstreamURL() string {
	return common.GetEnvOrDefaultString("SYNC_UPSTREAM_MODELS_URL", modelsdev.APIURL)
}

type upstreamModel struct {
	Description        string
	Icon               string
	ModelName          string
	NameRule           int
	Status             int
	Tags               string
	VendorName         string
	VendorNamespace    string
	DisplayName        string
	Family             string
	KnowledgeCutoff    string
	ReleaseDate        string
	LastUpdated        string
	ContextLength      int
	MaxInputTokens     int
	MaxOutputTokens    int
	InputModalities    string
	OutputModalities   string
	Capabilities       string
	SupportedReasoning bool
	ReasoningEfforts   string
	ReasoningOptions   string
	Temperature        *bool
	Attachment         bool
	OpenWeights        bool
	Interleaved        string
}

type upstreamVendor struct {
	Description string `json:"description"`
	Icon        string `json:"icon"`
	Name        string `json:"name"`
	Status      int    `json:"status"`
}

var (
	etagCache  = make(map[string]string)
	bodyCache  = make(map[string][]byte)
	cacheMutex sync.RWMutex
)

type overwriteField struct {
	ModelName string   `json:"model_name"`
	Fields    []string `json:"fields"`
}

type syncRequest struct {
	Overwrite []overwriteField `json:"overwrite"`
	Locale    string           `json:"locale"`
}

func newHTTPClient() *http.Client {
	timeoutSec := common.GetEnvOrDefault("SYNC_HTTP_TIMEOUT_SECONDS", 10)
	dialer := &net.Dialer{Timeout: time.Duration(timeoutSec) * time.Second}
	transport := &http.Transport{
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   time.Duration(timeoutSec) * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ResponseHeaderTimeout: time.Duration(timeoutSec) * time.Second,
	}
	if common.TLSInsecureSkipVerify {
		transport.TLSClientConfig = common.InsecureTLSConfig
	}
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}
		if strings.HasSuffix(host, "github.io") {
			if conn, err := dialer.DialContext(ctx, "tcp4", addr); err == nil {
				return conn, nil
			}
			return dialer.DialContext(ctx, "tcp6", addr)
		}
		return dialer.DialContext(ctx, network, addr)
	}
	return &http.Client{Transport: transport}
}

var (
	httpClientOnce sync.Once
	httpClient     *http.Client
)

func getHTTPClient() *http.Client {
	httpClientOnce.Do(func() {
		httpClient = newHTTPClient()
	})
	return httpClient
}

func fetchJSON[T any](ctx context.Context, url string, out *T) error {
	var lastErr error
	attempts := common.GetEnvOrDefault("SYNC_HTTP_RETRY", 3)
	if attempts < 1 {
		attempts = 1
	}
	baseDelay := 200 * time.Millisecond
	maxMB := common.GetEnvOrDefault("SYNC_HTTP_MAX_MB", 10)
	maxBytes := int64(maxMB) << 20
	for attempt := 0; attempt < attempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		// ETag conditional request
		cacheMutex.RLock()
		if et := etagCache[url]; et != "" {
			req.Header.Set("If-None-Match", et)
		}
		cacheMutex.RUnlock()

		resp, err := getHTTPClient().Do(req)
		if err != nil {
			lastErr = err
			// backoff with jitter
			sleep := baseDelay * time.Duration(1<<attempt)
			jitter := time.Duration(rand.Intn(150)) * time.Millisecond
			time.Sleep(sleep + jitter)
			continue
		}
		func() {
			defer resp.Body.Close()
			switch resp.StatusCode {
			case http.StatusOK:
				// read body into buffer for caching and flexible decode
				limited := io.LimitReader(resp.Body, maxBytes)
				buf, err := io.ReadAll(limited)
				if err != nil {
					lastErr = err
					return
				}
				// cache body and ETag
				cacheMutex.Lock()
				if et := resp.Header.Get("ETag"); et != "" {
					etagCache[url] = et
				}
				bodyCache[url] = buf
				cacheMutex.Unlock()

				if err := common.Unmarshal(buf, out); err != nil {
					lastErr = err
					return
				}
				lastErr = nil
			case http.StatusNotModified:
				// use cache
				cacheMutex.RLock()
				buf := bodyCache[url]
				cacheMutex.RUnlock()
				if len(buf) == 0 {
					lastErr = errors.New("cache miss for 304 response")
					return
				}
				if err := common.Unmarshal(buf, out); err != nil {
					lastErr = err
					return
				}
				lastErr = nil
			default:
				lastErr = errors.New(resp.Status)
			}
		}()
		if lastErr == nil {
			return nil
		}
		sleep := baseDelay * time.Duration(1<<attempt)
		jitter := time.Duration(rand.Intn(150)) * time.Millisecond
		time.Sleep(sleep + jitter)
	}
	return lastErr
}

func parseModelsDevCatalog(entries []modelsdev.CatalogEntry) ([]upstreamModel, []upstreamVendor) {
	models := make([]upstreamModel, 0, len(entries))
	vendorsByName := make(map[string]upstreamVendor)
	for _, entry := range entries {
		vendor := upstreamVendor{
			Name:        entry.VendorName,
			Description: entry.VendorName + " model provider",
			Icon:        modelsdev.VendorIconKey(entry.VendorNamespace),
			Status:      1,
		}
		vendorsByName[entry.VendorName] = vendor
		models = append(models, catalogEntryToUpstreamModel(entry))
	}

	vendorNames := make([]string, 0, len(vendorsByName))
	for name := range vendorsByName {
		vendorNames = append(vendorNames, name)
	}
	sort.Strings(vendorNames)
	vendors := make([]upstreamVendor, 0, len(vendorNames))
	for _, name := range vendorNames {
		vendors = append(vendors, vendorsByName[name])
	}
	return models, vendors
}

func catalogEntryToUpstreamModel(entry modelsdev.CatalogEntry) upstreamModel {
	tags := make([]string, 0, 8)
	if entry.Family != "" {
		tags = append(tags, "family:"+entry.Family)
	}
	if entry.SupportedReasoning {
		tags = append(tags, "reasoning")
	}
	if containsString(entry.Capabilities, "tools") || containsString(entry.Capabilities, "function_calling") {
		tags = append(tags, "tool-call")
	}
	if containsString(entry.Capabilities, "structured_output") {
		tags = append(tags, "structured-output")
	}
	if entry.Attachment {
		tags = append(tags, "attachment")
	}
	if entry.OpenWeights {
		tags = append(tags, "open-weights")
	}
	for _, modality := range entry.InputModalities {
		tags = append(tags, "input:"+modality)
	}
	for _, modality := range entry.OutputModalities {
		tags = append(tags, "output:"+modality)
	}
	return upstreamModel{
		Description:        entry.Description,
		ModelName:          entry.ModelName,
		NameRule:           model.NameRuleExact,
		Status:             1,
		Tags:               strings.Join(tags, ","),
		VendorName:         entry.VendorName,
		VendorNamespace:    entry.VendorNamespace,
		DisplayName:        entry.DisplayName,
		Family:             entry.Family,
		KnowledgeCutoff:    entry.KnowledgeCutoff,
		ReleaseDate:        entry.ReleaseDate,
		LastUpdated:        entry.LastUpdated,
		ContextLength:      entry.ContextLength,
		MaxInputTokens:     entry.MaxInputTokens,
		MaxOutputTokens:    entry.MaxOutputTokens,
		InputModalities:    modelsdev.MarshalJSONList(entry.InputModalities),
		OutputModalities:   modelsdev.MarshalJSONList(entry.OutputModalities),
		Capabilities:       modelsdev.MarshalJSONList(entry.Capabilities),
		SupportedReasoning: entry.SupportedReasoning,
		ReasoningEfforts:   modelsdev.MarshalJSONList(entry.ReasoningEfforts),
		ReasoningOptions:   modelsdev.MarshalJSONValue(entry.ReasoningOptions),
		Temperature:        entry.Temperature,
		Attachment:         entry.Attachment,
		OpenWeights:        entry.OpenWeights,
		Interleaved:        strings.TrimSpace(string(entry.Interleaved)),
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func fetchUpstreamMetadata(ctx context.Context) ([]upstreamModel, []upstreamVendor, error) {
	var raw json.RawMessage
	if err := fetchJSON(ctx, getUpstreamURL(), &raw); err != nil {
		return nil, nil, err
	}
	entries, err := modelsdev.ParseAPICatalog(raw)
	if err != nil {
		return nil, nil, err
	}
	models, vendors := parseModelsDevCatalog(entries)
	if len(models) == 0 {
		return nil, nil, errors.New("models.dev returned no valid models")
	}
	return models, vendors, nil
}

func ensureVendorID(vendorName string, vendorByName map[string]upstreamVendor, vendorIDCache map[string]int, createdVendors *int) int {
	if vendorName == "" {
		return 0
	}
	if id, ok := vendorIDCache[vendorName]; ok {
		return id
	}
	var existing model.Vendor
	if err := model.DB.Where("name = ?", vendorName).First(&existing).Error; err == nil {
		upstream := vendorByName[vendorName]
		if existing.Icon == "" && upstream.Icon != "" {
			_ = model.DB.Model(&existing).Update("icon", upstream.Icon).Error
		}
		vendorIDCache[vendorName] = existing.Id
		return existing.Id
	}
	uv := vendorByName[vendorName]
	v := &model.Vendor{
		Name:        vendorName,
		Description: uv.Description,
		Icon:        coalesce(uv.Icon, ""),
		Status:      chooseStatus(uv.Status, 1),
	}
	if err := v.Insert(); err == nil {
		*createdVendors++
		vendorIDCache[vendorName] = v.Id
		return v.Id
	}
	vendorIDCache[vendorName] = 0
	return 0
}

type modelsDevSyncResult struct {
	CreatedModels  int      `json:"created_models"`
	CreatedVendors int      `json:"created_vendors"`
	UpdatedModels  int      `json:"updated_models"`
	SkippedModels  []string `json:"skipped_models"`
	CreatedList    []string `json:"created_list"`
	UpdatedList    []string `json:"updated_list"`
	SourceURL      string   `json:"source_url"`
}

// SyncUpstreamModels pulls models.dev and writes the full official catalog
// onto every locally enabled model that still opts into official sync.
func SyncUpstreamModels(c *gin.Context) {
	var req syncRequest
	_ = c.ShouldBindJSON(&req)

	timeoutSec := common.GetEnvOrDefault("SYNC_HTTP_TIMEOUT_SECONDS", 15)
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	result, err := syncModelsDevCatalog(ctx)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取上游模型失败: " + err.Error(), "locale": req.Locale, "source_urls": gin.H{"models_url": getUpstreamURL()}})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"created_models":  result.CreatedModels,
			"created_vendors": result.CreatedVendors,
			"updated_models":  result.UpdatedModels,
			"skipped_models":  result.SkippedModels,
			"created_list":    result.CreatedList,
			"updated_list":    result.UpdatedList,
			"source": gin.H{
				"locale":     req.Locale,
				"models_url": result.SourceURL,
			},
		},
	})
}

func syncModelsDevCatalog(ctx context.Context) (*modelsDevSyncResult, error) {
	missing, err := model.GetMissingModels()
	if err != nil {
		return nil, err
	}

	modelsURL := getUpstreamURL()
	upstreamModels, upstreamVendors, fetchErr := fetchUpstreamMetadata(ctx)
	if fetchErr != nil {
		return nil, fetchErr
	}

	// 建立映射
	vendorByName := make(map[string]upstreamVendor)
	for _, v := range upstreamVendors {
		if v.Name != "" {
			vendorByName[v.Name] = v
		}
	}
	modelByName := make(map[string]upstreamModel)
	for _, m := range upstreamModels {
		if m.ModelName != "" {
			modelByName[m.ModelName] = m
		}
	}

	// 3) 执行同步：仅创建缺失模型；若上游缺失该模型则跳过
	createdModels := 0
	createdVendors := 0
	updatedModels := 0
	skipped := make([]string, 0)
	createdList := make([]string, 0)
	updatedList := make([]string, 0)

	// 本地缓存：vendorName -> id
	vendorIDCache := make(map[string]int)

	for _, name := range missing {
		up, ok := modelByName[name]
		if !ok {
			skipped = append(skipped, name)
			continue
		}

		// 若本地已存在且设置为不同步，则跳过（极端情况：缺失列表与本地状态不同步时）
		var existing model.Model
		if err := model.DB.Where("model_name = ?", name).First(&existing).Error; err == nil {
			if existing.SyncOfficial == 0 {
				skipped = append(skipped, name)
				continue
			}
		}

		// 确保 vendor 存在
		vendorID := ensureVendorID(up.VendorName, vendorByName, vendorIDCache, &createdVendors)

		// 创建模型
		mi := newModelFromUpstream(name, vendorID, up)
		if err := mi.Insert(); err == nil {
			createdModels++
			createdList = append(createdList, name)
		} else {
			skipped = append(skipped, name)
		}
	}

	// 4) Refresh official models.dev fields on every local model that still
	// opts into official sync. Manual per-field overwrite is no longer the
	// source of truth — models.dev wins for catalog facts.
	var locals []model.Model
	if err := model.DB.Where("sync_official <> 0").Find(&locals).Error; err == nil {
		for i := range locals {
			local := &locals[i]
			up, ok := modelByName[local.ModelName]
			if !ok {
				continue
			}
			vendorID := ensureVendorID(up.VendorName, vendorByName, vendorIDCache, &createdVendors)
			if !applyOfficialCatalogFields(local, vendorID, up) {
				continue
			}
			if err := local.Update(); err != nil {
				continue
			}
			updatedModels++
			updatedList = append(updatedList, local.ModelName)
		}
	}

	if createdModels > 0 || updatedModels > 0 {
		model.RefreshPricing()
	}

	return &modelsDevSyncResult{
		CreatedModels:  createdModels,
		CreatedVendors: createdVendors,
		UpdatedModels:  updatedModels,
		SkippedModels:  skipped,
		CreatedList:    createdList,
		UpdatedList:    updatedList,
		SourceURL:      modelsURL,
	}, nil
}

func newModelFromUpstream(name string, vendorID int, up upstreamModel) *model.Model {
	mi := &model.Model{
		ModelName: name,
		VendorID:  vendorID,
		Status:    chooseStatus(up.Status, 1),
		NameRule:  up.NameRule,
	}
	applyOfficialCatalogFields(mi, vendorID, up)
	return mi
}

func applyOfficialCatalogFields(local *model.Model, vendorID int, up upstreamModel) bool {
	changed := false
	setString := func(dst *string, src string) {
		if *dst != src {
			*dst = src
			changed = true
		}
	}
	setInt := func(dst *int, src int) {
		if *dst != src {
			*dst = src
			changed = true
		}
	}
	setBool := func(dst *bool, src bool) {
		if *dst != src {
			*dst = src
			changed = true
		}
	}
	setString(&local.Description, up.Description)
	if up.Icon != "" {
		setString(&local.Icon, up.Icon)
	}
	setString(&local.Tags, up.Tags)
	setString(&local.DisplayName, up.DisplayName)
	setString(&local.KnowledgeCutoff, up.KnowledgeCutoff)
	setString(&local.ReleaseDate, up.ReleaseDate)
	setString(&local.LastUpdated, up.LastUpdated)
	setInt(&local.ContextLength, up.ContextLength)
	setInt(&local.MaxInputTokens, up.MaxInputTokens)
	setInt(&local.MaxOutputTokens, up.MaxOutputTokens)
	setString(&local.InputModalities, up.InputModalities)
	setString(&local.OutputModalities, up.OutputModalities)
	setString(&local.Capabilities, up.Capabilities)
	setBool(&local.SupportedReasoning, up.SupportedReasoning)
	setString(&local.ReasoningEfforts, up.ReasoningEfforts)
	setString(&local.ReasoningOptions, up.ReasoningOptions)
	setBool(&local.Attachment, up.Attachment)
	setBool(&local.OpenWeights, up.OpenWeights)
	setString(&local.Interleaved, up.Interleaved)
	if vendorID != 0 && local.VendorID != vendorID {
		local.VendorID = vendorID
		changed = true
	}
	if up.NameRule != 0 && local.NameRule != up.NameRule {
		local.NameRule = up.NameRule
		changed = true
	}
	if up.Temperature == nil {
		if local.Temperature != nil {
			local.Temperature = nil
			changed = true
		}
	} else if local.Temperature == nil || *local.Temperature != *up.Temperature {
		value := *up.Temperature
		local.Temperature = &value
		changed = true
	}
	return changed
}

func coalesce(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

func chooseStatus(primary, fallback int) int {
	if primary == 0 && fallback != 0 {
		return fallback
	}
	if primary != 0 {
		return primary
	}
	return 1
}

// SyncUpstreamPreview 预览上游与本地的差异（仅用于弹窗选择）
func SyncUpstreamPreview(c *gin.Context) {
	// 1) 拉取上游数据
	timeoutSec := common.GetEnvOrDefault("SYNC_HTTP_TIMEOUT_SECONDS", 15)
	ctx, cancel := context.WithTimeout(c.Request.Context(), time.Duration(timeoutSec)*time.Second)
	defer cancel()

	locale := c.Query("locale")
	modelsURL := getUpstreamURL()
	upstreamModels, upstreamVendors, fetchErr := fetchUpstreamMetadata(ctx)
	if fetchErr != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": "获取上游模型失败: " + fetchErr.Error(), "locale": locale, "source_urls": gin.H{"models_url": modelsURL}})
		return
	}

	vendorByName := make(map[string]upstreamVendor)
	for _, v := range upstreamVendors {
		if v.Name != "" {
			vendorByName[v.Name] = v
		}
	}
	modelByName := make(map[string]upstreamModel)
	upstreamNames := make([]string, 0, len(upstreamModels))
	for _, m := range upstreamModels {
		if m.ModelName != "" {
			modelByName[m.ModelName] = m
			upstreamNames = append(upstreamNames, m.ModelName)
		}
	}

	// 2) 本地已有模型
	var locals []model.Model
	if len(upstreamNames) > 0 {
		_ = model.DB.Where("model_name IN ? AND sync_official <> 0", upstreamNames).Find(&locals).Error
	}

	// 本地 vendor 名称映射
	vendorIdSet := make(map[int]struct{})
	for _, m := range locals {
		if m.VendorID != 0 {
			vendorIdSet[m.VendorID] = struct{}{}
		}
	}
	vendorIDs := make([]int, 0, len(vendorIdSet))
	for id := range vendorIdSet {
		vendorIDs = append(vendorIDs, id)
	}
	idToVendorName := make(map[int]string)
	if len(vendorIDs) > 0 {
		var dbVendors []model.Vendor
		_ = model.DB.Where("id IN ?", vendorIDs).Find(&dbVendors).Error
		for _, v := range dbVendors {
			idToVendorName[v.Id] = v.Name
		}
	}

	// 3) 缺失且上游存在的模型
	missingList, _ := model.GetMissingModels()
	var missing []string
	for _, name := range missingList {
		if _, ok := modelByName[name]; ok {
			missing = append(missing, name)
		}
	}

	// 4) 计算冲突字段
	type conflictField struct {
		Field    string      `json:"field"`
		Local    interface{} `json:"local"`
		Upstream interface{} `json:"upstream"`
	}
	type conflictItem struct {
		ModelName string          `json:"model_name"`
		Fields    []conflictField `json:"fields"`
	}

	var conflicts []conflictItem
	for _, local := range locals {
		up, ok := modelByName[local.ModelName]
		if !ok {
			continue
		}
		fields := make([]conflictField, 0, 6)
		if strings.TrimSpace(local.Description) != strings.TrimSpace(up.Description) {
			fields = append(fields, conflictField{Field: "description", Local: local.Description, Upstream: up.Description})
		}
		if strings.TrimSpace(local.Icon) != strings.TrimSpace(up.Icon) {
			fields = append(fields, conflictField{Field: "icon", Local: local.Icon, Upstream: up.Icon})
		}
		if strings.TrimSpace(local.Tags) != strings.TrimSpace(up.Tags) {
			fields = append(fields, conflictField{Field: "tags", Local: local.Tags, Upstream: up.Tags})
		}
		// vendor 对比使用名称
		localVendor := idToVendorName[local.VendorID]
		if strings.TrimSpace(localVendor) != strings.TrimSpace(up.VendorName) {
			fields = append(fields, conflictField{Field: "vendor", Local: localVendor, Upstream: up.VendorName})
		}
		if local.NameRule != up.NameRule {
			fields = append(fields, conflictField{Field: "name_rule", Local: local.NameRule, Upstream: up.NameRule})
		}
		if local.Status != chooseStatus(up.Status, local.Status) {
			fields = append(fields, conflictField{Field: "status", Local: local.Status, Upstream: up.Status})
		}
		if len(fields) > 0 {
			conflicts = append(conflicts, conflictItem{ModelName: local.ModelName, Fields: fields})
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"missing":   missing,
			"conflicts": conflicts,
			"source": gin.H{
				"locale":     locale,
				"models_url": modelsURL,
			},
		},
	})
}
