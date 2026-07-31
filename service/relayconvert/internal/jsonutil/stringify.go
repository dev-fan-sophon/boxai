package jsonutil

import (
	"fmt"

	"github.com/dev-fan-sophon/boxai/common"
)

func ToJSONString(v interface{}) string {
	bytes, err := common.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(bytes)
}
