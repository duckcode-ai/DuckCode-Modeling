# jaffle_shop demo — dbt sync in 60 seconds

Zero warehouse credentials required. Everything runs offline against a local
DuckDB file.

## Run it

```bash
# one-time: install duckdb (if you don't already have it)
pip install duckdb

cd examples/jaffle_shop_demo
python setup.py                              # builds warehouse.duckdb

dm datalex dbt sync . --out-root datalex-out # syncs into DataLex YAML

ls datalex-out/sources datalex-out/models/dbt
```

## What just happened

1. `setup.py` built a small DuckDB file with three raw tables
   (`raw_customers`, `raw_orders`, `raw_payments`) and two dbt models
   (`stg_customers`, `customers`).
2. `dm datalex dbt sync` read `target/manifest.json`, resolved the `dev`
   target in `profiles.yml` (DuckDB pointing at `./warehouse.duckdb`),
   introspected every table's column types, and merged them into
   DataLex-shaped YAML under `datalex-out/`.
3. Every DataLex file carries a `meta.datalex.dbt.unique_id` stamp, so
   re-running the sync after a dbt model change updates the existing files
   instead of clobbering user-authored descriptions or tags.

## Next steps

- Emit back to dbt-parseable YAML with contracts enforced:
  ```bash
  dm datalex dbt emit datalex-out --out-dir dbt-out
  ```
  The resulting `dbt-out/sources/*.yml` and `dbt-out/models/_schema.yml`
  include `contract.enforced: true` and `data_type:` on every column.

- Run DDL generation for a different dialect:
  ```bash
  dm datalex emit ddl datalex-out --dialect snowflake
  ```
