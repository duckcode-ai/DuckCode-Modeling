# DataLex 90-second demo — run `vhs demo/demo.tape` from the repo root.
#
# Produces demo/demo.gif showing the jaffle_shop zero-setup dbt sync path:
# build a local DuckDB warehouse, sync it into DataLex YAML, emit back to
# dbt YAML with contracts enforced. No external credentials.
#
# Requires: vhs (https://github.com/charmbracelet/vhs) and the repo's
# `.[duckdb]` extra installed. Run `vhs demo/demo.tape` and commit the
# resulting demo.gif alongside this file.

Output demo/demo.gif

Set FontSize 16
Set Width 1400
Set Height 800
Set Theme "Dracula"
Set Shell "bash"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0

# Clean slate so the tape is repeatable.
Hide
Type "rm -rf examples/jaffle_shop_demo/datalex-out examples/jaffle_shop_demo/dbt-out examples/jaffle_shop_demo/warehouse.duckdb"
Enter
Type "clear"
Enter
Show

Sleep 500ms

Type "# 1. Build a local DuckDB warehouse — no external credentials."
Sleep 1500ms
Enter
Type "python3 examples/jaffle_shop_demo/setup.py"
Enter
Sleep 2s

Type "clear"
Enter

Type "# 2. Sync the dbt project into DataLex YAML."
Sleep 1500ms
Enter
Type "./datalex datalex dbt sync examples/jaffle_shop_demo --out-root examples/jaffle_shop_demo/datalex-out"
Enter
Sleep 3s

Type "clear"
Enter

Type "# Every column carries its warehouse type and a dbt unique_id stamp."
Sleep 1500ms
Enter
Type "head -25 examples/jaffle_shop_demo/datalex-out/sources/jaffle_shop_raw.yaml"
Enter
Sleep 4s

Type "clear"
Enter

Type "# 3. Emit dbt-parseable YAML with contract.enforced = true."
Sleep 1500ms
Enter
Type "./datalex datalex dbt emit examples/jaffle_shop_demo/datalex-out --out-dir examples/jaffle_shop_demo/dbt-out"
Enter
Sleep 3s

Type "clear"
Enter

Type "# Contracts enforced, data_type on every column — dbt parse passes."
Sleep 1500ms
Enter
Type "cat examples/jaffle_shop_demo/dbt-out/models/_schema.yml"
Enter
Sleep 6s

# Final beat — let the viewer read the schema one more time before loop.
Sleep 1500ms
