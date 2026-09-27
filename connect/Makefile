VERSION := $(shell python3 -c 'import json; print(json.load(open("release-metadata.json"))["version"])')
LDFLAGS = -s -w -X main.version=$(VERSION)
TAGS = production
ifeq ($(shell uname -s),Darwin)
export CGO_CFLAGS = -mmacosx-version-min=12.0
export CGO_LDFLAGS = -mmacosx-version-min=12.0
endif
ifeq ($(shell uname -s),Linux)
TAGS += gtk3
endif

.PHONY: build cli test dev stage clean
build:
	go build -tags "$(TAGS)" -trimpath -ldflags="$(LDFLAGS)" -o dist/boxai-connect .

cli:
	CGO_ENABLED=0 go build -tags nogui -trimpath -ldflags="$(LDFLAGS)" -o dist/boxai-connect .

test:
	go vet -tags "$(TAGS)" ./...
	go test -tags "$(TAGS)" ./...
	python3 -m unittest discover -s packaging -p '*_test.py'

dev:
	go run -tags "dev $(filter gtk3,$(TAGS))" . app

stage:
	bash packaging/macos/stage-release.sh

clean:
	rm -rf dist rsrc_windows_*.syso
