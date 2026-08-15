# Security Policy

## Supported versions

Before the first stable release, security fixes land on `main` and, when one
exists, the latest published pre-release. Older pre-releases are not supported.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Until the public
GitHub repository exists (D004), email `bravetwo@163.com` with the subject
`dsh-norm-spec security report`. Once the repository opens, use GitHub
private vulnerability reporting.

Include the affected revision, DSH version, impact, a minimal reproduction,
and any proposed mitigation. Remove real credentials and private project
data from examples. We aim to acknowledge reports within five business days
and will coordinate disclosure after a fix or mitigation is available.

Security-sensitive areas include bridge command injection, path traversal,
untrusted `.norm` content reaching model-visible injection, session-log
integrity (no custom event types), and platform-binary distribution.
