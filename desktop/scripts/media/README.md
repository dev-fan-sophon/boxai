# BoxAI Desktop website capture

These assets must show a **real branded Electron application**, real BoxAI
account model routing, and real tasks. Do not use injected transcripts, mock
IPC, seeded application databases, renderer-only previews, generated UI, or
the upstream test capture rig. A fixture repository is safe input, not a fake
conversation. Do not capture anyone's existing profile.

## Capture prerequisites

Use the integrated `feat/pi-desktop` build after branding, account routing and
packaging land. Record the exact commit, platform, app version and capture date
alongside private source files. Never publish the profile, HAR, cookies, auth
callback URLs, passwords, API keys, or unreviewed recordings. Use a dedicated
demo account with a bounded balance. Store its credentials only in the runner's
private temporary files. Browser password entry and callback navigation must be
cut from the final video, not merely hidden by a caption.

Prefer the native macOS runner for the installation video. Reuse the release
thread's built app without modifying its worktree. A separate profile can be
selected with `PI_DESKTOP_DATA_DIR`; check this against the integrated build.
Keep a separate capture working directory and coordinate access to the shared
display with the release thread. Use the normal UI to log in and select the
model. Remote debugging, if needed, must listen only on loopback.

On macOS, check Screen Recording and Accessibility permission first. Native
`screencapture` can capture a window (`-l <window-id>`); `ffmpeg`'s `avfoundation`
input can record the screen. On Linux, a dedicated Xvfb display and ffmpeg
`x11grab` are alternatives. Never disable application permission controls for
the demo. Capture 1536×960 content or 3072×1920 Retina content (16:10); crop the
window deliberately, without chopping menus or permission cards. The exporter
rejects other aspect ratios and undersized screenshots.

## Real demonstration project

Copy `fixture/` to a private workspace named `Lotus Travel`, then initialize a
Git repository and commit the initial files. The fixture is fictional public
travel content with no customers or credentials. Do not execute it inside this
source tree: the agent should only be able to change its isolated project.

1. Agent prompt: “Fix the tour quote calculation so each traveller after the
   first gets a 10% discount. Add tests for one, two and three travellers and
   invalid counts. Run the tests and summarize the changes.”
2. Plan prompt in a new Plan session: “Plan an accessible English/Vietnamese
   tour booking form for this project. Cover traveller count, VND prices,
   validation, keyboard access and tests. Do not implement it yet.” Capture
   the actual submitted plan awaiting review.
3. Parallel worker prompt in a new Agent session: “Use two subagents in
   parallel: one reviews quote correctness and one reviews the tour content
   for clarity and Vietnam-first localization. Combine their findings. Do
   not edit files.” Capture real worker status, not only an agent registry.
4. Review: open the changes produced by step 1 in the work/review panel.
5. Models: open the account-scoped BoxAI model selector, with no custom
   providers or credentials displayed.
6. Plugins: open the genuine plugin/skill/MCP marketplace. Do not invent
   integrations or install unnecessary third-party software for a screenshot.

Use English UI for the main set. Change the actual application locale to
Vietnamese for `agent-vi` and `models-vi`; do not translate pixels afterward.
If Vietnamese is not supported in the integrated build, report that blocker.

## Raw files and storyboard

Keep raw material outside `web/default/public`. Required source PNGs:

```
agent.png plan.png subagents.png models.png plugins.png review.png
agent-vi.png models-vi.png
docs/login.png docs/models.png docs/settings.png docs/updates.png
docs/permissions.png docs/project-session.png
overview-poster.png getting-started-poster.png
```

For docs, capture login before account entry, account model selection, general
settings, actual update controls, an Ask-mode permission card (Allow once /
Allow for session / Deny), and a project with a short real conversation. An
update screenshot must not pretend a newer release exists.

Produce two **real screen recordings**, edited to 45–75 seconds each, without
audio; suggested timing below is flexible. Do not turn still images into a
purported interaction recording. Cut long waits; captions may explain that
execution was shortened. Keep cursor motion and the resulting state legible.

| Time | `overview.mov` | `getting-started.mov` |
| --- | --- | --- |
| 0–10 s | Project and prompt | Real download page and DMG install |
| 10–20 s | Agent execution and real test result | Open BoxAI Desktop and click sign in |
| 20–30 s | Review submitted Plan | Browser account authorization (no secrets) |
| 30–40 s | Real parallel workers | Return to Desktop; choose BoxAI model |
| 40–50 s | BoxAI models and marketplace | Open project and enter first task |
| 50–65 s | Review changes and successful result | Actual result and review panel |

Use short burned-in English captions when the screen alone is unclear. Keep
captions outside relevant controls. Select an attractive legible frame from
each actual recording for its poster PNG. Review every frame around browser
authorization before exporting.

## Export and verify

Requires Python 3, ffmpeg with libwebp/libx264/libvpx-vp9, and ffprobe. No Python
dependencies. From the monorepo root:

```sh
python3 desktop/scripts/website-media.py images --source /private/captures
python3 desktop/scripts/website-media.py videos --source /private/captures
python3 desktop/scripts/website-media.py verify
```

The output contract is 24 responsive website WebPs, six documentation WebPs,
two poster WebPs, and four video files, all under `web/default/public`.
Videos use two-pass encoding, H.264/VP9, 1536×960, 24 fps, no audio or source
metadata, and a duration-derived bitrate with 10% headroom below 8 MB each.
The MP4 moov atom is moved to the front for progressive playback.

Inspect the exported full-size and 480px images, both poster images, and both
complete videos. Then inspect them embedded in the actual website, including
mobile sizing. Technical verification cannot establish truthfulness, absence
of secrets, caption readability, or visual quality: those require inspection.
Only publish the exported assets after that review. Record the capture commit
and successful real task tests in the delivery report.
