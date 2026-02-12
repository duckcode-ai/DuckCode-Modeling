# Security Policy

## Supported Versions
Security fixes are prioritized for the latest `main` branch.

## Reporting a Vulnerability
Please report vulnerabilities privately to `security@duckcode.ai`.

Include:
- Affected component (`web-app`, `api-server`, `core_engine`, `cli`)
- Clear reproduction steps
- Impact assessment (confidentiality, integrity, availability)
- Proof of concept or logs (redacted)

Do not open public GitHub issues for unpatched vulnerabilities.

## Response Targets
- Initial acknowledgment: within 3 business days
- Triage and severity decision: within 7 business days
- Remediation timeline: based on severity and exploitability

## Disclosure Process
- We will coordinate disclosure timing with the reporter.
- Public advisory is published after a fix is available or mitigation guidance is ready.

## Secrets and Credentials
- Never commit secrets, tokens, private keys, or production connection strings.
- Use local config files and environment variables for credentials.
