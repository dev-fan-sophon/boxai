# BoxAI Desktop security

Do not post vulnerabilities, credentials or private project data in public
issues. Use [BoxAI's private vulnerability reporting form](https://github.com/dev-fan-sophon/boxai/security/advisories/new)
if GitHub makes it available to your account. If unavailable, ask a repository
maintainer for a private reporting channel without posting exploit details.
Do not send BoxAI account information to the upstream project's contact address.

Include the BoxAI Desktop version, OS and architecture, affected boundary,
minimal reproduction with disposable data, impact and redacted diagnostics.
Never include API keys, browser cookies, local auth files or private source.

Scope includes official installers, Electron/preload IPC, Rust host-core,
agent execution, credential handling, tool permissions, extensions and MCP.
Report dependency-only issues to the relevant maintainer as well. Do not test
against other users or production data. BoxAI does not promise the upstream
project's response deadlines or bounty terms.

Use the current official build from [BoxAI](https://you-box.com/agents).
An unsigned installer warning is not a malware verdict, but it also does not
establish trust: verify the download source and never disable OS protection
globally to run a build.
