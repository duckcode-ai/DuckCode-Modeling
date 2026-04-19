# DataLex demo GIF

`demo.tape` is a [vhs](https://github.com/charmbracelet/vhs) script that
records a ~90-second terminal GIF of the jaffle_shop zero-setup dbt sync
flow. The generated `demo.gif` is embedded in the repo's root
[README.md](../README.md).

## Regenerate the GIF

```bash
# one-time: install vhs
brew install vhs          # macOS
# or: go install github.com/charmbracelet/vhs@latest

# one-time: make sure the Python package is installed with duckdb extras
pip install -e '.[duckdb]'

# from the repo root:
vhs demo/demo.tape
```

The tape script cleans up `examples/jaffle_shop_demo/warehouse.duckdb`,
`datalex-out/`, and `dbt-out/` on entry, so re-running is safe. It writes
to `demo/demo.gif`.

Commit the regenerated `demo.gif` in a separate commit so diffs stay
readable.

## Why vhs

- **Reproducible** — the tape is plain text in version control. Anyone
  can diff it, tweak timing, or regenerate after a UI change.
- **No recording session required** — no screen capture software, no
  voiceover, no manual typing. Everything is scripted.
- **Resolution-stable** — `Set Width 1400 Set Height 800` pins the
  output shape so README embedding doesn't shift.

## Editing the tape

Common edits:

- **Change the command path** — if CLI subcommand names change
  (e.g., flattening the `datalex datalex` nesting in
  [issue #9](https://github.com/duckcode-ai/DataLex/issues/9)), update
  the `Type "..."` lines here too.
- **Tune pacing** — `Sleep <ms>` controls the dwell time between
  commands. Set `TypingSpeed` at the top for keystroke rhythm.
- **Shorten** — drop the `cat .../models/_schema.yml` step if you want
  a sub-60s version.

Keep total runtime under ~90s — longer GIFs blow up file size and
READMEs loop poorly.
