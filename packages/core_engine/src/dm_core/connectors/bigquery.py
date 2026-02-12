"""BigQuery connector — pulls schema from INFORMATION_SCHEMA."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import BaseConnector, ConnectorConfig, ConnectorResult, infer_primary_keys, infer_relationships


_BQ_TYPE_MAP = {
    "STRING": "string",
    "BYTES": "binary",
    "INT64": "bigint",
    "INTEGER": "integer",
    "FLOAT64": "float",
    "FLOAT": "float",
    "NUMERIC": "decimal",
    "BIGNUMERIC": "decimal",
    "BOOLEAN": "boolean",
    "BOOL": "boolean",
    "TIMESTAMP": "timestamp",
    "DATE": "date",
    "TIME": "time",
    "DATETIME": "timestamp",
    "GEOGRAPHY": "string",
    "RECORD": "json",
    "STRUCT": "json",
    "ARRAY": "json",
    "JSON": "json",
}


class BigQueryConnector(BaseConnector):
    connector_type = "bigquery"
    display_name = "Google BigQuery"
    required_package = "google.cloud.bigquery"

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            from google.cloud import bigquery
            client = bigquery.Client(project=config.project)
            datasets = list(client.list_datasets(max_results=1))
            return True, "Connection successful"
        except ImportError:
            return False, "google-cloud-bigquery not installed. Run: pip install google-cloud-bigquery"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        from google.cloud import bigquery
        client = bigquery.Client(project=config.project)
        results = []
        for ds in client.list_datasets():
            ds_ref = ds.reference
            try:
                tables = list(client.list_tables(ds_ref))
                count = len(tables)
            except Exception:
                count = 0
            results.append({"name": ds.dataset_id, "table_count": count})
        return sorted(results, key=lambda x: x["name"])

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        from google.cloud import bigquery
        client = bigquery.Client(project=config.project)
        dataset = config.dataset
        if not dataset:
            return []
        results = []
        for tbl in client.list_tables(f"{config.project}.{dataset}"):
            ttype = "view" if tbl.table_type == "VIEW" else "table"
            # Get column count
            try:
                full = client.get_table(tbl.reference)
                col_count = len(full.schema)
                row_count = full.num_rows
            except Exception:
                col_count = 0
                row_count = None
            results.append({"name": tbl.table_id, "type": ttype, "column_count": col_count, "row_count": row_count})
        return sorted(results, key=lambda x: x["name"])

    def pull_schema(self, config: ConnectorConfig) -> ConnectorResult:
        from google.cloud import bigquery

        client = bigquery.Client(project=config.project)
        return self._pull(client, config)

    def _pull(self, client: Any, config: ConnectorConfig) -> ConnectorResult:
        model = self._build_model(config)
        project = config.project
        dataset = config.dataset
        warnings: List[str] = []

        if not dataset:
            warnings.append("No dataset specified. Use --dataset to filter.")
            return ConnectorResult(model=model, warnings=warnings)

        # --- Tables ---
        query = f"""
            SELECT table_name, table_type
            FROM `{project}.{dataset}.INFORMATION_SCHEMA.TABLES`
            ORDER BY table_name
        """
        rows = client.query(query).result()

        table_entities: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            table_name = row.table_name
            table_type = row.table_type
            if not self._should_include_table(table_name, config):
                continue
            entity_name = self._entity_name(table_name)
            entity_type = "view" if "VIEW" in table_type else "table"
            table_entities[table_name] = {
                "name": entity_name,
                "type": entity_type,
                "description": f"Pulled from BigQuery {project}.{dataset}.{table_name} on {date.today().isoformat()}",
                "fields": [],
                "schema": dataset,
                "database": project,
            }

        # --- Columns ---
        query = f"""
            SELECT table_name, column_name, data_type, is_nullable
            FROM `{project}.{dataset}.INFORMATION_SCHEMA.COLUMNS`
            ORDER BY table_name, ordinal_position
        """
        col_rows = client.query(query).result()
        total_columns = 0

        for row in col_rows:
            tname = row.table_name
            if tname not in table_entities:
                continue

            data_type = row.data_type or "STRING"
            dl_type = _BQ_TYPE_MAP.get(data_type.upper(), "string")

            field: Dict[str, Any] = {
                "name": row.column_name,
                "type": dl_type,
                "nullable": row.is_nullable == "YES",
            }
            table_entities[tname]["fields"].append(field)
            total_columns += 1

        # --- Primary keys (BigQuery table constraints) ---
        try:
            pk_query = f"""
                SELECT table_name, column_name
                FROM `{project}.{dataset}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE`
                WHERE constraint_name LIKE '%pk%' OR constraint_name LIKE '%primary%'
            """
            pk_rows = client.query(pk_query).result()
            for row in pk_rows:
                if row.table_name in table_entities:
                    for f in table_entities[row.table_name]["fields"]:
                        if f["name"] == row.column_name:
                            f["primary_key"] = True
                            f["nullable"] = False
        except Exception as e:
            warnings.append(f"Could not fetch primary keys: {e}")

        # --- Foreign keys ---
        relationships: List[Dict[str, Any]] = []
        try:
            fk_query = f"""
                SELECT
                    tc.table_name AS child_table,
                    kcu.column_name AS child_column,
                    ccu.table_name AS parent_table,
                    ccu.column_name AS parent_column,
                    tc.constraint_name
                FROM `{project}.{dataset}.INFORMATION_SCHEMA.TABLE_CONSTRAINTS` tc
                JOIN `{project}.{dataset}.INFORMATION_SCHEMA.KEY_COLUMN_USAGE` kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN `{project}.{dataset}.INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE` ccu
                  ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
            """
            fk_rows = client.query(fk_query).result()
            for row in fk_rows:
                parent_entity = self._entity_name(row.parent_table)
                child_entity = self._entity_name(row.child_table)
                if row.child_table in table_entities:
                    for f in table_entities[row.child_table]["fields"]:
                        if f["name"] == row.child_column:
                            f["foreign_key"] = True
                relationships.append({
                    "name": row.constraint_name or f"{parent_entity.lower()}_{child_entity.lower()}_{row.child_column}_fk",
                    "from": f"{parent_entity}.{row.parent_column}",
                    "to": f"{child_entity}.{row.child_column}",
                    "cardinality": "one_to_many",
                })
        except Exception as e:
            warnings.append(f"Could not fetch foreign keys: {e}")

        entities_list = list(table_entities.values())

        # --- Inference: fill in PKs and FKs when constraints are missing ---
        has_any_pk = any(
            f.get("primary_key") for ent in entities_list for f in ent.get("fields", [])
        )
        if not has_any_pk:
            entities_list, pk_msgs = infer_primary_keys(entities_list)
            warnings.extend(pk_msgs)

        if not relationships:
            inferred_rels, fk_msgs = infer_relationships(entities_list, relationships)
            relationships.extend(inferred_rels)
            warnings.extend(fk_msgs)
            if inferred_rels:
                warnings.insert(0, f"No FK constraints found — inferred {len(inferred_rels)} relationships from column naming patterns.")

        model["entities"] = entities_list
        model["relationships"] = relationships

        return ConnectorResult(
            model=model,
            tables_found=len(table_entities),
            columns_found=total_columns,
            relationships_found=len(relationships),
            indexes_found=0,
            warnings=warnings,
        )
