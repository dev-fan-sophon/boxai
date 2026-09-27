package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/constant"
	"github.com/dev-fan-sophon/boxai/dto"
	"github.com/dev-fan-sophon/boxai/logger"
	"github.com/dev-fan-sophon/boxai/model"
	"github.com/dev-fan-sophon/boxai/relay/channel/task/taskcommon"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/service/storage"

	"github.com/samber/lo"
	"gorm.io/gorm"
)

// TaskPollingAdaptor 定义轮询所需的最小适配器接口，避免 service -> relay 的循环依赖
type TaskPollingAdaptor interface {
	Init(info *relaycommon.RelayInfo)
	FetchTask(baseURL string, key string, body map[string]any, proxy string) (*http.Response, error)
	ParseTaskResult(body []byte) (*relaycommon.TaskInfo, error)
	// AdjustBillingOnComplete 在任务到达终态（成功/失败）时由轮询循环调用。
	// 返回正数触发差额结算（补扣/退还），返回 0 保持预扣费金额不变。
	AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int
}

type contextTaskPollingAdaptor interface {
	FetchTaskWithContext(ctx context.Context, baseURL string, key string, body map[string]any, proxy string) (*http.Response, error)
}

// GetTaskAdaptorFunc 由 main 包注入，用于获取指定平台的任务适配器。
// 打破 service -> relay -> relay/channel -> service 的循环依赖。
var GetTaskAdaptorFunc func(platform constant.TaskPlatform) TaskPollingAdaptor

const (
	taskPollConcurrency        = 16
	taskPollChannelConcurrency = 4
	taskPollRequestTimeout     = 30 * time.Second
	// Vertex can return inline video. Bound it without truncating valid media.
	taskPollResponseLimit = 64 << 20
)

type taskPollJob struct {
	channelID int
	run       func(context.Context)
}

// Shared across callers so overlapping passes cannot multiply upstream load.
var taskPollCapacity = struct {
	sync.Mutex
	active   int
	channels map[int]int
	changed  chan struct{}
}{channels: make(map[int]int), changed: make(chan struct{})}

func runTaskPollJobs(ctx context.Context, jobs []taskPollJob) error {
	if ctx == nil {
		ctx = context.Background()
	}
	var wg sync.WaitGroup
	defer wg.Wait()
	for len(jobs) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		taskPollCapacity.Lock()
		selected := -1
		if taskPollCapacity.active < taskPollConcurrency {
			for i, job := range jobs {
				if taskPollCapacity.channels[job.channelID] < taskPollChannelConcurrency {
					selected = i
					break
				}
			}
		}
		changed := taskPollCapacity.changed
		if selected < 0 {
			taskPollCapacity.Unlock()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-changed:
			}
			continue
		}
		job := jobs[selected]
		jobs = append(jobs[:selected], jobs[selected+1:]...)
		taskPollCapacity.active++
		taskPollCapacity.channels[job.channelID]++
		taskPollCapacity.Unlock()
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				taskPollCapacity.Lock()
				taskPollCapacity.active--
				taskPollCapacity.channels[job.channelID]--
				if taskPollCapacity.channels[job.channelID] == 0 {
					delete(taskPollCapacity.channels, job.channelID)
				}
				close(taskPollCapacity.changed)
				taskPollCapacity.changed = make(chan struct{})
				taskPollCapacity.Unlock()
			}()
			if ctx.Err() == nil {
				job.run(ctx)
			}
		}()
	}
	wg.Wait()
	return ctx.Err()
}

func fetchPollingTask(ctx context.Context, adaptor TaskPollingAdaptor, baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if contextual, ok := adaptor.(contextTaskPollingAdaptor); ok {
		return contextual.FetchTaskWithContext(ctx, baseURL, key, body, proxy)
	}
	// Fail closed rather than wrapping an uncancellable call in a leaking goroutine.
	return nil, errors.New("task adaptor does not support cancellable polling")
}

func readPollingResponse(resp *http.Response) ([]byte, error) {
	if resp == nil || resp.Body == nil {
		return nil, errors.New("empty polling response")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("polling HTTP status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, taskPollResponseLimit+1))
	if err != nil {
		return nil, err
	}
	if len(body) > taskPollResponseLimit {
		return nil, errors.New("polling response exceeds limit")
	}
	return body, nil
}

// sweepTimedOutTasks 在主轮询之前独立清理超时任务。
// 每次最多处理 100 条，剩余的下个周期继续处理。
// 使用 per-task CAS (UpdateWithStatus) 防止覆盖被正常轮询已推进的任务。
func sweepTimedOutTasks(ctx context.Context) {
	if constant.TaskTimeoutMinutes <= 0 {
		return
	}
	cutoff := time.Now().Unix() - int64(constant.TaskTimeoutMinutes)*60
	tasks := model.GetTimedOutUnfinishedTasks(cutoff, 100)
	if len(tasks) == 0 {
		return
	}

	legacyReason := "任务超时（旧系统遗留任务，不进行退款，请联系管理员）"
	now := time.Now().Unix()
	timedOutCount := 0

	for _, task := range tasks {
		if ctx.Err() != nil {
			return
		}
		isLegacy := task.SubmitTime > 0 && task.SubmitTime < model.TaskRefundLegacyCutoff
		// Local age cannot prove an upstream generation failed. Keep modern
		// tasks pollable; only an authenticated provider failure may refund them.
		if !isLegacy {
			continue
		}

		oldStatus := task.Status
		task.Status = model.TaskStatusFailure
		task.Progress = "100%"
		task.FinishTime = now
		task.FailReason = legacyReason
		task.Quota = 0

		won, err := task.UpdateWithStatus(oldStatus)
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("sweepTimedOutTasks CAS update error for task %s: %v", task.TaskID, err))
			continue
		}
		if !won {
			logger.LogInfo(ctx, fmt.Sprintf("sweepTimedOutTasks: task %s already transitioned, skip", task.TaskID))
			continue
		}
		timedOutCount++
	}

	if timedOutCount > 0 {
		logger.LogInfo(ctx, fmt.Sprintf("sweepTimedOutTasks: timed out %d tasks", timedOutCount))
	}
}

// TaskPollSummary is the result recorded on an async_task_poll system task row,
// summarizing one polling pass.
type TaskPollSummary struct {
	UnfinishedTasks  int `json:"unfinished_tasks"`
	PlatformsScanned int `json:"platforms_scanned"`
	NullTasksFailed  int `json:"null_tasks_failed"`
}

// RunTaskPollingOnce performs one async-task (Suno/video) polling pass
// synchronously. It honors ctx cancellation (the system-task runner cancels it
// when the lease is lost) and, when report is non-nil, reports progress as
// (processedPlatforms, totalPlatforms). It returns immediately if the task
// adaptor factory has not been wired yet, to avoid a nil call during startup.
func RunTaskPollingOnce(ctx context.Context, report func(processed, total int)) TaskPollSummary {
	summary := TaskPollSummary{}
	if ctx == nil {
		ctx = context.Background()
	}
	// Bound the whole pass as well as each request. A large slow backlog must
	// yield so the next due-task query can see newly submitted work.
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	if GetTaskAdaptorFunc == nil {
		return summary
	}

	common.SysLog("任务进度轮询开始")
	sweepTimedOutTasks(ctx)
	allTasks, err := model.GetDueSyncTasks(ctx, time.Now().Unix(), constant.TaskQueryLimit)
	if err != nil {
		logger.LogError(ctx, "query due tasks: "+err.Error())
		return summary
	}
	summary.UnfinishedTasks = len(allTasks)
	platformTask := make(map[constant.TaskPlatform][]*model.Task)
	for _, t := range allTasks {
		platformTask[t.Platform] = append(platformTask[t.Platform], t)
	}

	totalPlatforms := len(platformTask)
	processedPlatforms := 0
	var jobs []taskPollJob
	sunoTasks := make(map[int][]*model.Task)
	for _, tasks := range platformTask {
		if ctx.Err() != nil {
			break
		}
		if report != nil {
			report(processedPlatforms, totalPlatforms)
		}
		processedPlatforms++
		if len(tasks) == 0 {
			continue
		}
		summary.PlatformsScanned++
		nullTasks := make([]*model.Task, 0)
		for _, task := range tasks {
			if task.Platform == constant.TaskPlatformMidjourney {
				continue
			}
			upstreamID := task.GetUpstreamTaskID()
			if upstreamID == "" {
				// 统计失败的未完成任务
				nullTasks = append(nullTasks, task)
				continue
			}
			if task.Platform == constant.TaskPlatformSuno {
				sunoTasks[task.ChannelId] = append(sunoTasks[task.ChannelId], task)
				continue
			}
			jobs = append(jobs, taskPollJob{channelID: task.ChannelId, run: func(ctx context.Context) { pollTasks(ctx, []*model.Task{task}) }})
		}
		if len(nullTasks) > 0 {
			reason := "任务缺少上游 task ID，无法继续轮询"
			for _, task := range nullTasks {
				if failPollingTask(ctx, task, reason) {
					summary.NullTasksFailed++
				}
			}
		}
	}
	for channelID, tasks := range sunoTasks {
		for start := 0; start < len(tasks); start += 50 {
			batch := tasks[start:min(start+50, len(tasks))]
			jobs = append(jobs, taskPollJob{channelID: channelID, run: func(ctx context.Context) { pollTasks(ctx, batch) }})
		}
	}
	_ = runTaskPollJobs(ctx, jobs)
	if report != nil && ctx.Err() == nil {
		report(totalPlatforms, totalPlatforms)
	}
	common.SysLog("任务进度轮询完成")
	return summary
}

func pollingChannel(ctx context.Context, channelID int) (*model.Channel, bool, error) {
	channel, err := model.CacheGetChannel(channelID)
	if err == nil {
		return channel, false, nil
	}
	logger.LogWarn(ctx, fmt.Sprintf("CacheGetChannel #%d failed, falling back to database: %v", channelID, err))
	channel, err = model.GetChannelById(channelID, true)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, true, nil
	}
	return channel, false, err
}

func failPollingTask(ctx context.Context, task *model.Task, reason string) bool {
	if ctx.Err() != nil {
		return false
	}
	previousStatus := task.Status
	task.Status = model.TaskStatusFailure
	task.Progress = "100%"
	task.FinishTime = time.Now().Unix()
	task.FailReason = reason
	won, err := task.UpdateWithStatus(previousStatus)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("Failed to mark polling task %s failed: %v", task.TaskID, err))
		return false
	}
	if !won {
		return false
	}
	RefundTaskQuota(ctx, task, reason)
	return true
}

// DispatchPlatformUpdate 按平台分发轮询更新
func DispatchPlatformUpdate(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) {
	if ctx == nil {
		ctx = context.Background()
	}
	switch platform {
	case constant.TaskPlatformMidjourney:
		// MJ 轮询由其自身处理，这里预留入口
	case constant.TaskPlatformSuno:
		_ = UpdateSunoTasks(ctx, taskChannelM, taskM)
	default:
		if err := UpdateVideoTasks(ctx, platform, taskChannelM, taskM); err != nil {
			common.SysLog(fmt.Sprintf("UpdateVideoTasks fail: %s", err))
		}
	}
}

// UpdateSunoTasks 按渠道更新所有 Suno 任务
func UpdateSunoTasks(ctx context.Context, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	var jobs []taskPollJob
	for channelId, taskIds := range taskChannelM {
		for start := 0; start < len(taskIds); start += 50 {
			batch := taskIds[start:min(start+50, len(taskIds))]
			jobs = append(jobs, taskPollJob{channelID: channelId, run: func(ctx context.Context) {
				if err := updateSunoTasks(ctx, channelId, batch, taskM); err != nil {
					logger.LogError(ctx, fmt.Sprintf("channel #%d Suno polling: %v", channelId, err))
				}
			}})
		}
	}
	return runTaskPollJobs(ctx, jobs)
}

func updateSunoTasks(ctx context.Context, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	ctx, cancel := context.WithTimeout(ctx, taskPollRequestTimeout)
	defer cancel()
	logger.LogInfo(ctx, fmt.Sprintf("渠道 #%d 未完成的任务有: %d", channelId, len(taskIds)))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(taskIds) == 0 {
		return nil
	}
	ch, notFound, err := pollingChannel(ctx, channelId)
	if err != nil {
		return err
	}
	if notFound {
		reason := fmt.Sprintf("获取渠道信息失败，请联系管理员，渠道ID：%d", channelId)
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				failPollingTask(ctx, t, reason)
			}
		}
		return nil
	}
	adaptor := GetTaskAdaptorFunc(constant.TaskPlatformSuno)
	if adaptor == nil {
		return errors.New("adaptor not found")
	}
	proxy := ch.GetSetting().Proxy
	resp, err := fetchPollingTask(ctx, adaptor, ch.GetBaseURL(), ch.Key, map[string]any{
		"ids": taskIds,
	}, proxy)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Task Do req error: %v", err))
		return err
	}
	responseBody, err := readPollingResponse(resp)
	if err != nil {
		common.SysLog(fmt.Sprintf("Get Suno Task parse body error: %v", err))
		return err
	}
	var responseItems dto.TaskResponse[[]dto.SunoDataResponse]
	err = common.Unmarshal(responseBody, &responseItems)
	if err != nil {
		logger.LogError(ctx, fmt.Sprintf("Get Suno Task parse body error2: %v, body: %s", err, string(responseBody)))
		return err
	}
	if !responseItems.IsSuccess() {
		common.SysLog(fmt.Sprintf("渠道 #%d 未完成的任务有: %d, 成功获取到任务数: %s", channelId, len(taskIds), string(responseBody)))
		return errors.New("Suno polling response unsuccessful")
	}

	for _, responseItem := range responseItems.Data {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		task := taskM[responseItem.TaskID]
		if task == nil {
			logger.LogWarn(ctx, fmt.Sprintf("Suno task response ignored: unknown task_id=%s", responseItem.TaskID))
			continue
		}
		if !taskNeedsUpdate(task, responseItem) {
			continue
		}

		snapshot := task.Snapshot()
		task.Status = lo.If(model.TaskStatus(responseItem.Status) != "", model.TaskStatus(responseItem.Status)).Else(task.Status)
		task.FailReason = lo.If(responseItem.FailReason != "", responseItem.FailReason).Else(task.FailReason)
		task.SubmitTime = lo.If(responseItem.SubmitTime != 0, responseItem.SubmitTime).Else(task.SubmitTime)
		task.StartTime = lo.If(responseItem.StartTime != 0, responseItem.StartTime).Else(task.StartTime)
		task.FinishTime = lo.If(responseItem.FinishTime != 0, responseItem.FinishTime).Else(task.FinishTime)
		isFailure := responseItem.FailReason != "" || task.Status == model.TaskStatusFailure
		if isFailure {
			logger.LogInfo(ctx, task.TaskID+" 构建失败，"+task.FailReason)
			task.Status = model.TaskStatusFailure
			task.Progress = "100%"
		}
		if responseItem.Status == model.TaskStatusSuccess {
			task.Progress = "100%"
		}
		task.Data = responseItem.Data
		if task.Status == model.TaskStatusSuccess {
			task.PrivateData.CompletionBilling = &model.TaskCompletionBilling{}
			if bc := task.PrivateData.BillingContext; bc == nil || !bc.PerCallBilling {
				task.PrivateData.CompletionBilling.Quota = adaptor.AdjustBillingOnComplete(task, &relaycommon.TaskInfo{Status: model.TaskStatusSuccess})
			}
		}
		if err := ctx.Err(); err != nil {
			return err
		}

		won, err := task.UpdateIfUnchanged(snapshot)
		if err != nil {
			common.SysLog("UpdateSunoTask task error: " + err.Error())
			continue
		}
		if !won {
			continue
		}
		if isFailure {
			RefundTaskQuota(ctx, task, task.FailReason)
		} else if task.Status == model.TaskStatusSuccess {
			settleTaskBillingOnComplete(ctx, adaptor, task, &relaycommon.TaskInfo{Status: model.TaskStatusSuccess})
		}
	}
	return nil
}

// taskNeedsUpdate 检查 Suno 任务是否需要更新
func taskNeedsUpdate(oldTask *model.Task, newTask dto.SunoDataResponse) bool {
	if oldTask.SubmitTime != newTask.SubmitTime {
		return true
	}
	if oldTask.StartTime != newTask.StartTime {
		return true
	}
	if oldTask.FinishTime != newTask.FinishTime {
		return true
	}
	if string(oldTask.Status) != newTask.Status {
		return true
	}
	if oldTask.FailReason != newTask.FailReason {
		return true
	}

	if (oldTask.Status == model.TaskStatusFailure || oldTask.Status == model.TaskStatusSuccess) && oldTask.Progress != "100%" {
		return true
	}

	oldData, _ := common.Marshal(oldTask.Data)
	newData, _ := common.Marshal(newTask.Data)

	sort.Slice(oldData, func(i, j int) bool {
		return oldData[i] < oldData[j]
	})
	sort.Slice(newData, func(i, j int) bool {
		return newData[i] < newData[j]
	})

	if string(oldData) != string(newData) {
		return true
	}
	return false
}

// UpdateVideoTasks 按渠道更新所有视频任务
func UpdateVideoTasks(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	channelIDs := make([]int, 0, len(taskChannelM))
	for channelID := range taskChannelM {
		channelIDs = append(channelIDs, channelID)
	}
	sort.Ints(channelIDs)

	var jobs []taskPollJob
	for _, channelId := range channelIDs {
		for _, id := range taskChannelM[channelId] {
			jobs = append(jobs, taskPollJob{channelID: channelId, run: func(ctx context.Context) {
				if err := updateVideoTasks(ctx, platform, channelId, []string{id}, taskM); err != nil {
					logger.LogError(ctx, err.Error())
				}
			}})
		}
	}
	return runTaskPollJobs(ctx, jobs)
}

func pollTasks(ctx context.Context, batch []*model.Task) {
	if ctx.Err() != nil {
		return
	}
	// Persist a retry beyond the request deadline before I/O, so process loss
	// advances the fair queue and a timeout cannot consume the backoff interval.
	tasks := make(map[string]*model.Task, len(batch))
	ids := make([]string, 0, len(batch))
	for _, task := range batch {
		if err := task.ScheduleNextPoll(ctx, time.Now().Add(taskPollRequestTimeout).Unix(), true); err != nil {
			logger.LogError(ctx, "schedule task poll: "+err.Error())
			continue
		}
		id := task.GetUpstreamTaskID()
		tasks[id] = task
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return
	}
	task := batch[0]
	var err error
	if task.Platform == constant.TaskPlatformSuno {
		err = updateSunoTasks(ctx, task.ChannelId, ids, tasks)
	} else {
		err = updateVideoTasks(ctx, task.Platform, task.ChannelId, ids, tasks)
	}
	if err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("poll task %s: %v", task.TaskID, err))
		return
	}
	for _, task := range tasks {
		if err = task.ScheduleNextPoll(ctx, time.Now().Unix(), false); err != nil && ctx.Err() == nil {
			logger.LogError(ctx, "schedule task poll: "+err.Error())
		}
	}
}

func updateVideoTasks(ctx context.Context, platform constant.TaskPlatform, channelId int, taskIds []string, taskM map[string]*model.Task) error {
	logger.LogInfo(ctx, fmt.Sprintf("Channel #%d pending video tasks: %d", channelId, len(taskIds)))
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if len(taskIds) == 0 {
		return nil
	}
	cacheGetChannel, notFound, err := pollingChannel(ctx, channelId)
	if err != nil {
		return err
	}
	if notFound {
		reason := fmt.Sprintf("Failed to get channel info, channel ID: %d", channelId)
		for _, upstreamID := range taskIds {
			if t, ok := taskM[upstreamID]; ok {
				failPollingTask(ctx, t, reason)
			}
		}
		return nil
	}
	for _, taskId := range taskIds {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		adaptor := GetTaskAdaptorFunc(platform)
		if adaptor == nil {
			return fmt.Errorf("video adaptor not found")
		}
		info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelBaseUrl: cacheGetChannel.GetBaseURL()}}
		info.ApiKey = cacheGetChannel.Key
		adaptor.Init(info)
		if err := updateVideoSingleTask(ctx, adaptor, cacheGetChannel, taskId, taskM); err != nil {
			return err
		}
	}
	return nil
}

func updateVideoSingleTask(ctx context.Context, adaptor TaskPollingAdaptor, ch *model.Channel, taskId string, taskM map[string]*model.Task) error {
	ctx, cancel := context.WithTimeout(ctx, taskPollRequestTimeout)
	defer cancel()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	baseURL := constant.ChannelBaseURLs[ch.Type]
	if ch.GetBaseURL() != "" {
		baseURL = ch.GetBaseURL()
	}
	proxy := ch.GetSetting().Proxy

	task := taskM[taskId]
	if task == nil {
		logger.LogError(ctx, fmt.Sprintf("Task %s not found in taskM", taskId))
		return fmt.Errorf("task %s not found", taskId)
	}
	key := ch.Key

	privateData := task.PrivateData
	if privateData.Key != "" {
		key = privateData.Key
	}
	resp, err := fetchPollingTask(ctx, adaptor, baseURL, key, map[string]any{
		"task_id": task.GetUpstreamTaskID(),
		"action":  task.Action,
	}, proxy)
	if err != nil {
		return fmt.Errorf("fetchTask failed for task %s: %w", taskId, err)
	}
	responseBody, err := readPollingResponse(resp)
	if err != nil {
		return fmt.Errorf("readAll failed for task %s: %w", taskId, err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	redactedResponseBody := redactVideoResponseBody(responseBody, task.Platform)
	logger.LogDebug(ctx, "updateVideoSingleTask response: %s", redactedResponseBody)

	snap := task.Snapshot()

	taskResult := &relaycommon.TaskInfo{}
	// try parse as New API response format
	var responseItems dto.TaskResponse[model.Task]
	if err = common.Unmarshal(responseBody, &responseItems); err == nil && responseItems.IsSuccess() {
		logger.LogDebug(ctx, "updateVideoSingleTask parsed as new api response format for task %s", taskId)
		t := responseItems.Data
		taskResult.TaskID = t.TaskID
		taskResult.Status = string(t.Status)
		taskResult.Url = t.GetResultURL()
		taskResult.Progress = t.Progress
		taskResult.Reason = t.FailReason
		task.Data = t.Data
	} else if taskResult, err = adaptor.ParseTaskResult(responseBody); err != nil {
		return fmt.Errorf("parseTaskResult failed for task %s: %w", taskId, err)
	}
	if taskResult == nil {
		return errors.New("upstream returned no task result")
	}

	task.Data = redactedResponseBody

	logger.LogDebug(ctx, "updateVideoSingleTask task %s status=%s progress=%s", taskId, taskResult.Status, taskResult.Progress)

	now := time.Now().Unix()
	if taskResult.Status == "" {
		// An HTTP/API error describes this query, not the generation lifecycle.
		// Only an explicit provider terminal status may trigger a refund.
		return fmt.Errorf("upstream returned no task status for %s", taskId)
	}

	shouldRefund := false
	shouldSettle := false
	quota := task.Quota

	task.Status = model.TaskStatus(taskResult.Status)
	switch taskResult.Status {
	case model.TaskStatusSubmitted:
		task.Progress = taskcommon.ProgressSubmitted
	case model.TaskStatusQueued:
		task.Progress = taskcommon.ProgressQueued
	case model.TaskStatusInProgress:
		task.Progress = taskcommon.ProgressInProgress
		if task.StartTime == 0 {
			task.StartTime = now
		}
	case model.TaskStatusSuccess:
		task.Progress = taskcommon.ProgressComplete
		if task.FinishTime == 0 {
			task.FinishTime = now
		}
		if strings.HasPrefix(taskResult.Url, "data:") {
			// Keep inline output durable across restart, without exposing it in result URLs.
			task.PrivateData.OutputSource = taskResult.Url
			task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		} else if taskResult.Url != "" {
			// Direct upstream URL (e.g. Kling, Ali, Doubao, etc.)
			task.PrivateData.ResultURL = taskResult.Url
		} else {
			// No URL from adaptor — construct proxy URL using public task ID
			task.PrivateData.ResultURL = taskcommon.BuildProxyURL(task.TaskID)
		}
		shouldSettle = true
	case model.TaskStatusFailure:
		logger.LogJson(ctx, fmt.Sprintf("Task %s failed", taskId), task)
		task.Status = model.TaskStatusFailure
		task.Progress = taskcommon.ProgressComplete
		if task.FinishTime == 0 {
			task.FinishTime = now
		}
		task.FailReason = taskResult.Reason
		logger.LogInfo(ctx, fmt.Sprintf("Task %s failed: %s", task.TaskID, task.FailReason))
		taskResult.Progress = taskcommon.ProgressComplete
		if quota != 0 {
			shouldRefund = true
		}
	default:
		return fmt.Errorf("unknown task status %s for task %s", taskResult.Status, task.TaskID)
	}
	if taskResult.Progress != "" {
		task.Progress = taskResult.Progress
	}

	isDone := task.Status == model.TaskStatusSuccess || task.Status == model.TaskStatusFailure
	if shouldSettle {
		task.PrivateData.CompletionBilling = &model.TaskCompletionBilling{TotalTokens: taskResult.TotalTokens}
		if bc := task.PrivateData.BillingContext; bc == nil || !bc.PerCallBilling {
			task.PrivateData.CompletionBilling.Quota = adaptor.AdjustBillingOnComplete(task, taskResult)
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if isDone && snap.Status != task.Status {
		won, err := task.UpdateIfUnchanged(snap)
		if err != nil {
			logger.LogError(ctx, fmt.Sprintf("Conditional update failed for task %s: %s", task.TaskID, err.Error()))
			shouldRefund = false
			shouldSettle = false
		} else if !won {
			logger.LogWarn(ctx, fmt.Sprintf("Task %s already transitioned by another process, skip billing", task.TaskID))
			shouldRefund = false
			shouldSettle = false
		}
	} else if !snap.Equal(task.Snapshot()) {
		if _, err := task.UpdateIfUnchanged(snap); err != nil {
			logger.LogError(ctx, fmt.Sprintf("Failed to update task %s: %s", task.TaskID, err.Error()))
		}
	} else {
		// No changes, skip update
		logger.LogDebug(ctx, "No update needed for task %s", task.TaskID)
	}

	if shouldSettle {
		settleTaskBillingOnComplete(ctx, adaptor, task, taskResult)
	}
	if shouldRefund {
		RefundTaskQuota(ctx, task, task.FailReason)
	}
	// Successful tasks are durable output work; storage runs independently of polling/billing.

	return nil
}

// QueuePlaygroundVideoOutputReconciliation retains the callback API without
// launching unbounded goroutines. The successful task itself is the durable queue.
func QueuePlaygroundVideoOutputReconciliation(taskID string, userID int, videoURL string) {
	// Linking may happen after reconciliation already finished.
	if task, exists, err := model.GetByTaskId(userID, taskID); err == nil && exists && task.OutputAssetID > 0 {
		_ = model.DB.Model(&model.PlaygroundRun{}).Where("task_id = ? AND user_id = ? AND asset_id = 0", taskID, userID).
			Updates(map[string]any{"asset_id": task.OutputAssetID, "result_url": fmt.Sprintf("/api/playground/assets/%d/content", task.OutputAssetID)}).Error
	}
}

var videoOutputCapacity = make(chan struct{}, 1)

// RunVideoOutputReconciliation handles at most eight tasks in five minutes,
// sequentially (one download per process). Cross-process claims expire after
// the transfer deadline plus one minute. A fixed rollout cutoff avoids downloading the historical corpus
// without aging queued/retrying work out when the scheduler is offline.
func RunVideoOutputReconciliation(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	select {
	case videoOutputCapacity <- struct{}{}:
		defer func() { <-videoOutputCapacity }()
	case <-ctx.Done():
		return ctx.Err()
	}
	// Repair late Playground links even after the task's output is complete.
	var runs []model.PlaygroundRun
	if err := model.DB.WithContext(ctx).Table("playground_runs").Select("playground_runs.*").
		Joins("JOIN tasks ON tasks.task_id = playground_runs.task_id AND tasks.user_id = playground_runs.user_id").
		Where("playground_runs.asset_id = 0 AND tasks.output_asset_id > 0").Order("playground_runs.id").Limit(8).Scan(&runs).Error; err != nil {
		return err
	}
	for _, run := range runs {
		QueuePlaygroundVideoOutputReconciliation(run.TaskId, run.UserId, "")
	}
	var tasks []*model.Task
	query := model.DB.WithContext(ctx).Where("status = ? AND output_asset_id = 0 AND output_next_at <= ?", model.TaskStatusSuccess, time.Now().Unix()).
		Where("finish_time >= ? OR created_at >= ?", int64(1790380800), int64(1790380800)). // 2026-09-26 UTC rollout.
		Where("platform NOT IN ?", []constant.TaskPlatform{constant.TaskPlatformSuno, constant.TaskPlatformMidjourney})
	// Reserve one slot for the oldest due item, but process fresh completions
	// first so historical URLs timing out cannot monopolize the rollout queue.
	var oldest []*model.Task
	if err := query.Session(&gorm.Session{}).Order("output_next_at").Order("id").Limit(1).Find(&oldest).Error; err != nil {
		return err
	}
	if len(oldest) == 0 {
		return nil
	}
	if err := query.Session(&gorm.Session{}).Where("id != ?", oldest[0].ID).
		Order("output_next_at").Order("finish_time DESC").Order("id DESC").Limit(7).Find(&tasks).Error; err != nil {
		return err
	}
	tasks = append(tasks, oldest[0])
	for _, task := range tasks {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		persistVideoTaskOutput(ctx, task, "")
	}
	return ctx.Err()
}

func persistVideoTaskOutput(ctx context.Context, task *model.Task, preferredURL string) {
	if task == nil || task.OutputAssetID != 0 {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, VideoOutputTransferTimeout)
	defer cancel()
	lease := time.Now().Add(VideoOutputTransferTimeout + time.Minute).Unix()
	claim := model.DB.WithContext(ctx).Model(&model.Task{}).
		Where("id = ? AND output_asset_id = 0 AND output_next_at <= ? AND output_attempts = ?", task.ID, time.Now().Unix(), task.OutputAttempts).
		Updates(map[string]any{"output_next_at": lease, "output_attempts": task.OutputAttempts + 1})
	if claim.Error != nil || claim.RowsAffected == 0 {
		return
	}
	// Failure never changes task status, quota, or the upstream generation.
	defer func() {
		retryCtx, cancelRetry := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelRetry()
		delay := int64(30) << max(0, min(task.OutputAttempts, 10))
		delay = min(delay, int64(6*60*60))
		model.DB.WithContext(retryCtx).Model(&model.Task{}).Where("id = ? AND output_asset_id = 0 AND output_next_at = ? AND output_attempts = ?", task.ID, lease, task.OutputAttempts+1).
			Update("output_next_at", time.Now().Unix()+delay)
	}()
	videoURL := strings.TrimSpace(preferredURL)
	if videoURL == "" {
		videoURL = strings.TrimSpace(task.PrivateData.OutputSource)
	}
	if videoURL == "" {
		videoURL = strings.TrimSpace(task.GetResultURL())
	}
	var asset *model.PlaygroundAsset
	var err error
	// Adopt already-persisted Playground output rather than duplicating it.
	if existing, lookupErr := model.GetPlaygroundRunByTaskId(task.TaskID, task.UserId); lookupErr == nil && existing.AssetId > 0 {
		asset, err = model.GetPlaygroundAsset(existing.AssetId, task.UserId)
		if err != nil {
			return
		}
	}
	newAsset := asset == nil
	isPersistableRef := strings.HasPrefix(videoURL, "data:") || strings.HasPrefix(videoURL, "http://") || strings.HasPrefix(videoURL, "https://")
	isDoubao := task.Platform == constant.TaskPlatform(fmt.Sprint(constant.ChannelTypeDoubaoVideo))
	if newAsset {
		if !isDoubao && isPersistableRef && !strings.Contains(videoURL, "/v1/videos/"+task.TaskID+"/content") {
			asset, err = PersistPlaygroundOutput(ctx, task.UserId, "video", videoURL)
		} else {
			asset, err = persistProviderVideoOutput(ctx, task.UserId, task, videoURL)
		}
	}
	if err != nil {
		common.SysError(fmt.Sprintf("video output persistence failed for task %s (attempt %d)", task.TaskID, task.OutputAttempts+1))
		return
	}
	if asset == nil {
		return
	}
	contentURL := fmt.Sprintf("/api/playground/assets/%d/content", asset.Id)
	err = model.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.Task{}).Where("id = ? AND output_asset_id = 0 AND output_next_at = ? AND output_attempts = ?", task.ID, lease, task.OutputAttempts+1).
			Updates(map[string]any{"output_asset_id": asset.Id, "output_next_at": 0})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(asset).Update("url", contentURL).Error; err != nil {
			return err
		}
		return tx.Model(&model.PlaygroundRun{}).Where("task_id = ? AND user_id = ? AND asset_id = 0", task.TaskID, task.UserId).
			Updates(map[string]any{"asset_id": asset.Id, "result_url": contentURL}).Error
	})
	if err != nil && newAsset {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelCleanup()
		if store, storeErr := storage.ForBackend(asset.Backend); storeErr == nil {
			if deleteErr := store.Delete(cleanupCtx, asset.StorageKey); deleteErr == nil {
				_ = model.DB.WithContext(cleanupCtx).Where("id = ? AND user_id = ?", asset.Id, task.UserId).Delete(&model.PlaygroundAsset{}).Error
			}
		}
	}
}

func persistProviderVideoOutput(ctx context.Context, userID int, task *model.Task, resultURL string) (*model.PlaygroundAsset, error) {
	ctx, cancel := context.WithTimeout(ctx, VideoOutputTransferTimeout)
	defer cancel()
	channel, err := model.CacheGetChannel(task.ChannelId)
	if err != nil {
		return nil, err
	}
	key := strings.TrimSpace(task.PrivateData.Key)
	if key == "" {
		key = channel.Key
	}
	baseURL := strings.TrimRight(channel.GetBaseURL(), "/")
	if baseURL == "" {
		baseURL = strings.TrimRight(constant.ChannelBaseURLs[channel.Type], "/")
	}
	contentURL := fmt.Sprintf("%s/v1/videos/%s/content", baseURL, task.GetUpstreamTaskID())
	xaiRelativeOutput := false
	if task.Platform == constant.TaskPlatform(fmt.Sprint(constant.ChannelTypeXai)) {
		parsed, parseErr := url.Parse(resultURL)
		if parseErr == nil && !parsed.IsAbs() && parsed.Host == "" && strings.HasPrefix(parsed.Path, "/") {
			base, baseErr := url.Parse(baseURL)
			if baseErr != nil {
				return nil, baseErr
			}
			contentURL = base.ResolveReference(parsed).String()
			xaiRelativeOutput = true
		}
	}
	if channel.Type == constant.ChannelTypeDoubaoVideo {
		contentURL = fmt.Sprintf("%s/v1/videos/%s/content", baseURL, url.PathEscape(task.GetUpstreamTaskID()))
		// Only this exact operator-managed endpoint may receive the task key.
		// Signed external media URLs must retain strict unauthenticated fetching.
		if resultURL != contentURL {
			return PersistPlaygroundOutput(ctx, userID, "video", resultURL)
		}
	}
	if xaiRelativeOutput || channel.Type == constant.ChannelTypeOpenAI || channel.Type == constant.ChannelTypeDoubaoVideo || channel.Type == constant.ChannelTypeSora {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, contentURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		channelSetting := channel.GetSetting()
		client := GetHttpClient()
		if channelSetting.Proxy != "" || NormalizeHTTPTransportPolicy(channelSetting) != defaultHTTPTransportPolicy() {
			client, err = GetHttpClientWithProxySettings(channelSetting.Proxy, channelSetting)
			if err != nil {
				return nil, err
			}
		}
		// Do not mutate shared clients or forward provider keys through redirects.
		boundedClient := *client
		boundedClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		client = &boundedClient
		return PersistPlaygroundOutputRequest(ctx, userID, "video", req, client)
	}

	if GetTaskAdaptorFunc == nil {
		return nil, fmt.Errorf("task adaptor is not initialized")
	}
	adaptor := GetTaskAdaptorFunc(task.Platform)
	if adaptor == nil {
		return nil, fmt.Errorf("task adaptor is not available")
	}
	contextAdaptor, ok := adaptor.(contextTaskPollingAdaptor)
	if !ok {
		return nil, fmt.Errorf("task adaptor does not support bounded reconciliation fetch")
	}
	resp, err := contextAdaptor.FetchTaskWithContext(ctx, baseURL, key, map[string]any{
		"task_id": task.GetUpstreamTaskID(),
		"action":  task.Action,
	}, channel.GetSetting().Proxy)
	if err != nil {
		return nil, err
	}
	body, err := readPollingResponse(resp)
	if err != nil {
		return nil, err
	}
	info, err := adaptor.ParseTaskResult(body)
	if err != nil || info == nil {
		return nil, fmt.Errorf("parse completed video task failed: %w", err)
	}
	resultURL = strings.TrimSpace(info.Url)
	if resultURL == "" {
		resultURL = strings.TrimSpace(info.RemoteUrl)
		if resultURL != "" && channel.Type == constant.ChannelTypeGemini {
			parsed, parseErr := url.Parse(resultURL)
			if parseErr != nil {
				return nil, parseErr
			}
			query := parsed.Query()
			query.Set("key", key)
			parsed.RawQuery = query.Encode()
			resultURL = parsed.String()
		}
	}
	if resultURL == "" {
		return nil, fmt.Errorf("completed video task has no media result")
	}
	return PersistPlaygroundOutput(ctx, userID, "video", resultURL)
}

func redactVideoResponseBody(body []byte, platform constant.TaskPlatform) []byte {
	isXAI := platform == constant.TaskPlatform(fmt.Sprintf("%d", constant.ChannelTypeXai))
	var m map[string]any
	if err := common.Unmarshal(body, &m); err != nil {
		if isXAI {
			return []byte(`{"redacted":true}`)
		}
		return body
	}
	if isXAI {
		safe := map[string]any{"redacted": true}
		if status, ok := m["status"].(string); ok {
			safe["status"] = status
		}
		if video, ok := m["video"].(map[string]any); ok {
			safeVideo := map[string]any{}
			if duration, ok := video["duration"]; ok {
				safeVideo["duration"] = duration
			}
			if respectModeration, ok := video["respect_moderation"]; ok {
				safeVideo["respect_moderation"] = respectModeration
			}
			if len(safeVideo) > 0 {
				safe["video"] = safeVideo
			}
		}
		b, err := common.Marshal(safe)
		if err != nil {
			return []byte(`{"redacted":true}`)
		}
		return b
	}
	resp, _ := m["response"].(map[string]any)
	if resp != nil {
		delete(resp, "bytesBase64Encoded")
		if v, ok := resp["video"].(string); ok {
			resp["video"] = truncateBase64(v)
		}
		if vs, ok := resp["videos"].([]any); ok {
			for i := range vs {
				if vm, ok := vs[i].(map[string]any); ok {
					delete(vm, "bytesBase64Encoded")
				}
			}
		}
	}
	b, err := common.Marshal(m)
	if err != nil {
		return nil
	}
	return b
}

func truncateBase64(s string) string {
	const maxKeep = 256
	if len(s) <= maxKeep {
		return s
	}
	return s[:maxKeep] + "..."
}

// settleTaskBillingOnComplete 任务完成时的统一计费调整。
// 优先级：1. adaptor.AdjustBillingOnComplete 返回正数 → 使用 adaptor 计算的额度
//
//  2. taskResult.TotalTokens > 0 → 按 token 重算
//  3. 都不满足 → 保持预扣额度不变
func settleTaskBillingOnComplete(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, taskResult *relaycommon.TaskInfo) {
	// 0. 按次计费的任务不做差额结算
	if bc := task.PrivateData.BillingContext; bc != nil && bc.PerCallBilling {
		logger.LogInfo(ctx, fmt.Sprintf("任务 %s 按次计费，跳过差额结算", task.TaskID))
		_, _ = settleTaskBillingOperation(task, task.Quota)
		return
	}
	completion := task.PrivateData.CompletionBilling
	if completion == nil {
		completion = &model.TaskCompletionBilling{}
		if adaptor != nil {
			completion.Quota = adaptor.AdjustBillingOnComplete(task, taskResult)
		}
		if taskResult != nil {
			completion.TotalTokens = taskResult.TotalTokens
		}
	}
	// 1. 优先让 adaptor 决定最终额度
	if actualQuota := completion.Quota; actualQuota > 0 {
		RecalculateTaskQuota(ctx, task, actualQuota, "adaptor计费调整")
		return
	}
	// 2. 回退到 token 重算
	if completion.TotalTokens > 0 && RecalculateTaskQuotaByTokens(ctx, task, completion.TotalTokens) {
		return
	}
	// 3. 无调整，保持预扣额度
	if _, err := settleTaskBillingOperation(task, task.Quota); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("settle task %s: %v", task.TaskID, err))
	}
}
