/**
 * BoxAI sells a single user group, so group pickers, group columns and
 * per-group breakdowns are hidden from the UI. Requests still carry the
 * user's own group (or `default`) exactly as before — only display changes.
 * Flip to `true` to bring every group surface back.
 */
export const MULTI_GROUP_ENABLED = false
