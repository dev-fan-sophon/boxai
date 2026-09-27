package library

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOfficialArchiveVerification(t *testing.T) {
	for _, bad := range []string{"", "../outside", "/absolute", "C:\\outside", "SKILL.md", "link"} {
		t.Run("entry="+bad, func(t *testing.T) {
			var buf bytes.Buffer
			gz := gzip.NewWriter(&buf)
			tw := tar.NewWriter(gz)
			require.NoError(t, tw.WriteHeader(&tar.Header{Name: "SKILL.md", Mode: 0600, Size: 4}))
			_, err := tw.Write([]byte("safe"))
			require.NoError(t, err)
			if bad != "" {
				h := &tar.Header{Name: bad, Mode: 0600, Size: 3}
				if bad == "link" {
					h.Typeflag = tar.TypeSymlink
					h.Linkname = "/etc/passwd"
					h.Size = 0
				}
				require.NoError(t, tw.WriteHeader(h))
				if h.Size > 0 {
					_, err = tw.Write([]byte("bad"))
					require.NoError(t, err)
				}
			}
			require.NoError(t, tw.Close())
			require.NoError(t, gz.Close())
			b := buf.Bytes()
			h := sha256.Sum256(b)
			s := OfficialSkill{ID: "safe", SHA256: hex.EncodeToString(h[:]), SizeBytes: int64(len(b)), Format: "tar.gz"}
			files, err := verifiedSkill(s, b)
			if bad != "" {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, []byte("safe"), files["SKILL.md"])
			s.SizeBytes++
			_, err = verifiedSkill(s, b)
			assert.ErrorContains(t, err, "size mismatch")
			s.SizeBytes--
			s.SHA256 = string(bytes.Repeat([]byte("0"), 64))
			_, err = verifiedSkill(s, b)
			assert.ErrorContains(t, err, "digest mismatch")
		})
	}
}
func TestOfficialZipAndCatalogAreCredentialFree(t *testing.T) {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	w, err := z.Create("SKILL.md")
	require.NoError(t, err)
	_, err = w.Write([]byte("document"))
	require.NoError(t, err)
	require.NoError(t, z.Close())
	h := sha256.Sum256(buf.Bytes())
	s := OfficialSkill{ID: "official", Name: "Official", Format: "zip", SHA256: hex.EncodeToString(h[:]), SizeBytes: int64(buf.Len())}
	files, err := verifiedSkill(s, buf.Bytes())
	require.NoError(t, err)
	assert.Equal(t, []byte("document"), files["SKILL.md"])
	ClearOfficialCatalog()
	t.Cleanup(ClearOfficialCatalog)
	called := false
	require.NoError(t, SetOfficialCatalog(OfficialCatalog{Skills: []OfficialSkill{s}, MCPServers: []OfficialMCP{{ID: "media", Name: "Media"}}}, func(string) ([]byte, error) { called = true; return nil, nil }, nil))
	skills, err := MarketSkills("")
	require.NoError(t, err)
	require.Len(t, skills, 1)
	assert.Equal(t, "boxai", skills[0].Source)
	assert.False(t, called, "listing must not download or install anything")
	servers, err := MarketServers("")
	require.NoError(t, err)
	require.Len(t, servers, 1)
	assert.Equal(t, "media", servers[0].ID)
	ClearOfficialCatalog()
	skills, err = MarketSkills("")
	require.NoError(t, err)
	assert.Empty(t, skills)
	_, err = InstallMarketSkill("github/anything", "anything", nil)
	assert.ErrorContains(t, err, "validated BoxAI")
}

func TestOfficialZipRejectsCrossPlatformPaths(t *testing.T) {
	for _, path := range []string{"../escape", "folder/../../escape", "C:/escape", "CON.txt", "file.", "skill.md"} {
		t.Run(path, func(t *testing.T) {
			var b bytes.Buffer
			z := zip.NewWriter(&b)
			for _, name := range []string{"SKILL.md", path} {
				w, err := z.Create(name)
				require.NoError(t, err)
				_, err = w.Write([]byte("test"))
				require.NoError(t, err)
			}
			require.NoError(t, z.Close())
			h := sha256.Sum256(b.Bytes())
			_, err := verifiedSkill(OfficialSkill{Format: "zip", SHA256: hex.EncodeToString(h[:]), SizeBytes: int64(b.Len())}, b.Bytes())
			assert.Error(t, err)
		})
	}
}
