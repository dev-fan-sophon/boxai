package boxai

// Connect is an independent Go module and cannot import the server's common
// package. Keep its wire encoding boundary here, separate from business logic.
import "encoding/json"

func marshal(v any) ([]byte, error)   { return json.Marshal(v) }
func unmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }
