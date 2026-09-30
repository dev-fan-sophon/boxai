# Video capability contract

`GET /api/playground/video-capabilities?model=<public model>&group=<group>` is the authenticated, fail-closed contract used by video clients.

The response intersects every enabled channel that routing can select for the user's requested group. Unknown channel/model pairs remove the affected mode rather than guessing. Model mappings are resolved before built-in profiles are selected. Explicit per-channel profiles live in `ChannelSettings.video_capabilities` and are validated when channel settings are saved.

Modes are `text`, `frames` (first/optional last frame), and `references` (a set of reference images). All list properties are JSON arrays, including empty `imageOnlyResolutions`. `imageOnlyResolutions` is a restriction and is therefore unioned across candidates; ordinary choices are intersected. Duration choices are filtered to the intersected range.

The `/pg/video/` submit path validates the selected channel again after model mapping and on every retry, before billing reservation or provider dispatch. It rejects unsupported modes, aliases that conflict, unknown metadata passthrough, invalid duration/ratio/resolution/size combinations, reference limits, unsupported last frames and audio toggles, and image requirements. Seedance 2.5 first/last-frame requests require adaptive ratio in both native Doubao and Sora-compatible adapters.
