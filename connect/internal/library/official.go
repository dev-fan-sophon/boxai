package library

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	archivepath "path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
)

// Official metadata is supplied from authenticated, validated provisioning.
// URLs and authorization values are intentionally absent: the application
// fetch callback holds them in memory, and the native vault owns the root key.
type OfficialSkill struct {
	ID, Name, Version, SHA256, Format string
	SizeBytes                         int64
}
type OfficialMCP struct{ ID, Name, Description string }
type OfficialCatalog struct {
	Skills     []OfficialSkill
	MCPServers []OfficialMCP
}
type SkillFetcher func(id string) ([]byte, error)
type MCPResolver func(id string) (Server, error)

func ClearOfficialCatalog() { _ = SetOfficialCatalog(OfficialCatalog{}, nil, nil) }

var official struct {
	sync.RWMutex
	catalog OfficialCatalog
	fetch   SkillFetcher
	mcp     MCPResolver
}

// SetOfficialCatalog replaces the session's in-memory catalog. An empty
// catalog clears it on logout. Neither metadata nor credentials are cached.
func SetOfficialCatalog(c OfficialCatalog, fetch SkillFetcher, mcp MCPResolver) error {
	seen := map[string]bool{}
	for _, s := range c.Skills {
		if !safeName(s.ID) || seen["skill:"+s.ID] || s.SizeBytes <= 0 || s.SizeBytes > 16<<20 {
			return errors.New("invalid official skill metadata")
		}
		if s.Format != "tar.gz" && s.Format != "zip" {
			return errors.New("unsupported official skill archive format")
		}
		d, e := hex.DecodeString(s.SHA256)
		if e != nil || len(d) != sha256.Size {
			return errors.New("official skill requires SHA-256 digest")
		}
		seen["skill:"+s.ID] = true
	}
	for _, s := range c.MCPServers {
		if !safeName(s.ID) || seen["mcp:"+s.ID] {
			return errors.New("invalid official MCP identity")
		}
		seen["mcp:"+s.ID] = true
	}
	official.Lock()
	defer official.Unlock()
	official.catalog = OfficialCatalog{Skills: append([]OfficialSkill(nil), c.Skills...), MCPServers: append([]OfficialMCP(nil), c.MCPServers...)}
	official.fetch = fetch
	official.mcp = mcp
	return nil
}
func safeName(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func MarketServers(q string) ([]MarketServer, error) {
	official.RLock()
	defer official.RUnlock()
	out := []MarketServer{}
	for _, m := range official.catalog.MCPServers {
		if strings.Contains(strings.ToLower(m.Name+" "+m.Description+" "+m.ID), strings.ToLower(q)) {
			out = append(out, MarketServer{ID: m.ID, Name: m.Name, Title: m.Name, Description: m.Description, Publisher: "BoxAI", Transport: "http", Featured: true, Inputs: []Input{}})
		}
	}
	return out, nil
}
func MarketSkills(q string) ([]MarketSkill, error) {
	official.RLock()
	defer official.RUnlock()
	out := []MarketSkill{}
	for _, s := range official.catalog.Skills {
		if strings.Contains(strings.ToLower(s.Name+" "+s.ID), strings.ToLower(q)) {
			out = append(out, MarketSkill{ID: s.ID, Source: "boxai", SkillID: s.ID, Name: s.Name, Official: true})
		}
	}
	return out, nil
}
func InstallServer(id string, values map[string]string, agents []string) (*Result, error) {
	if !agent.Authenticated() {
		return nil, errors.New("sign in to BoxAI before installing MCP servers")
	}
	official.RLock()
	resolve := official.mcp
	found := false
	for _, m := range official.catalog.MCPServers {
		if m.ID == id {
			found = true
		}
	}
	official.RUnlock()
	if !found || resolve == nil {
		return nil, errors.New("MCP server not present in validated BoxAI provisioning")
	}
	s, err := resolve(id)
	if err != nil {
		return nil, errors.New("official MCP resolution failed; refresh BoxAI sign-in")
	}
	// Only a local gateway credential may enter an agent file. The gateway
	// forwards the official upstream Authorization from the native session.
	u, err := url.Parse(s.URL)
	if err != nil || u.Scheme != "http" || s.URL != gateway.URL()+"/mcp/"+id {
		return nil, errors.New("official MCP must use the authenticated local BoxAI gateway")
	}
	if len(s.Headers) != 1 || s.Headers["Authorization"] != "Bearer "+gateway.Credential() || gateway.Credential() == "" {
		return nil, errors.New("official MCP must use only the local gateway credential")
	}
	s.Name = id
	s.Transport = "http"
	s.Command = ""
	s.Args = nil
	s.Env = nil
	res := &Result{Changed: []string{}, Problems: []Problem{}}
	for _, id := range agents {
		a, e := agent.Find(id)
		if e != nil {
			return nil, e
		}
		t := targetOf(a)
		if t == nil || t.MCP == nil {
			return nil, fmt.Errorf("%s does not support official MCP", id)
		}
		e = agent.Project(a, []string{t.MCP.Path}, func() error {
			entries, e := t.MCP.entries()
			if e != nil {
				return e
			}
			return t.MCP.put(&s, entries[s.Name])
		})
		if e != nil {
			return res, e
		}
		res.changed(id)
	}
	return res, nil
}
func InstallMarketSkill(source, id string, agents []string) (*Result, error) {
	if source != "boxai" {
		return nil, errors.New("only validated BoxAI skills can be installed")
	}
	if !agent.Authenticated() {
		return nil, errors.New("sign in to BoxAI before installing skills")
	}
	official.RLock()
	fetch := official.fetch
	var selected *OfficialSkill
	for _, s := range official.catalog.Skills {
		if s.ID == id {
			copy := s
			selected = &copy
		}
	}
	official.RUnlock()
	if selected == nil || fetch == nil {
		return nil, errors.New("skill not present in validated BoxAI provisioning")
	}
	b, err := fetch(id)
	if err != nil {
		return nil, errors.New("official skill download failed; refresh BoxAI sign-in")
	}
	files, err := verifiedSkill(*selected, b)
	if err != nil {
		return nil, err
	}
	res := &Result{Changed: []string{}, Problems: []Problem{}}
	for _, id := range agents {
		a, e := agent.Find(id)
		if e != nil {
			return res, e
		}
		t := targetOf(a)
		if t == nil || t.Skills == "" {
			return res, fmt.Errorf("%s does not support skills", id)
		}
		paths := []string{}
		content := map[string][]byte{}
		for name, b := range files {
			p := filepath.Join(t.Skills, selected.ID, filepath.FromSlash(name))
			paths = append(paths, p)
			content[p] = b
		}
		sort.Strings(paths)
		e = agent.Project(a, paths, func() error {
			for _, p := range paths {
				old, e := edit.Read(p)
				if e != nil {
					return e
				}
				if old != nil && !bytes.Equal(old, content[p]) {
					return fmt.Errorf("skill file already exists; restore its previous installation first: %s", p)
				}
				if e = edit.WriteAtomic(p, content[p]); e != nil {
					return e
				}
			}
			return nil
		})
		if e != nil {
			return res, e
		}
		res.changed(id)
	}
	return res, nil
}

func verifiedSkill(s OfficialSkill, b []byte) (map[string][]byte, error) {
	if int64(len(b)) != s.SizeBytes || len(b) > 16<<20 {
		return nil, errors.New("official skill archive size mismatch")
	}
	h := sha256.Sum256(b)
	if !strings.EqualFold(hex.EncodeToString(h[:]), s.SHA256) {
		return nil, errors.New("official skill archive digest mismatch")
	}
	files := map[string][]byte{}
	seen := map[string]bool{}
	var total int64
	count := 0
	add := func(name string, size int64, reader io.Reader) error {
		count++
		if count > 2048 || size < 0 || size > 8<<20 || total+size > 64<<20 {
			return errors.New("skill archive extraction limit exceeded")
		}
		if name == "" || strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") || archivepath.Clean(name) != name || name == ".." || strings.HasPrefix(name, "../") {
			return errors.New("unsafe skill archive path")
		}
		for _, part := range strings.Split(name, "/") {
			base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
			if strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || (len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '1' && base[3] <= '9') {
				return errors.New("unsafe cross-platform skill archive path")
			}
		}
		if seen[strings.ToLower(name)] {
			return errors.New("duplicate skill archive path")
		}
		seen[strings.ToLower(name)] = true
		data, e := io.ReadAll(io.LimitReader(reader, size+1))
		if e != nil {
			return e
		}
		if int64(len(data)) != size {
			return errors.New("skill entry size mismatch")
		}
		files[name] = data
		total += size
		return nil
	}
	switch s.Format {
	case "tar.gz":
		gz, e := gzip.NewReader(bytes.NewReader(b))
		if e != nil {
			return nil, e
		}
		defer gz.Close()
		tr := tar.NewReader(io.LimitReader(gz, 70<<20))
		for {
			h, e := tr.Next()
			if e == io.EOF {
				break
			}
			if e != nil {
				return nil, e
			}
			if h.Typeflag == tar.TypeDir {
				count++
				if count > 2048 {
					return nil, errors.New("skill archive extraction limit exceeded")
				}
				continue
			}
			if h.Typeflag != tar.TypeReg {
				return nil, errors.New("skill archive links and special files are forbidden")
			}
			if e = add(h.Name, h.Size, tr); e != nil {
				return nil, e
			}
		}
	case "zip":
		z, e := zip.NewReader(bytes.NewReader(b), int64(len(b)))
		if e != nil {
			return nil, e
		}
		for _, f := range z.File {
			if f.FileInfo().IsDir() {
				continue
			}
			if !f.Mode().IsRegular() {
				return nil, errors.New("skill archive links and special files are forbidden")
			}
			if f.UncompressedSize64 > 8<<20 {
				return nil, errors.New("skill archive extraction limit exceeded")
			}
			r, e := f.Open()
			if e != nil {
				return nil, e
			}
			e = add(f.Name, int64(f.UncompressedSize64), r)
			r.Close()
			if e != nil {
				return nil, e
			}
		}
	default:
		return nil, errors.New("unsupported official archive format")
	}
	if _, ok := files["SKILL.md"]; !ok {
		return nil, errors.New("official archive must contain SKILL.md at its root")
	}
	return files, nil
}
