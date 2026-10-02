# Contributing to BoxAI Desktop

This directory is maintained in [dev-fan-sophon/boxai](https://github.com/dev-fan-sophon/boxai).
Read [AGENTS.md](AGENTS.md) and [README.md](README.md) first. Follow the BoxAI
repository's delivery instructions; upstream branch and release rules are not
the delivery policy for this monorepo.

1. Verify the reported behavior against current code and tests.
2. Keep changes within the owning process or package. Explain any compatibility,
   security or persisted-data impact before changing a contract.
3. Add deterministic regression tests at the affected boundary. Use disposable
   projects and profiles, not personal files or paid model calls.
4. Run relevant checks listed in the README. Review the full diff and report
   exactly what passed, failed or could not run.
5. Update English and Vietnamese product guides when behavior changes. Website
   documentation is generated from Markdown; never patch generated output.

Preserve upstream attribution and license notices. Do not commit credentials,
local databases, logs, dependencies or release binaries. Report security issues
privately as described in [SECURITY.md](SECURITY.md).
