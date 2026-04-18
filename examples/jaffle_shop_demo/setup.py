"""Build a local DuckDB warehouse for the demo.

Creates `warehouse.duckdb` next to this file, populated with three raw tables
(`raw_customers`, `raw_orders`, `raw_payments`) and two dbt model outputs
(`stg_customers`, `customers`). The manifest.json shipped under `target/`
already describes these; running `dm datalex dbt sync .` will then merge
warehouse types into the DataLex YAML tree.

Usage:
    cd examples/jaffle_shop_demo
    python setup.py
    dm datalex dbt sync . --out-root datalex-out/
"""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    try:
        import duckdb  # type: ignore
    except ImportError:
        print("This demo needs duckdb. Install with: pip install duckdb", file=sys.stderr)
        return 1

    here = Path(__file__).resolve().parent
    db_path = here / "warehouse.duckdb"
    if db_path.exists():
        db_path.unlink()

    con = duckdb.connect(str(db_path))
    try:
        con.execute(
            """
            CREATE TABLE raw_customers (
                id INTEGER PRIMARY KEY,
                first_name VARCHAR,
                last_name VARCHAR
            );
            INSERT INTO raw_customers VALUES
              (1, 'Michael', 'P.'),
              (2, 'Shawn', 'M.'),
              (3, 'Kathleen', 'P.');

            CREATE TABLE raw_orders (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                order_date DATE,
                status VARCHAR
            );
            INSERT INTO raw_orders VALUES
              (1, 1, DATE '2024-01-01', 'completed'),
              (2, 2, DATE '2024-01-02', 'completed'),
              (3, 1, DATE '2024-01-03', 'shipped');

            CREATE TABLE raw_payments (
                id INTEGER PRIMARY KEY,
                order_id INTEGER,
                payment_method VARCHAR,
                amount DECIMAL(10, 2)
            );
            INSERT INTO raw_payments VALUES
              (1, 1, 'credit_card', 10.00),
              (2, 2, 'coupon',       0.00),
              (3, 3, 'credit_card', 25.50);

            CREATE VIEW stg_customers AS
              SELECT id AS customer_id, first_name, last_name FROM raw_customers;

            CREATE TABLE customers AS
              SELECT
                c.customer_id,
                c.first_name,
                c.last_name,
                COUNT(o.id)        AS number_of_orders,
                SUM(p.amount)      AS customer_lifetime_value
              FROM stg_customers c
              LEFT JOIN raw_orders o   ON o.user_id = c.customer_id
              LEFT JOIN raw_payments p ON p.order_id = o.id
              GROUP BY 1, 2, 3;
            """
        )
    finally:
        con.close()

    print(f"Built demo warehouse at: {db_path}")
    print()
    print("Next: from this directory, run")
    print("    dm datalex dbt sync . --out-root datalex-out")
    return 0


if __name__ == "__main__":
    sys.exit(main())
