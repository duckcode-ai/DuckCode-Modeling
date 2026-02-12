"""Base connector interface and registry for database connectors."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ConnectorConfig:
    """Configuration for a database connector."""

    connector_type: str
    host: str = ""
    port: int = 0
    database: str = ""
    schema: str = ""
    user: str = ""
    password: str = ""
    warehouse: str = ""
    project: str = ""
    dataset: str = ""
    catalog: str = ""
    token: str = ""
    private_key_path: str = ""
    connection_string: str = ""
    tables: Optional[List[str]] = None
    exclude_tables: Optional[List[str]] = None
    model_name: str = "imported_model"
    domain: str = "imported"
    owners: Optional[List[str]] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def effective_owners(self) -> List[str]:
        return self.owners or ["data-team@example.com"]


@dataclass
class ConnectorResult:
    """Result of a schema pull operation."""

    model: Dict[str, Any]
    tables_found: int = 0
    columns_found: int = 0
    relationships_found: int = 0
    indexes_found: int = 0
    warnings: List[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [
            f"Tables: {self.tables_found}",
            f"Columns: {self.columns_found}",
            f"Relationships: {self.relationships_found}",
            f"Indexes: {self.indexes_found}",
        ]
        if self.warnings:
            lines.append(f"Warnings: {len(self.warnings)}")
            for w in self.warnings:
                lines.append(f"  - {w}")
        return "\n".join(lines)


def _to_pascal(name: str) -> str:
    name = name.replace('"', "")
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _to_model_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
    return cleaned or "imported_model"


def _default_model(model_name: str, domain: str, owners: List[str]) -> Dict[str, Any]:
    return {
        "model": {
            "name": _to_model_name(model_name),
            "version": "1.0.0",
            "domain": domain,
            "owners": owners,
            "state": "draft",
        },
        "entities": [],
        "relationships": [],
        "indexes": [],
        "governance": {"classification": {}, "stewards": {}},
        "rules": [],
    }


# ---------------------------------------------------------------------------
# Relationship & PK inference for databases without constraints
# ---------------------------------------------------------------------------

# Common PK column patterns (case-insensitive)
_PK_PATTERNS = [
    re.compile(r"^id$", re.IGNORECASE),
    re.compile(r"^pk$", re.IGNORECASE),
    re.compile(r"^(.+)_id$", re.IGNORECASE),  # only if matches table name
    re.compile(r"^(.+)_pk$", re.IGNORECASE),
]

# Common FK column patterns: <table>_id, <table>_fk, <table>Id, fk_<table>
_FK_PATTERNS = [
    re.compile(r"^(.+)_id$", re.IGNORECASE),
    re.compile(r"^(.+)_fk$", re.IGNORECASE),
    re.compile(r"^fk_(.+)$", re.IGNORECASE),
    re.compile(r"^(.+)Id$"),  # camelCase: orderId, userId
]


def _normalize(name: str) -> str:
    """Normalize a name for fuzzy matching: lowercase, strip underscores/hyphens."""
    return re.sub(r"[_\-\s]+", "", name).lower()


def _plurals(name: str) -> List[str]:
    """Return plausible singular/plural variants of a normalized name."""
    variants = []
    if name.endswith("ies"):
        variants.append(name[:-3] + "y")       # "categories" → "category"
    if name.endswith("ses") or name.endswith("xes") or name.endswith("zes"):
        variants.append(name[:-2])              # "addresses" → "address"
    if name.endswith("s") and not name.endswith("ss"):
        variants.append(name[:-1])              # "orders" → "order"
    if not name.endswith("s"):
        variants.append(name + "s")             # "order" → "orders"
    if name.endswith("y") and not name.endswith("ey"):
        variants.append(name[:-1] + "ies")      # "category" → "categories"
    return variants


def _build_entity_lookup(entities: List[Dict[str, Any]]) -> Dict[str, str]:
    """Build a lookup from normalized table/entity name → actual entity name.

    Includes both the entity name and singular/plural variants for flexible matching.
    """
    lookup: Dict[str, str] = {}
    for entity in entities:
        ename = entity["name"]
        norm = _normalize(ename)
        lookup[norm] = ename
        for variant in _plurals(norm):
            if variant not in lookup:
                lookup[variant] = ename
    return lookup


def infer_primary_keys(entities: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Infer primary keys for entities that have no PK defined.

    Heuristics (in priority order):
    1. Column named exactly 'id'
    2. Column named '<table_name>_id' (e.g., order_id in orders table)
    3. Column named '<table_name>_pk'
    4. First column if it ends with '_id' or '_pk'

    Returns (modified entities, list of inference messages).
    """
    messages: List[str] = []

    for entity in entities:
        fields = entity.get("fields", [])
        # Skip if any field already has primary_key
        if any(f.get("primary_key") for f in fields):
            continue
        if not fields:
            continue

        ename_norm = _normalize(entity["name"])
        inferred_pk = None

        # Priority 1: column named 'id'
        for f in fields:
            if f["name"].lower() == "id":
                inferred_pk = f
                break

        # Priority 2: column named '<entity>_id' or '<entity>_pk'
        if not inferred_pk:
            for f in fields:
                fname = f["name"].lower()
                if fname == f"{ename_norm}_id" or fname == f"{ename_norm}_pk":
                    inferred_pk = f
                    break

        # Priority 3: first column ending in _id or _pk
        if not inferred_pk:
            for f in fields:
                fname = f["name"].lower()
                if fname.endswith("_id") or fname.endswith("_pk"):
                    inferred_pk = f
                    break

        if inferred_pk:
            inferred_pk["primary_key"] = True
            inferred_pk["nullable"] = False
            messages.append(f"Inferred PK: {entity['name']}.{inferred_pk['name']}")

    return entities, messages


def infer_relationships(
    entities: List[Dict[str, Any]],
    existing_relationships: Optional[List[Dict[str, Any]]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Infer foreign key relationships from column naming conventions.

    Detects patterns like:
    - user_id in orders table → Orders.user_id references Users.id
    - customer_fk in invoices → Invoices.customer_fk references Customers.id
    - fk_product in line_items → LineItems.fk_product references Products.id

    Only creates relationships to entities that actually exist in the model.
    Skips columns that are already marked as primary_key.

    Returns (list of inferred relationships, list of inference messages).
    """
    existing = existing_relationships or []
    existing_pairs = set()
    for rel in existing:
        existing_pairs.add((rel.get("from", ""), rel.get("to", "")))

    entity_lookup = _build_entity_lookup(entities)

    # Build a map of entity_name → its PK field name
    pk_map: Dict[str, str] = {}
    for entity in entities:
        for f in entity.get("fields", []):
            if f.get("primary_key"):
                pk_map[entity["name"]] = f["name"]
                break
        # Default to 'id' if no PK found
        if entity["name"] not in pk_map:
            pk_map[entity["name"]] = "id"

    inferred: List[Dict[str, Any]] = []
    messages: List[str] = []

    for entity in entities:
        entity_name = entity["name"]
        for f in entity.get("fields", []):
            # Skip fields already marked as PK
            if f.get("primary_key"):
                continue
            # Skip fields already marked as FK
            if f.get("foreign_key"):
                continue

            fname = f["name"]
            ref_table_norm = None

            # Try each FK pattern
            for pattern in _FK_PATTERNS:
                m = pattern.match(fname)
                if m:
                    ref_table_norm = _normalize(m.group(1))
                    break

            if not ref_table_norm:
                continue

            # Don't self-reference via the entity's own name_id pattern
            if ref_table_norm == _normalize(entity_name):
                continue

            # Look up the referenced entity
            ref_entity = entity_lookup.get(ref_table_norm)
            if not ref_entity:
                continue

            # Build the relationship
            ref_pk = pk_map.get(ref_entity, "id")
            from_key = f"{ref_entity}.{ref_pk}"
            to_key = f"{entity_name}.{fname}"

            # Skip if this relationship already exists
            if (from_key, to_key) in existing_pairs:
                continue

            f["foreign_key"] = True
            rel_name = f"{_normalize(ref_entity)}_{_normalize(entity_name)}_{fname}_inferred"
            inferred.append({
                "name": rel_name,
                "from": from_key,
                "to": to_key,
                "cardinality": "one_to_many",
                "inferred": True,
            })
            existing_pairs.add((from_key, to_key))
            messages.append(f"Inferred FK: {entity_name}.{fname} → {ref_entity}.{ref_pk}")

    return inferred, messages


class BaseConnector(ABC):
    """Abstract base class for all database connectors."""

    connector_type: str = ""
    display_name: str = ""
    required_package: str = ""

    @abstractmethod
    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        """Test if the connection can be established.

        Returns (success, message).
        """

    @abstractmethod
    def pull_schema(self, config: ConnectorConfig) -> ConnectorResult:
        """Pull schema from the database and return a ConnectorResult."""

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        """List available schemas/datasets in the database.

        Returns a list of dicts with at least: {"name": str, "table_count": int}.
        Override in subclasses.
        """
        return []

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        """List tables in the configured schema.

        Returns a list of dicts with at least:
        {"name": str, "type": str, "row_count": int|None, "column_count": int}.
        Override in subclasses.
        """
        return []

    def check_driver(self) -> Tuple[bool, str]:
        """Check if the required Python driver package is installed."""
        if not self.required_package:
            return True, "No driver required"
        try:
            __import__(self.required_package)
            return True, f"{self.required_package} is installed"
        except ImportError:
            return False, f"Missing driver: pip install {self.required_package}"

    def _build_model(self, config: ConnectorConfig) -> Dict[str, Any]:
        return _default_model(
            model_name=config.model_name,
            domain=config.domain,
            owners=config.effective_owners(),
        )

    def _entity_name(self, table_name: str) -> str:
        return _to_pascal(table_name)

    def _should_include_table(self, table_name: str, config: ConnectorConfig) -> bool:
        if config.tables and table_name not in config.tables:
            return False
        if config.exclude_tables and table_name in config.exclude_tables:
            return False
        return True


# ---------------------------------------------------------------------------
# Connector registry
# ---------------------------------------------------------------------------

_REGISTRY: Dict[str, BaseConnector] = {}


def _register(connector: BaseConnector) -> None:
    _REGISTRY[connector.connector_type] = connector


def get_connector(connector_type: str) -> Optional[BaseConnector]:
    """Get a connector by type name."""
    return _REGISTRY.get(connector_type)


def list_connectors() -> List[Dict[str, str]]:
    """List all registered connectors."""
    result = []
    for name, conn in sorted(_REGISTRY.items()):
        ok, msg = conn.check_driver()
        result.append({
            "type": name,
            "name": conn.display_name,
            "driver": conn.required_package or "none",
            "installed": ok,
            "status": msg,
        })
    return result


def register_all() -> None:
    """Register all built-in connectors."""
    from dm_core.connectors.postgres import PostgresConnector
    from dm_core.connectors.mysql import MySQLConnector
    from dm_core.connectors.snowflake import SnowflakeConnector
    from dm_core.connectors.bigquery import BigQueryConnector
    from dm_core.connectors.databricks import DatabricksConnector
    from dm_core.connectors.sqlserver import SQLServerConnector, AzureSQLConnector, AzureFabricConnector
    from dm_core.connectors.redshift import RedshiftConnector

    for cls in [
        PostgresConnector,
        MySQLConnector,
        SnowflakeConnector,
        BigQueryConnector,
        DatabricksConnector,
        SQLServerConnector,
        AzureSQLConnector,
        AzureFabricConnector,
        RedshiftConnector,
    ]:
        _register(cls())


register_all()
