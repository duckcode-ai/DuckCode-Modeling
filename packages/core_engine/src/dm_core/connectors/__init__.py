"""Database connectors for pulling schema from live databases.

Each connector implements the same interface:
  pull_schema(connection_string, schema=None, tables=None, **kwargs) -> Dict[str, Any]

Returns a DuckCodeModeling model dict ready for use.
"""

from dm_core.connectors.base import (
    BaseConnector,
    ConnectorConfig,
    ConnectorResult,
    get_connector,
    list_connectors,
)
from dm_core.connectors.postgres import PostgresConnector
from dm_core.connectors.mysql import MySQLConnector
from dm_core.connectors.snowflake import SnowflakeConnector
from dm_core.connectors.bigquery import BigQueryConnector
from dm_core.connectors.databricks import DatabricksConnector

__all__ = [
    "BaseConnector",
    "BigQueryConnector",
    "ConnectorConfig",
    "ConnectorResult",
    "DatabricksConnector",
    "MySQLConnector",
    "PostgresConnector",
    "SnowflakeConnector",
    "get_connector",
    "list_connectors",
]
