package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/boxai"
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/library"
	"github.com/yetone/magpie/internal/migration"
	"github.com/yetone/magpie/internal/proc"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/settings"
)

const boxaiUsage = `BoxAI Connect — connect your coding Agents to BoxAI

  boxai-connect                 Open the desktop app
  boxai-connect login           Sign in with BoxAI in your browser
  boxai-connect logout          Restore managed configuration and revoke this device
  boxai-connect status          Show sign-in status (never prints credentials)
  boxai-connect tray            Run in the system tray
  boxai-connect serve           Run the authenticated local gateway
  boxai-connect ls               Show configured Agents
  boxai-connect agents           List supported Agents
  boxai-connect models           List your authorized BoxAI models
  boxai-connect <agent> <model>   Configure an Agent after sign-in
  boxai-connect library          Show library status (manage in the desktop app)
  boxai-connect update [check]    Download a verified BoxAI installer

The local gateway must remain running while configured Agents use it.
Only BoxAI browser authentication is supported; API-key imports are disabled.
`

var (
	runtimeOnce     sync.Once
	runtimeMu       sync.Mutex
	runtimeError    error
	localCredential atomic.Pointer[string]
	legacyRestored  bool
)

func initializeBoxAI() {
	runtimeOnce.Do(func() {
		_, coordinator := legacyDirectories()
		runtimeError = agent.InitializeSafety(filepath.Join(settings.Dir(), "projection"), coordinator)
		provider.ConfigureBoxAI(boxaiModels)
		gateway.ConfigureBoxAI(requireBoxAI, func() string {
			if p := localCredential.Load(); p != nil {
				return *p
			}
			return ""
		}, http.HandlerFunc(proxyBoxAIMCP))
		boxai.SetBeforeLogout(func(context.Context) error {
			runtimeMu.Lock()
			defer runtimeMu.Unlock()
			agent.SetAuthenticated(false)
			localCredential.Store(nil)
			library.ClearOfficialCatalog()
			return agent.RestoreAll()
		})
	})
}

func requireBoxAI(ctx context.Context) error {
	runtimeMu.Lock()
	defer runtimeMu.Unlock()
	if err := boxai.Require(ctx); err != nil {
		agent.SetAuthenticated(false)
		library.ClearOfficialCatalog()
		return err
	}
	if runtimeError != nil {
		return runtimeError
	}
	data, ok := boxai.CachedProvisioning()
	if !ok {
		return errors.New("BoxAI session needs to be refreshed")
	}
	credential, err := boxai.LocalGatewayToken()
	if err != nil {
		return err
	}
	localCredential.Store(&credential)
	policies := make(map[string]agent.Policy, len(data.Agents))
	for id, policy := range data.Agents {
		policies[id] = agent.Policy{Enabled: policy.Enabled, Models: policy.Models,
			RecommendedModel: policy.RecommendedModel, LockedModel: policy.LockedModel}
	}
	agent.SetPolicies(policies)
	if !legacyRestored {
		legacy, coordinator := legacyDirectories()
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		roots := []string{filepath.Join(home, ".claude.json"), filepath.Join(home, ".codebuddy"), filepath.Join(home, ".workbuddy")}
		for _, a := range agent.All() {
			if a.Dir != "" {
				roots = append(roots, a.Dir)
			}
			if a.Path != "" {
				roots = append(roots, a.Path)
			}
		}
		_, err = migration.Restore(filepath.Join(legacy, "profiles.json"), legacy,
			filepath.Join(settings.Dir(), "projection"), coordinator, roots,
			func(ref string) ([]byte, error) { return boxai.ReadLegacyCredential(ctx, ref) })
		if err != nil {
			return fmt.Errorf("restore previous Connect configuration: %w", err)
		}
		legacyRestored = true
	}
	var official library.OfficialCatalog
	for _, skill := range data.Skills {
		official.Skills = append(official.Skills, library.OfficialSkill{ID: skill.ID, Name: skill.Name, Version: skill.Version,
			SHA256: skill.Archive.SHA256, Format: skill.Archive.Format, SizeBytes: skill.Archive.SizeBytes})
	}
	for _, server := range data.MCPServers {
		official.MCPServers = append(official.MCPServers, library.OfficialMCP{ID: server.ID, Name: server.Name, Description: server.Description})
	}
	if err := library.SetOfficialCatalog(official, fetchBoxAISkill, resolveBoxAIMCP); err != nil {
		return err
	}
	agent.SetAuthenticated(true)
	return nil
}

func boxaiModels() (string, []catalog.Model) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	key, err := boxai.Token(ctx)
	if err != nil {
		return "", nil
	}
	data, ok := boxai.CachedProvisioning()
	if !ok {
		return "", nil
	}
	models := make([]catalog.Model, 0, len(data.Models))
	for _, m := range data.Models {
		if !m.ChatCapable {
			continue
		}
		name := m.DisplayName
		if name == "" {
			name = m.ID
		}
		images := slices.Contains(m.InputModalities, "image")
		models = append(models, catalog.Model{ID: m.ID, Name: name, Provider: "boxai", Context: m.ContextLength,
			Output: m.MaxOutputTokens, Efforts: m.SupportedReasoning, Images: images, ImageInput: &images})
	}
	return key, models
}

// These are the legacy Rust directories crate's ProjectDirs locations. The
// neutral coordinator must stay unchanged so another Connector cannot race us.
func legacyDirectories() (data, coordinator string) {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		base := filepath.Join(home, "Library", "Application Support")
		return filepath.Join(base, "com.you-box.connect"), filepath.Join(base, "dev.GatewayConnector.ProjectionCoordinator")
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "you-box", "connect", "data"), filepath.Join(base, "GatewayConnector", "ProjectionCoordinator", "data")
	default:
		base := os.Getenv("XDG_DATA_HOME")
		if base == "" {
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, "connect"), filepath.Join(base, "projectioncoordinator")
	}
}

func openBoxAIBrowser(target string) {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		command = proc.Command("open", target)
	case "windows":
		command = proc.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		command = proc.Command("xdg-open", target)
	}
	if err := command.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "Could not open the browser. Cancel sign-in and check the default browser.")
		return
	}
	go func() { _ = command.Wait() }()
}

func boxaiAccountCommand(command string) error {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()
	switch command {
	case "status":
		if err := boxai.Require(ctx); err != nil {
			return err
		}
		fmt.Println("Signed in to BoxAI Connect")
		return nil
	case "logout":
		return boxai.Logout(ctx)
	case "login":
		if err := boxai.Login(ctx, openBoxAIBrowser); err != nil {
			return err
		}
		defer boxai.Cancel()
		ticker := time.NewTicker(250 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-ticker.C:
				session := boxai.Snapshot()
				if session.Pending {
					continue
				}
				if !session.Authenticated {
					return errors.New("BoxAI sign-in did not complete")
				}
				if err := requireBoxAI(ctx); err != nil {
					return err
				}
				fmt.Println("Signed in to BoxAI Connect")
				return nil
			}
		}
	}
	return errors.New("unknown account command")
}

func fetchBoxAISkill(id string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	data, err := boxai.Provisioning(ctx)
	if err != nil {
		return nil, err
	}
	for _, skill := range data.Skills {
		if skill.ID != id {
			continue
		}
		u, err := url.Parse(skill.Archive.URL)
		if err != nil || u.Scheme != "https" || (u.Host != "dl.you-box.com" && u.Host != "you-box.com") || u.User != nil {
			return nil, errors.New("official Skill URL is outside BoxAI")
		}
		if skill.Archive.SizeBytes <= 0 || skill.Archive.SizeBytes > 16<<20 {
			return nil, errors.New("invalid Skill archive size")
		}
		r, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
		if err != nil {
			return nil, err
		}
		if skill.Archive.Authorization == "connection_bearer" {
			if u.Host != "you-box.com" {
				return nil, errors.New("refusing to send BoxAI credentials to a download host")
			}
			key, err := boxai.Token(ctx)
			if err != nil {
				return nil, err
			}
			r.Header.Set("Authorization", "Bearer "+key)
		} else if skill.Archive.Authorization != "none" {
			return nil, errors.New("unsupported Skill authorization")
		}
		client := &http.Client{Timeout: 60 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(r)
		if err != nil {
			return nil, err
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("Skill download returned HTTP %d", response.StatusCode)
		}
		return io.ReadAll(io.LimitReader(response.Body, skill.Archive.SizeBytes+1))
	}
	return nil, errors.New("Skill is not in this account's official catalog")
}

func resolveBoxAIMCP(id string) (library.Server, error) {
	data, ok := boxai.CachedProvisioning()
	if !ok {
		return library.Server{}, errors.New("sign in to BoxAI first")
	}
	for _, server := range data.MCPServers {
		if server.ID == id {
			return library.Server{Name: server.Name, Transport: "http", URL: gateway.URL() + "/mcp/" + url.PathEscape(id),
				Headers: map[string]string{"Authorization": "Bearer " + gateway.Credential()}}, nil
		}
	}
	return library.Server{}, errors.New("MCP server is not in this account's official catalog")
}

func proxyBoxAIMCP(w http.ResponseWriter, r *http.Request) {
	data, ok := boxai.CachedProvisioning()
	if !ok {
		http.Error(w, "Sign in to BoxAI", http.StatusUnauthorized)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/mcp/")
	for _, server := range data.MCPServers {
		if server.ID != id {
			continue
		}
		target, err := url.Parse(server.URL)
		if err != nil || target.Scheme != "https" || target.Host != "you-box.com" || target.User != nil {
			http.Error(w, "MCP upstream is outside BoxAI", http.StatusBadGateway)
			return
		}
		key := ""
		if server.Authorization == "connection_bearer" {
			key, err = boxai.Token(r.Context())
			if err != nil {
				http.Error(w, "Sign in to BoxAI", http.StatusUnauthorized)
				return
			}
		} else if server.Authorization != "none" {
			http.Error(w, "Unsupported MCP authorization", http.StatusBadGateway)
			return
		}
		proxy := &httputil.ReverseProxy{Rewrite: func(p *httputil.ProxyRequest) {
			p.Out.URL = target
			p.Out.Host = target.Host
			p.Out.Header.Del("Authorization")
			p.Out.Header.Del("Cookie")
			p.Out.Header.Del("X-Api-Key")
			p.Out.Header.Del("X-Goog-Api-Key")
			if key != "" {
				p.Out.Header.Set("Authorization", "Bearer "+key)
			}
		}, ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) {
			http.Error(w, "BoxAI MCP is unavailable", http.StatusBadGateway)
		}}
		proxy.ServeHTTP(w, r)
		return
	}
	http.NotFound(w, r)
}
