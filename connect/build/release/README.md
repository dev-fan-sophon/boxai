# Connect native release

Product version: `VERSION` (1.1.1). Magpie source version: upstream v0.1.185.
These scripts wrap the upstream Makefile. They do not add an app updater,
custom GUI, Desktop release, migration, or catalog publication.

## Build only the accepted pushed commit

Use clean, isolated checkouts on native macOS arm64 and Windows x64. Check out
the same full commit on both hosts, not a moving `main`. Do not build a release
until the combined client/server source and tests have been accepted.

From the repository root on macOS, source signing credentials privately and run:

```sh
export APPLE_SIGNING_IDENTITY='Developer ID Application: fan Z (9UUWCMKMDH)'
# APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID must also be exported.
bash connect/build/release/macos.sh 1.1.1 /absolute/stage/1.1.1
```

The macOS script signs, notarizes and staples both app and DMG and checks
Gatekeeper. It deliberately retains `magpie.app` inside the updater ZIP: the
upstream updater requires that exact name. The DMG presents `BoxAI Connect.app`.
The binary remains `Contents/MacOS/magpie`; renaming it changes upstream contracts.

On Windows, put the Go toolchain required by `connect/go.mod`, GNU make,
Git Bash and NSIS on PATH, then use Git Bash:

```sh
bash connect/build/release/windows.sh 1.1.1 /c/absolute/stage/1.1.1
```

The script calls `make release-windows`, including upstream resources and GUI
link flags, and packages the x64 GUI executable in a per-user NSIS installer.
Windows artifacts are unsigned until an Authenticode identity is provisioned.
The installer does not manage WebView2: acceptance must verify the system's
WebView2 runtime, which upstream Wails requires.

Build scripts only build/package; they do not run the upstream test suite,
launch the app, or install it. Per the owner's scope, do not test Agent config
apply/restore. Run focused BoxAI and catalog tests in the orb instead. On native
hosts verify signatures, resources, versions, installer payloads and hashes
without executing the app. HOME overrides alone do not isolate agent-specific
environment paths, WebKit caches, Windows registry or Start Menu writes.
Real login/install checks need separate user approval; never claim them from
static package checks.

## Stage the four artifacts

Combine both platform outputs without changing their bytes:

```text
BoxAI-Connect-1.1.1-macos-arm64.dmg
BoxAI-Connect-1.1.1-windows-x64-setup.exe
magpie-darwin-arm64.zip
magpie-windows-amd64.exe
macos-source.txt
windows-source.txt
```

After acceptance, generate manifests with Python 3.9+:

```sh
python3 connect/build/release/manifests.py /absolute/stage/1.1.1 \
  --commit FULL_ACCEPTED_COMMIT --published-at 2026-09-27T00:00:00Z \
  --notes 'BoxAI Connect 1.1.1, based on Magpie v0.1.185.'
```

Use the actual UTC publication time. The generator validates matching build
commits, required files, nonempty bytes and the upstream ZIP layout. It does not
claim native acceptance or cryptographically inspect signatures: those are the
release operator's gates. `signed:true` for macOS is only valid after the macOS
script and native trust verification pass. Windows stays `signed:false`.

## Publication order (Connect only)

Use account `4379d21a3d3eadc0e37d63abff091f31`, bucket `boxai-desktop`, prefix
`connect/`, public base `https://dl.you-box.com/connect`. Reuse ignored
`.env.cloudflare` credentials (`R2_DESKTOP_ACCESS_KEY_ID`,
`R2_DESKTOP_SECRET_ACCESS_KEY`, `R2_ENDPOINT`) without printing them.

1. Read live `releases.json` and refuse a version that is not newer. Read the
   new `magpie-latest.json` if present as well. Save their exact bytes and ETags
   before publication. Save legacy `latest.json` and `native-latest.json` hashes.
2. Upload each of the four artifacts under `connect/1.1.1/`, using conditional
   `PutObject` with `If-None-Match: *`. An existing object is a conflict, not
   permission to overwrite. If resuming a partial upload, first compare the
   complete downloaded existing bytes against the local size and SHA-256.
3. Download all four public URLs and verify size/SHA-256 against the generated
   feeds **before** advancing either feed. Preserve build/acceptance evidence
   outside the public prefix (it may contain private information).
4. Publish `connect/magpie-latest.json`, then `connect/releases.json` with
   `application/json` and `public, max-age=60`. Use each previous ETag as
   `If-Match`, or `If-None-Match: *` for a new feed, to reject concurrent changes.
   These two writes are not atomic; both only reference already verified bytes.
5. Purge only those two feed URLs from the `you-box.com` Cloudflare zone, then
   fetch again and verify their exact JSON and referenced artifacts. Verify
   legacy feed hashes remain unchanged. If a partial publication occurs, inspect
   current state before retrying; never downgrade a newer release.

AWS CLI v2 supports the conditional operations (use a current version):

```sh
aws s3api put-object --endpoint-url "$R2_ENDPOINT" --bucket boxai-desktop \
  --key "connect/1.1.1/$NAME" --body "$STAGE/$NAME" \
  --if-none-match '*' --cache-control 'public, max-age=31536000, immutable'
```

Export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from the R2 variables and
AWS_DEFAULT_REGION=auto privately before invoking it. Do not use unconditional
`aws s3 sync`, the old `scripts/client-release/full-release.sh`, old Connect
packaging paths, or Desktop's publisher. They can overwrite unrelated feeds or
publish Desktop/catalog content.

The new updater feed is `connect/magpie-latest.json`, with upstream schema
`{version, notes, url, assets: {filename: {url, size, sha256}}}`. It advertises only
`magpie-darwin-arm64.zip` and `magpie-windows-amd64.exe`. The website's
`releases.json` keeps its existing `downloads` schema and two allowlisted
installer filenames. Never change `connect/latest.json` (Tauri 0.1.4) or
`connect/native-latest.json` (custom 1.0.4): neither understands this app.

## Tooling checks

```sh
bash -n connect/build/release/macos.sh && bash -n connect/build/release/windows.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s connect/build/release -p 'test_*.py'
```

Signing preflight on the macOS builder found Developer ID team `9UUWCMKMDH`
and successfully authenticated to Apple's notarization history. The Windows
host `win-cf` is reachable; `win-lan` timed out. NSIS and Git Bash are installed;
Go/make are not currently on its SSH PATH. No code-signing certificates were
returned from CurrentUser or LocalMachine certificate stores. This is a
preflight observation, not native release acceptance.
