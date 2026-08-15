---
name: dsh-norm-spec
description: Use when dsh needs to inspect, author, validate, or diagnose project .norm conventions, their automatic session injection, post-edit feedback, or the norm native tools.
---

# dsh-norm-spec

Use this Skill for the dsh-specific workflow around canonical `.norm`
conventions. `norm-spec` remains the format, collection, and validation
authority; this adapter does not implement an alternative parser or
validator.

## Runtime behavior

- At each agent step, dsh-norm-spec recollects conventions for the active
  target through a persistent verified Rust bridge started per agent
  session.
- Conventions are injected as a single durable `<system-reminder>` user
  message. When conventions change, the previous reminder is replaced in
  place on the session surface: occupancy stays bounded at one message,
  and superseded versions are no longer model-visible.
- The active target follows successful `read`/`edit` (file) and `write`
  (directory) tool calls. Shell commands and custom-tool fields are not
  guessed for paths.
- A successful `write` or `edit` triggers strict whole-project `.norm`
  validation. Findings are appended to that completed tool result as
  bounded soft feedback, serialized first-in-first-out per session.
  Shell commands, custom tools, and failed edits do not trigger this
  path.
- Post-edit feedback means the mutation already happened. It does not
  block, roll back, prove project-file compliance, or substitute for
  hard enforcement. Natural-language conventions are prompt guidance.
- The `norm_validate`, `norm_collect`, and `norm_scan` tools call the
  same bridge directly for on-demand validation, collection, and
  coverage inspection.
- A missing or failed bridge is a visible failure. Do not treat it as an
  empty active ruleset; bridge output is the only authority.

## Cold start

No `.norm` files is a valid project state. The adapter stays quiet and
does not create or modify files. Ask the user before initializing
conventions.

When the user chooses to add conventions, the `norm_validate`,
`norm_collect`, and `norm_scan` tools and the upstream `norm` CLI's
explicit `init`, `collect`, and `validate` workflows are the supported
authoring path. Do not substitute an arbitrary executable found on
`PATH`; the packaged runtime is the source of truth.

## Canonical authoring and diagnosis

Consult the exact upstream release documentation rather than reproducing
its schema or profile rules here:

- [Format specification](https://github.com/CyanoOrg/norm-spec/blob/v0.1.0-rc.1/docs/SPEC.md)
- [Profile guide](https://github.com/CyanoOrg/norm-spec/blob/v0.1.0-rc.1/docs/PROFILE-GUIDE.md)
- [Installation and upgrade](https://github.com/CyanoOrg/norm-spec/blob/v0.1.0-rc.1/docs/INSTALLATION.md)

For diagnosis:

1. Run `norm_scan` or `norm_collect` on the working root; runtime or
   identity failures are not an empty project.
2. Preserve the most-specific-first order returned by collection.
3. Run strict validation (`norm_validate`) after authoring or editing
   conventions.
