package agent

const legacyID = "dial"

// RenameLegacy is intentionally read-only: upstream dial/Magpie records do not
// establish BoxAI ownership. Rust BoxAI migration is explicit in migration.
func RenameLegacy() {}
