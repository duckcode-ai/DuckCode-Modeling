# Changelog

All notable changes to the manifest spec will be documented here. Versions
follow SemVer and the policy in [versioning.md](versioning.md).

## [Unreleased]

## [1.0.0] - 2026-05-01

Initial public release.

### Added
- DataLex manifest schema covering domains, entities, contracts, governance,
  and rules at conceptual / logical / physical layers.
- DQL manifest schema covering blocks, apps, dashboards, lineage edges, and
  certification status.
- Cross-reference contract: DQL blocks declare `datalex_contract` to bind to
  a DataLex contract id. DQL compilers SHOULD enforce this at compile time
  starting at DQL 1.6.x.
- [`interop.md`](interop.md) describing the bridge.
- [`versioning.md`](versioning.md) describing the breaking-change discipline.
- Minimal example manifests for both languages.

### Producers
- DataLex 1.8.x emits manifests validated against `v1`.
- DQL 1.5.x emits manifests validated against `v1`.
