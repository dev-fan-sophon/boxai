# Video capability contract

`GET /api/playground/video-capabilities?model=<public model>&group=<group>` is the authenticated, fail-closed contract used by video clients.

The response intersects every enabled channel that routing can select for the user's requested group. Unknown channel/model pairs remove the affected mode rather than guessing. Model mappings are resolved before built-in profiles are selected. Explicit per-channel profiles live in `ChannelSettings.video_capabilities` and are validated when channel settings are saved.

Modes are `text`, `frames` (first/optional last frame), and `references` (a set of reference images). All list properties are JSON arrays, including empty `imageOnlyResolutions`. `imageOnlyResolutions` is a restriction and is therefore unioned across candidates; ordinary choices are intersected. Duration choices are filtered to the intersected range.

The `/pg/video/` submit path validates the selected channel again after model mapping and on every retry, before billing reservation or provider dispatch. It rejects unsupported modes, aliases that conflict, unknown metadata passthrough, invalid duration/ratio/resolution/size combinations, reference limits, unsupported last frames and audio toggles, and image requirements. Seedance 2.5 first/last-frame requests require adaptive ratio in both native Doubao and Sora-compatible adapters.

## Channel-specific restrictions

Built-in profiles describe the supported adapter/model combinations, not a guarantee that every reseller implements all upstream features. Override a reseller's policy only after checking its documentation or behavior. Read the channel's existing `setting` JSON, merge `video_capabilities`, and preserve every unrelated setting when updating `/api/channel/`.

The outer key is the final mapped upstream model, not its public alias. Each value is a complete mode-to-profile object; an empty object explicitly disables that model, and omitted modes are unavailable. For example, copy the verified profiles and set `supportsAudioToggle: false` in each mode when a provider ignores `generate_audio`. This hides the control and rejects explicit audio selections; it does not promise silent output. Channel 36 currently uses this restriction for `doubao-seedance-2-5-260628`.

`resolutionAspectRatios` optionally restricts individual resolutions, for example `{"1080p":["16:9"]}`. Resolutions without an entry allow all listed aspect ratios. Defaults must be valid combinations. Candidate channel intersection preserves these correlated restrictions rather than independently combining incompatible choices.

After saving, query the endpoint for every affected public alias and group, then exercise text, first/last-frame, and reference modes in both Playground and canvas. Disabled or undocumented modes must stay unavailable. Both clients fetch policy again immediately before submission; the server checks the actual selected channel independently. Existing generated results remain visible if their model later becomes unavailable. Unknown models are deliberately disabled until a verified profile is supplied; there is no permissive name-based fallback.
