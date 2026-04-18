# Releasing DataLex

DataLex ships the `datalex-cli` Python package on PyPI plus tagged GitHub
releases. Every release is cut from a signed semver tag; CI handles the rest.

## One-time PyPI setup

The first release needs a PyPI "trusted publisher" entry so our GitHub
Actions workflow can publish without storing a long-lived API token.

1. Create (or log in to) an account at <https://pypi.org/>.
2. Visit <https://pypi.org/manage/account/publishing/>.
3. Under **Add a new pending publisher**, fill in:

   | Field | Value |
   |---|---|
   | PyPI Project Name | `datalex-cli` |
   | Owner | `duckcode-ai` |
   | Repository name | `DataLex` |
   | Workflow name | `publish.yml` |
   | Environment name | `pypi` |

4. Submit. PyPI now trusts GitHub Actions runs from
   `duckcode-ai/DataLex` in the `pypi` environment to publish the
   `datalex-cli` project.

On the GitHub side, create an environment called `pypi` under
**Settings → Environments**. Optionally require a reviewer there so
publishes pause for human approval.

## Cutting a release

1. **Bump the version** in `pyproject.toml` (`project.version`).
2. **Update `CHANGELOG.md`** — move items from `[Unreleased]` into a new
   `[X.Y.Z] — YYYY-MM-DD` section. Add the compare link at the bottom.
3. **Open a PR**. Merge once green.
4. **Tag from `main`**:

   ```bash
   git checkout main
   git pull
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

5. The `Publish to PyPI` workflow fires on the tag. It builds an sdist
   and wheel, verifies the bundled JSON Schemas are in the wheel, and
   uploads to PyPI via OIDC.
6. **Draft the GitHub release** at
   <https://github.com/duckcode-ai/DataLex/releases/new> with the tag
   selected. Paste the new `CHANGELOG.md` section as the release notes.

## Dry-run locally

Before tagging, verify the artifacts build cleanly:

```bash
python3 -m pip install --upgrade build twine
rm -rf dist/ build/
python3 -m build
python3 -m twine check dist/*
```

Smoke-test the wheel in a throwaway venv:

```bash
python3 -m venv /tmp/dl-smoke
/tmp/dl-smoke/bin/pip install dist/datalex_cli-*.whl
/tmp/dl-smoke/bin/datalex --help
```

## Versioning policy

- `0.x.y` — pre-1.0, breaking changes may land on minor bumps, but
  always called out in `CHANGELOG.md`.
- `1.0.0` and after — strict [semver](https://semver.org/): breaking
  changes require a major bump.

Security patches backport only to the most recent tagged release. See
[SECURITY.md](SECURITY.md) for the supported-versions matrix and
reporting process.
