# Versioning policy

The manifest spec follows [SemVer 2.0](https://semver.org/). Producers and
consumers commit to the same discipline so the federation remains stable.

## What counts as a breaking change

The following changes require a **major** version bump:

- Removing a field that was previously required.
- Removing or renaming an enum value.
- Tightening a value's type (e.g., `string` → enum).
- Changing the meaning of an existing field.
- Changing the resolution semantics in [interop.md](interop.md).

## Minor changes

The following ship as a **minor** version:

- Adding an OPTIONAL field to an existing object.
- Adding a new enum value when the field is open-ended (downstream tools must
  ignore unknown enum values, per Robustness Principle).
- Adding a new top-level object that consumers can ignore.
- Documentation-only edits to docs/.

## Patch changes

- Clarifying schema descriptions or examples without changing validation
  behavior.
- Fixing typos.

## Producer obligations

DataLex and DQL producers:

- MUST declare which spec major version they emit (e.g., in the manifest's
  `manifestSpecVersion` field).
- MUST NOT emit manifests that fail validation against their declared
  version.
- MUST support the previous major version for at least 12 months after a new
  major ships, with a deprecation warning at compile time.

## Consumer obligations

Consumers (catalogs, governance tools, AI agents):

- MUST tolerate unknown OPTIONAL fields silently.
- MUST validate before consuming.
- SHOULD support a window of two consecutive majors during transition
  periods.

## RFC process

Breaking changes require a public RFC in this repo's GitHub Discussions
before any schema PR is opened. The RFC must list:

- The motivation.
- The breaking change(s).
- Migration steps for producers and consumers.
- A target deprecation timeline.

Discussions stay open for a minimum of 14 days for community feedback before
any schema change lands.

## Stability commitments

- v1 is supported through at least 2027-05-01.
- The next major (v2) requires the RFC process above.
- Deprecations are announced via this repo's CHANGELOG and via release notes
  in DataLex and DQL.
