from dm_core.canonical import compile_model
from dm_core.diffing import project_diff, semantic_diff
from dm_core.docs_generator import (
    generate_changelog,
    generate_html_docs,
    generate_markdown_docs,
    write_changelog,
    write_html_docs,
    write_markdown_docs,
)
from dm_core.completion import generate_bash_completion, generate_fish_completion, generate_zsh_completion
from dm_core.doctor import diagnostics_as_json, format_diagnostics, run_diagnostics
from dm_core.generators import dbt_scaffold_files, generate_sql_ddl, write_dbt_scaffold
from dm_core.migrate import generate_migration, write_migration
from dm_core.importers import (
    import_dbt_schema_yml,
    import_dbml,
    import_spark_schema,
    import_sql_ddl,
    sync_dbt_schema_yml,
)
from dm_core.connectors.base import ConnectorConfig, ConnectorResult, get_connector, list_connectors
from dm_core.loader import load_yaml_model
from dm_core.policy import (
    load_policy_pack,
    load_policy_pack_with_inheritance,
    merge_policy_packs,
    policy_issues,
)
from dm_core.resolver import resolve_model, resolve_project
from dm_core.schema import load_schema, schema_issues
from dm_core.semantic import (
    completeness_as_dict,
    completeness_report,
    lint_issues,
    EntityCompleteness,
    ModelCompleteness,
)

__all__ = [
    "compile_model",
    "completeness_as_dict",
    "completeness_report",
    "ConnectorConfig",
    "ConnectorResult",
    "dbt_scaffold_files",
    "diagnostics_as_json",
    "EntityCompleteness",
    "format_diagnostics",
    "generate_bash_completion",
    "generate_fish_completion",
    "generate_migration",
    "generate_changelog",
    "generate_html_docs",
    "generate_markdown_docs",
    "generate_sql_ddl",
    "generate_zsh_completion",
    "import_dbml",
    "import_dbt_schema_yml",
    "import_spark_schema",
    "import_sql_ddl",
    "lint_issues",
    "load_policy_pack",
    "load_policy_pack_with_inheritance",
    "merge_policy_packs",
    "load_schema",
    "load_yaml_model",
    "ModelCompleteness",
    "policy_issues",
    "project_diff",
    "resolve_model",
    "resolve_project",
    "schema_issues",
    "semantic_diff",
    "run_diagnostics",
    "write_changelog",
    "write_dbt_scaffold",
    "write_migration",
    "write_html_docs",
    "write_markdown_docs",
    "sync_dbt_schema_yml",
]
