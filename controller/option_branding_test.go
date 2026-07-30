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
		{name: "white disappears on light canvas", color: "#FFFFFF", want: false},
		{name: "black disappears on dark canvas", color: "#000000", want: false},
		{name: "bright cyan disappears on light canvas", color: "#22D3EE", want: false},
		// Too dim for white text (3.18:1) but reaches 5.37:1 against the dark
		// label the frontend derives for it.
		{name: "amber is usable with a dark label", color: "#D97706", want: true},
		{name: "invalid hex", color: "#12345G", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, test.want, isAccessibleBrandPrimary(test.color))
		})
	}
}
