package system_setting

var ServerAddress = "http://localhost:3000"

// ApiBaseAddress is the API origin shown to users for SDK and client setup.
// Empty falls back to ServerAddress. It may point at a host that skips the
// CDN edge so long non-streaming requests are not cut by its timeout.
var ApiBaseAddress = ""
var WorkerUrl = ""
var WorkerValidKey = ""
var WorkerAllowHttpImageRequestEnabled = false

func EnableWorker() bool {
	return WorkerUrl != ""
}
