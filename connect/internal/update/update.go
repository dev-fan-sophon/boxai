// Package update verifies BoxAI's exact signed installers before handing
// them to the native installer UI. No upstream feed or environment override
// can change the download origin or the compiled trust anchor.
package update

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/proc"
)

const Site = "https://you-box.com/connect"
const PublicKey = "cc293254aa2eebd39040f0802b10dfdd46c92045b5fe8693241a3d53d8c4b4f1"
const maxInstallerSize int64 = 512 << 20

var errLegacyUpdate = errors.New("automatic replacement is disabled; use the verified BoxAI installer handoff")

func Feed() string { return "https://dl.you-box.com/connect/native-latest.json" }

// Release is one published version.
type Release struct {
	Version   string           `json:"version"` // "0.2.0", no v
	Notes     string           `json:"notes"`   // markdown
	URL       string           `json:"url"`     // the release page
	Assets    map[string]Asset `json:"assets"`  // by file name
	Platforms map[string]Asset `json:"platforms"`
}

// Asset is one downloadable file of a release.
type Asset struct {
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature"`
}

var client = &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("too many update redirects")
	}
	return trustedURL(req.URL.String())
}}

func trustedURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "dl.you-box.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.RawPath != "" || !strings.HasPrefix(u.Path, "/connect/") || strings.Contains(u.Path, "..") || strings.Contains(u.Path, "\\") {
		return errors.New("update URL is outside the trusted BoxAI download origin")
	}
	return nil
}

// Latest asks the feed for the newest release.
func Latest(ctx context.Context) (*Release, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", Feed(), nil)
	if err != nil {
		return nil, err
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("update feed: %s", res.Status)
	}
	var r Release
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&r); err != nil {
		return nil, fmt.Errorf("update feed: %w", err)
	}
	if parse(r.Version) == nil {
		return nil, fmt.Errorf("update feed: no version")
	}
	r.URL = Site
	for platform, asset := range r.Platforms {
		name := installerName(r.Version, platform)
		if name == "" || asset.URL != "https://dl.you-box.com/connect/"+r.Version+"/"+name {
			return nil, errors.New("update feed contains an unexpected installer URL")
		}
		if err := validateAsset(asset); err != nil {
			return nil, err
		}
	}
	if len(r.Platforms) != 2 {
		return nil, errors.New("update feed must contain both native platforms")
	}
	return &r, nil
}

func installerName(version, platform string) string {
	switch platform {
	case "darwin-arm64":
		return "BoxAI-Connect-" + version + "-macos-arm64.dmg"
	case "win32-x64":
		return "BoxAI-Connect-" + version + "-windows-x64-setup.exe"
	}
	return ""
}

func validateAsset(a Asset) error {
	if err := trustedURL(a.URL); err != nil {
		return err
	}
	hash, err := hex.DecodeString(a.SHA256)
	if err != nil || len(hash) != sha256.Size {
		return errors.New("invalid installer checksum")
	}
	sig, err := base64.StdEncoding.Strict().DecodeString(a.Signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return errors.New("invalid installer signature")
	}
	if a.Size <= 0 || a.Size > maxInstallerSize {
		return errors.New("invalid installer size")
	}
	return nil
}

// DownloadInstaller only supports the two natively asserted release targets.
func DownloadInstaller(ctx context.Context, rel *Release) (string, error) {
	platform := runtime.GOOS + "-" + runtime.GOARCH
	if platform == "windows-amd64" {
		platform = "win32-x64"
	}
	name := installerName(rel.Version, platform)
	a, ok := rel.Platforms[platform]
	if !ok || name == "" {
		return "", errors.New("no signed installer for this platform")
	}
	if a.URL != "https://dl.you-box.com/connect/"+rel.Version+"/"+name {
		return "", errors.New("unexpected installer URL")
	}
	dir, err := os.MkdirTemp("", "boxai-connect-update-")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	if err := download(ctx, a, path); err != nil {
		os.RemoveAll(dir)
		return "", err
	}
	return path, nil
}

// OpenInstaller rechecks the exact bytes immediately before handoff.
// The proof is stored beside the installer in its private temporary directory.
func OpenInstaller(path string) error {
	proof, err := os.ReadFile(path + ".signature")
	if err != nil {
		return err
	}
	key, _ := hex.DecodeString(PublicKey)
	if err := verifySignature(path, proof, key); err != nil {
		return err
	}
	var cmdName string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		if !strings.HasSuffix(path, ".dmg") {
			return errors.New("expected DMG installer")
		}
		cmdName, args = "open", []string{path}
	case "windows":
		if !strings.HasSuffix(path, "-setup.exe") {
			return errors.New("expected setup installer")
		}
		cmdName = path
	default:
		return errors.New("no native installer on this platform")
	}
	cmd := proc.Command(cmdName, args...)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// Ed25519 signs the installer itself, not its digest (nor Ed25519ph).
func verifySignature(path string, signature []byte, key ed25519.PublicKey) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > maxInstallerSize {
		return errors.New("invalid installer size or type")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxInstallerSize+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > maxInstallerSize || len(key) != ed25519.PublicKeySize || !ed25519.Verify(key, data, signature) {
		return errors.New("installer signature mismatch")
	}
	return nil
}

// Released reports whether v is a release version rather than a build from
// source ("dev", "0bcb2cc-dirty", git describe's "v0.1.0-3-g0bcb2cc");
// only releases update themselves.
func Released(v string) bool {
	s := parse(v)
	return s != nil && !describe.MatchString(s.pre) && !strings.Contains(s.pre, "dirty")
}

// describe matches what git describe adds after a tag: commits since, hash.
var describe = regexp.MustCompile(`^\d+-g[0-9a-f]+`)

// Newer reports whether version a comes after b. A pre-release comes before
// the release it leads up to.
func Newer(a, b string) bool {
	x, y := parse(a), parse(b)
	if x == nil || y == nil {
		return false
	}
	for i := range 3 {
		if x.n[i] != y.n[i] {
			return x.n[i] > y.n[i]
		}
	}
	switch {
	case x.pre == y.pre:
		return false
	case x.pre == "":
		return true
	case y.pre == "":
		return false
	}
	return x.pre > y.pre
}

type semver struct {
	n   [3]int
	pre string
}

func parse(v string) *semver {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v, pre, _ := strings.Cut(v, "-")
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return nil
	}
	var s semver
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return nil
		}
		s.n[i] = n
	}
	s.pre = pre
	return &s
}

// GUI says this binary has the desktop app in it. Off the Mac that app is a
// single binary too, and it updates from its own build, not the terminal
// one.
var GUI bool

// AppAsset and BinaryAsset name the files this machine would install.
func AppAsset() string { return "magpie-darwin-" + runtime.GOARCH + ".zip" }
func BinaryAsset() string {
	name := "magpie-cli-" + runtime.GOOS + "-" + runtime.GOARCH
	if GUI && runtime.GOOS != "darwin" {
		name = "magpie-" + runtime.GOOS + "-" + runtime.GOARCH
	}
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// Bundle is the .app the running binary lives in, or "" when it is not in
// one.
func Bundle() string {
	if runtime.GOOS != "darwin" {
		return ""
	}
	exe, err := Executable()
	if err != nil {
		return ""
	}
	// …/magpie.app/Contents/MacOS/magpie
	app := filepath.Dir(filepath.Dir(filepath.Dir(exe)))
	if filepath.Ext(app) != ".app" || filepath.Base(filepath.Dir(exe)) != "MacOS" {
		return ""
	}
	return app
}

// Homebrew is whether exe was installed by Homebrew (brew install magpie),
// which keeps it in its Cellar and has to be the one to upgrade it: a
// binary replaced under it leaves brew thinking the old version is there.
func Homebrew(exe string) bool {
	return strings.Contains(filepath.ToSlash(exe), "/Cellar/magpie/")
}

// Executable is the running binary, symlinks resolved.
func Executable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}

// Writable reports whether magpie may replace what lives in dir.
func Writable(dir string) bool {
	f, err := os.CreateTemp(dir, ".magpie-update-*")
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(f.Name())
	return true
}

// Legacy updater APIs fail closed while callers migrate to explicit handoff.
func Stage(ctx context.Context, rel *Release, bundle string) (string, error) {
	return "", errLegacyUpdate
}

// stageDir is where an update is unpacked: beside what it replaces, so
// installing it is a rename on one volume, or, where magpie may not write,
// in its cache, to be moved in with the administrator's password.
func stageDir(dir string) string {
	if !Writable(dir) {
		if cache, err := os.UserCacheDir(); err == nil {
			return filepath.Join(cache, "magpie", "update")
		}
	}
	return filepath.Join(dir, ".magpie-update")
}

func Install(staged, bundle string) error {
	return errLegacyUpdate
}

// InstallAsAdmin is Install with the administrator's password, asked for
// by the system.
func InstallAsAdmin(staged, bundle string) error {
	return errors.New("BoxAI updates never elevate; open the verified installer")
}

func Relaunch(bundle string) error {
	return errLegacyUpdate
}

func ReplaceBinary(ctx context.Context, rel *Release) error {
	return errLegacyUpdate
}

func StageBinary(ctx context.Context, rel *Release) (string, error) {
	return "", errLegacyUpdate
}

func InstallBinary(staged, exe string) error {
	return errLegacyUpdate
}

// oldName is where a running exe is moved aside to: exe.old, or when
// that is still there (in use), exe.old-2, exe.old-3…
func oldName(exe string) string {
	name := exe + ".old"
	for n := 2; ; n++ {
		if _, err := os.Lstat(name); os.IsNotExist(err) {
			return name
		}
		name = fmt.Sprintf("%s.old-%d", exe, n)
	}
}

// RemoveOld removes what earlier updates moved aside of exe, those no
// longer running.
func RemoveOld(exe string) {
	os.Remove(exe + ".old")
	olds, _ := filepath.Glob(exe + ".old-*")
	for _, o := range olds {
		os.Remove(o)
	}
}

// Replaced reports whether exe is no longer the binary that was there when
// this process looked (started, from os.Stat): another magpie installed an
// update over it, and this one runs from where it was moved aside.
func Replaced(exe string, started os.FileInfo) bool {
	now, err := os.Stat(exe)
	return err == nil && started != nil && (now.Size() != started.Size() || !now.ModTime().Equal(started.ModTime()))
}

// RemoveStaleNew removes exe.new when it is exe over again: the update a
// magpie left running from before it downloaded once more.
func RemoveStaleNew(exe string) {
	staged := exe + ".new"
	a, err1 := os.Stat(exe)
	b, err2 := os.Stat(staged)
	if err1 != nil || err2 != nil || a.Size() != b.Size() {
		return
	}
	if ha, hb := fileHash(exe), fileHash(staged); ha != "" && ha == hb {
		os.Remove(staged)
	}
}

func fileHash(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

// InstallBinaryAsAdmin is InstallBinary with the administrator's password.
func InstallBinaryAsAdmin(staged, exe string) error {
	return errors.New("BoxAI updates never elevate; open the verified installer")
}

func RelaunchBinary(exe string) error {
	return errLegacyUpdate
}

// AwaitPredecessor blocks, for a while at most, until the magpie that
// relaunched this one has exited.
func AwaitPredecessor() {
	pid, err := strconv.Atoi(os.Getenv("MAGPIE_REPLACES"))
	os.Unsetenv("MAGPIE_REPLACES")
	if err != nil || pid <= 0 {
		return
	}
	for deadline := time.Now().Add(20 * time.Second); time.Now().Before(deadline) && alive(pid); {
		time.Sleep(100 * time.Millisecond)
	}
}

type progressKey struct{}

// WithProgress has downloads made under ctx report how far along they are;
// total is 0 while the size is unknown.
func WithProgress(ctx context.Context, f func(done, total int64)) context.Context {
	return context.WithValue(ctx, progressKey{}, f)
}

// download fetches a to path and checks its hash. A connection that drops
// part way — GitHub from some networks — gets two more tries.
func download(ctx context.Context, a Asset, path string) error {
	if err := validateAsset(a); err != nil {
		return err
	}
	var err error
	for try := 0; try < 3; try++ {
		if try > 0 {
			select {
			case <-ctx.Done():
				return err
			case <-time.After(time.Duration(try) * 2 * time.Second):
			}
		}
		if err = fetch(ctx, a, path); err == nil || ctx.Err() != nil {
			break
		}
	}
	return err
}

func fetch(ctx context.Context, a Asset, path string) error {
	if err := validateAsset(a); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "GET", a.URL, nil)
	if err != nil {
		return err
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("download %s: %s", filepath.Base(path), res.Status)
	}
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	h := sha256.New()
	var body io.Reader = res.Body
	if report, ok := ctx.Value(progressKey{}).(func(done, total int64)); ok {
		total := res.ContentLength
		if total <= 0 {
			total = a.Size
		}
		body = &counter{r: res.Body, total: max(total, 0), report: report}
		report(0, max(total, 0))
	}
	n, err := io.Copy(io.MultiWriter(f, h), io.LimitReader(body, a.Size+1))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), a.SHA256) {
		err = fmt.Errorf("%s does not match its checksum", filepath.Base(path))
	}
	if err == nil && n != a.Size {
		err = errors.New("installer size mismatch")
	}
	if err == nil {
		key, _ := hex.DecodeString(PublicKey)
		sig, _ := base64.StdEncoding.Strict().DecodeString(a.Signature)
		err = verifySignature(path, sig, key)
		if err == nil {
			err = os.WriteFile(path+".signature", sig, 0o600)
		}
	}
	if err != nil {
		os.Remove(path)
		os.Remove(path + ".signature")
	}
	return err
}

// counter reports bytes as they are read.
type counter struct {
	r      io.Reader
	done   int64
	total  int64
	report func(done, total int64)
}

func (c *counter) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.done += int64(n)
	c.report(c.done, c.total)
	return n, err
}
