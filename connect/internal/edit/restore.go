package edit

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/pelletier/go-toml/v2"
	"github.com/tidwall/jsonc"
)

func RestoreBytes(path string, original, applied, current []byte) ([]byte, error) {
	if bytes.Equal(current, applied) {
		return bytes.Clone(original), nil
	}
	if bytes.Equal(original, applied) {
		return bytes.Clone(current), nil
	}
	ext := filepath.Ext(path)
	if filepath.Base(path) == ".env" {
		return restoreEnv(original, applied, current)
	}
	if ext != ".json" && ext != ".jsonc" && ext != ".toml" {
		return nil, fmt.Errorf("external edits prevent automatic restore: %s; preserve backups and resolve changes", path)
	}
	decode := func(b []byte) (map[string]any, error) {
		m := map[string]any{}
		if b == nil {
			return m, nil
		}
		var err error
		if ext == ".toml" {
			err = toml.Unmarshal(b, &m)
		} else {
			dec := json.NewDecoder(bytes.NewReader(jsonc.ToJSON(b)))
			dec.UseNumber()
			err = dec.Decode(&m)
		}
		if m == nil && err == nil {
			err = fmt.Errorf("expected object")
		}
		return m, err
	}
	o, e := decode(original)
	if e != nil {
		return nil, e
	}
	a, e := decode(applied)
	if e != nil {
		return nil, e
	}
	c, e := decode(current)
	if e != nil {
		return nil, e
	}
	if e = restoreObject(o, a, c); e != nil {
		return nil, fmt.Errorf("%s: %w", path, e)
	}
	if ext == ".toml" {
		return toml.Marshal(c)
	}
	return json.MarshalIndent(c, "", "  ")
}

func restoreEnv(original, applied, current []byte) ([]byte, error) {
	parse := func(b []byte) (map[string]any, error) {
		m := map[string]any{}
		for _, l := range splitLines(string(b)) {
			if match := envLine.FindStringSubmatch(l); match != nil {
				if _, ok := m[match[1]]; ok {
					return nil, fmt.Errorf("duplicate dotenv key %s; manual restore required", match[1])
				}
				m[match[1]] = l
			}
		}
		return m, nil
	}
	o, e := parse(original)
	if e != nil {
		return nil, e
	}
	a, e := parse(applied)
	if e != nil {
		return nil, e
	}
	c, e := parse(current)
	if e != nil {
		return nil, e
	}
	if e = restoreObject(o, a, c); e != nil {
		return nil, e
	}
	var lines []string
	for _, line := range splitLines(string(current)) {
		m := envLine.FindStringSubmatch(line)
		if m == nil {
			lines = append(lines, line)
			continue
		}
		if v, ok := c[m[1]]; ok {
			lines = append(lines, v.(string))
			delete(c, m[1])
		}
	}
	for _, line := range splitLines(string(original)) {
		m := envLine.FindStringSubmatch(line)
		if m != nil {
			if v, ok := c[m[1]]; ok {
				lines = append(lines, v.(string))
				delete(c, m[1])
			}
		}
	}
	return []byte(strings.Join(lines, "\n") + "\n"), nil
}
func restoreObject(original, applied, current map[string]any) error {
	keys := map[string]bool{}
	for k := range original {
		keys[k] = true
	}
	for k := range applied {
		keys[k] = true
	}
	for k := range keys {
		o, ook := original[k]
		a, aok := applied[k]
		c, cok := current[k]
		if ook == aok && reflect.DeepEqual(o, a) {
			continue
		}
		if aok == cok && reflect.DeepEqual(a, c) {
			if ook {
				current[k] = o
			} else {
				delete(current, k)
			}
			continue
		}
		om, oMap := o.(map[string]any)
		am, aMap := a.(map[string]any)
		cm, cMap := c.(map[string]any)
		if !ook {
			om = map[string]any{}
			oMap = true
		}
		if !aok {
			am = map[string]any{}
			aMap = true
		}
		if oMap && aMap && cMap {
			if err := restoreObject(om, am, cm); err != nil {
				return err
			}
			continue
		}
		return fmt.Errorf("owned key %s was externally edited; not overwritten", k)
	}
	return nil
}
