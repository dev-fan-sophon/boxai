package aws

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream/eventstreamapi"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/dev-fan-sophon/boxai/common"
	"github.com/dev-fan-sophon/boxai/dto"
	relaycommon "github.com/dev-fan-sophon/boxai/relay/common"
	"github.com/dev-fan-sophon/boxai/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const awsTestModel = "anthropic.claude-3-5-sonnet-20240620-v1:0"

type awsHTTPClientFunc func(*http.Request) (*http.Response, error)

func (f awsHTTPClientFunc) Do(request *http.Request) (*http.Response, error) {
	return f(request)
}

func newAwsTestClient(httpClient bedrockruntime.HTTPClient) *bedrockruntime.Client {
	return bedrockruntime.New(bedrockruntime.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String("https://bedrock.test"),
		Credentials: aws.NewCredentialsCache(credentials.NewStaticCredentialsProvider(
			"access-key", "secret-key", "",
		)),
		HTTPClient: httpClient,
		Retryer:    aws.NopRetryer{},
	})
}

func newAwsTestContext(writer http.ResponseWriter, requestContext context.Context) *gin.Context {
	c, _ := gin.CreateTestContext(writer)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(requestContext)
	return c
}

func newAwsTestRelayInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		StartTime:          time.Now(),
		IsStream:           true,
		OriginModelName:    awsTestModel,
		RelayFormat:        types.RelayFormatOpenAI,
		ShouldIncludeUsage: true,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: awsTestModel,
		},
	}
}

func newAwsInvokeModelInput() *bedrockruntime.InvokeModelInput {
	return &bedrockruntime.InvokeModelInput{
		ModelId:     aws.String(awsTestModel),
		Body:        []byte(`{}`),
		Accept:      aws.String("application/json"),
		ContentType: aws.String("application/json"),
	}
}

func newAwsStreamInput() *bedrockruntime.InvokeModelWithResponseStreamInput {
	return &bedrockruntime.InvokeModelWithResponseStreamInput{
		ModelId:     aws.String(awsTestModel),
		Body:        []byte(`{}`),
		Accept:      aws.String("application/json"),
		ContentType: aws.String("application/json"),
	}
}

func writeAwsStreamEvent(writer io.Writer, data string) error {
	payload, err := common.Marshal(struct {
		Bytes []byte `json:"bytes"`
	}{Bytes: []byte(data)})
	if err != nil {
		return err
	}
	return eventstream.NewEncoder().Encode(writer, eventstream.Message{
		Headers: eventstream.Headers{
			{Name: eventstreamapi.MessageTypeHeader, Value: eventstream.StringValue(eventstreamapi.EventMessageType)},
			{Name: eventstreamapi.EventTypeHeader, Value: eventstream.StringValue("chunk")},
			{Name: eventstreamapi.ContentTypeHeader, Value: eventstream.StringValue("application/json")},
		},
		Payload: payload,
	})
}

func newAwsStreamResponse(request *http.Request, body io.ReadCloser) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header: http.Header{
			"Content-Type":                []string{"application/vnd.amazon.eventstream"},
			"X-Amzn-Bedrock-Content-Type": []string{"application/json"},
		},
		Body:    body,
		Request: request,
	}
}

type awsNotifyingResponseWriter struct {
	*httptest.ResponseRecorder
	needle   []byte
	notified chan struct{}
	once     sync.Once
}

func (w *awsNotifyingResponseWriter) Write(data []byte) (int, error) {
	return w.ResponseRecorder.Write(data)
}

func (w *awsNotifyingResponseWriter) Flush() {
	w.ResponseRecorder.Flush()
	if bytes.Contains(w.Body.Bytes(), w.needle) {
		w.once.Do(func() { close(w.notified) })
	}
}

func TestDoAwsClientRequest_AppliesRuntimeHeaderOverrideToAnthropicBeta(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)

	info := &relaycommon.RelayInfo{
		OriginModelName:           "claude-3-5-sonnet-20240620",
		IsStream:                  false,
		UseRuntimeHeadersOverride: true,
		RuntimeHeadersOverride: map[string]any{
			"anthropic-beta": "computer-use-2025-01-24",
		},
		ChannelMeta: &relaycommon.ChannelMeta{
			ApiKey:            "access-key|secret-key|us-east-1",
			UpstreamModelName: "claude-3-5-sonnet-20240620",
		},
	}

	requestBody := bytes.NewBufferString(`{"messages":[{"role":"user","content":"hello"}],"max_tokens":128}`)
	adaptor := &Adaptor{}

	_, err := doAwsClientRequest(ctx, info, adaptor, requestBody)
	require.NoError(t, err)

	awsReq, ok := adaptor.AwsReq.(*bedrockruntime.InvokeModelInput)
	require.True(t, ok)

	var payload map[string]any
	require.NoError(t, common.Unmarshal(awsReq.Body, &payload))

	anthropicBeta, exists := payload["anthropic_beta"]
	require.True(t, exists)

	values, ok := anthropicBeta.([]any)
	require.True(t, ok)
	require.Equal(t, []any{"computer-use-2025-01-24"}, values)
}

func TestNewAwsInvokeContextInheritsParent(t *testing.T) {
	originalTimeout := common.RelayTimeout
	t.Cleanup(func() { common.RelayTimeout = originalTimeout })

	for _, relayTimeout := range []int{0, 30} {
		common.RelayTimeout = relayTimeout
		parent, cancelParent := context.WithCancel(context.Background())
		invokeContext, cancelInvoke := newAwsInvokeContext(parent)
		cancelParent()
		require.ErrorIs(t, invokeContext.Err(), context.Canceled)
		cancelInvoke()
	}
}

func TestNewAwsInvokeErrorSkipsRetryOnlyForRequestCancellation(t *testing.T) {
	canceledContext, cancel := context.WithCancel(context.Background())
	cancel()

	tests := []struct {
		name          string
		ctx           context.Context
		err           error
		wantSkipRetry bool
	}{
		{name: "request canceled", ctx: canceledContext, err: context.Canceled, wantSkipRetry: true},
		{name: "relay timeout", ctx: context.Background(), err: context.DeadlineExceeded},
		{name: "upstream failure", ctx: context.Background(), err: errors.New("upstream failed")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			apiErr := newAwsInvokeError(test.ctx, test.err, "InvokeModel")
			assert.Equal(t, test.wantSkipRetry, types.IsSkipRetryError(apiErr))
		})
	}
}

func TestAwsHandlersCancelSDKRequestAndSkipRetry(t *testing.T) {
	originalTimeout := common.RelayTimeout
	common.RelayTimeout = 0
	t.Cleanup(func() { common.RelayTimeout = originalTimeout })

	tests := []struct {
		name    string
		request any
		handle  func(*gin.Context, *relaycommon.RelayInfo, *Adaptor) (*types.NewAPIError, *dto.Usage)
	}{
		{name: "non-stream", request: newAwsInvokeModelInput(), handle: awsHandler},
		{name: "stream", request: newAwsStreamInput(), handle: awsStreamHandler},
		{name: "nova", request: newAwsInvokeModelInput(), handle: handleNovaRequest},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			requestContext, cancelRequest := context.WithCancel(context.Background())
			upstreamContexts := make(chan context.Context, 1)
			client := newAwsTestClient(awsHTTPClientFunc(func(request *http.Request) (*http.Response, error) {
				upstreamContexts <- request.Context()
				<-request.Context().Done()
				return nil, request.Context().Err()
			}))
			adaptor := &Adaptor{AwsClient: client, AwsReq: test.request}
			c := newAwsTestContext(httptest.NewRecorder(), requestContext)

			type result struct {
				err   *types.NewAPIError
				usage *dto.Usage
			}
			results := make(chan result, 1)
			go func() {
				err, usage := test.handle(c, newAwsTestRelayInfo(), adaptor)
				results <- result{err: err, usage: usage}
			}()

			var upstreamContext context.Context
			select {
			case upstreamContext = <-upstreamContexts:
			case <-time.After(5 * time.Second):
				t.Fatal("AWS request did not start")
			}
			cancelRequest()

			select {
			case got := <-results:
				require.ErrorIs(t, upstreamContext.Err(), context.Canceled)
				require.NotNil(t, got.err)
				assert.True(t, types.IsSkipRetryError(got.err))
				assert.Nil(t, got.usage)
			case <-time.After(5 * time.Second):
				t.Fatal("AWS handler did not stop after request cancellation")
			}
		})
	}
}

func TestAwsStreamHandlerStopsAfterRequestCancellation(t *testing.T) {
	originalTimeout := common.RelayTimeout
	common.RelayTimeout = 0
	t.Cleanup(func() { common.RelayTimeout = originalTimeout })

	requestContext, cancelRequest := context.WithCancel(context.Background())
	t.Cleanup(cancelRequest)
	releaseProducer := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseProducer) }) }
	t.Cleanup(release)
	producerResult := make(chan error, 1)
	client := newAwsTestClient(awsHTTPClientFunc(func(request *http.Request) (*http.Response, error) {
		reader, writer := io.Pipe()
		go func() {
			defer writer.Close()
			for _, event := range []string{
				`{"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"claude-test","content":[],"usage":{"input_tokens":100,"output_tokens":1}}}`,
				`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
				`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}`,
			} {
				if err := writeAwsStreamEvent(writer, event); err != nil {
					producerResult <- err
					return
				}
			}
			<-releaseProducer
			producerResult <- writeAwsStreamEvent(writer, `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":423}}`)
		}()
		return newAwsStreamResponse(request, reader), nil
	}))

	writer := &awsNotifyingResponseWriter{
		ResponseRecorder: httptest.NewRecorder(),
		needle:           []byte("partial"),
		notified:         make(chan struct{}),
	}
	c := newAwsTestContext(writer, requestContext)
	adaptor := &Adaptor{AwsClient: client, AwsReq: newAwsStreamInput()}

	type result struct {
		err   *types.NewAPIError
		usage *dto.Usage
	}
	results := make(chan result, 1)
	go func() {
		err, usage := awsStreamHandler(c, newAwsTestRelayInfo(), adaptor)
		results <- result{err: err, usage: usage}
	}()

	select {
	case <-writer.notified:
	case <-time.After(5 * time.Second):
		t.Fatal("partial stream response was not written")
	}
	responseBeforeCancel := writer.Body.String()
	cancelRequest()

	select {
	case got := <-results:
		require.Nil(t, got.err)
		require.NotNil(t, got.usage)
		assert.Equal(t, 100, got.usage.PromptTokens)
		require.NotNil(t, got.usage.BillingUsage)
		require.NotNil(t, got.usage.BillingUsage.ClaudeUsage)
		assert.Equal(t, 1, got.usage.BillingUsage.ClaudeUsage.OutputTokens)
		assert.Equal(t, responseBeforeCancel, writer.Body.String())
	case <-time.After(5 * time.Second):
		t.Fatal("stream handler did not stop after request cancellation")
	}

	release()
	select {
	case err := <-producerResult:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("stream producer did not observe cancellation")
	}
}
