package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAccessibleBrandPrimary(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		color string
		want  bool
	}{
		{name: "Box AI blue", color: "#2563EB", want: true},
		{name: "accessible green", color: "#047857", want: true},
		{name: "white loses button foreground", color: "#FFFFFF", want: false},
		{name: "black disappears on dark canvas", color: "#000000", want: false},
		{name: "cyan lacks white text contrast", color: "#22D3EE", want: false},
		{name: "invalid hex", color: "#12345G", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, test.want, isAccessibleBrandPrimary(test.color))
		})
	}
}
