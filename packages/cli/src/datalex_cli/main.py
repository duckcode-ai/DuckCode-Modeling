import argparse
import glob
import json
import hashlib
import importlib.metadata
import re
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

import yaml

from datalex_core import (
    apply_standards_fixes,
    compile_model,
    completeness_as_dict,
    completeness_report,
    diagnostics_as_json,
    format_diagnostics,
    generate_bash_completion,
    generate_changelog,
    generate_fish_completion,
    generate_html_docs,
    generate_markdown_docs,
    generate_migration,
    generate_sql_ddl,
    generate_zsh_completion,
    ConnectorConfig,
    get_connector,
    import_dbt_schema_yml,
    import_dbml,
    import_spark_schema,
    import_sql_ddl,
    sync_dbt_schema_yml,
    list_connectors,
    lint_issues,
    load_policy_pack,
    load_policy_pack_with_inheritance,
    load_schema,
    load_yaml_model,
    merge_policy_packs,
    merge_models_preserving_docs,
    policy_issues,
    project_diff,
    resolve_model,
    resolve_project,
    run_diagnostics,
    schema_issues,
    semantic_diff,
    standards_issues,
    transform_model,
    write_changelog,
    write_dbt_scaffold,
    write_html_docs,
    write_markdown_docs,
    write_migration,
)
from datalex_core.issues import Issue, has_errors, to_lines

STARTER_MODEL = """model:
  name: starter_model
  version: 1.0.0
  domain: demo
  owners:
    - data-team@example.com
  state: draft

entities:
  - name: User
    type: table
    fields:
      - name: user_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
"""


def _cli_version() -> str:
    pyproject = Path(__file__).resolve().parents[4] / "pyproject.toml"
    try:
        text = pyproject.read_text(encoding="utf-8")
    except OSError:
        text = ""
    if text:
        m = re.search(r'(?m)^version = "([^"]+)"$', text)
        if m:
            return m.group(1)
    try:
        return importlib.metadata.version("datalex-cli")
    except importlib.metadata.PackageNotFoundError:
        return "unknown"

MULTI_MODEL_SHARED = """model:
  name: shared_dimensions
  spec_version: 2
  version: 1.0.0
  domain: shared
  owners:
    - data-team@example.com
  state: draft
  description: Shared dimension entities used across domain models

entities:
  - name: Customer
    type: table
    description: Customer master record
    schema: shared
    subject_area: customer_domain
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
        unique: true
      - name: full_name
        type: string
        nullable: false
      - name: created_at
        type: timestamp
        nullable: false

indexes:
  - name: idx_customer_email
    entity: Customer
    fields: [email]
    unique: true
"""

MULTI_MODEL_ORDERS = """model:
  name: orders
  spec_version: 2
  version: 1.0.0
  domain: sales
  owners:
    - data-team@example.com
  state: draft
  description: Order domain model
  imports:
    - model: shared_dimensions
      alias: shared
      entities: [Customer]

entities:
  - name: Order
    type: table
    description: Customer orders
    schema: sales
    subject_area: order_domain
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
        foreign_key: true
      - name: total_amount
        type: decimal(12,2)
        nullable: false
      - name: order_date
        type: timestamp
        nullable: false

relationships:
  - name: order_customer
    from: Order.customer_id
    to: Customer.customer_id
    cardinality: many_to_one
    description: Order belongs to a customer (cross-model)
"""

END_TO_END_SOURCE = """model:
  name: source_sales_raw
  spec_version: 2
  version: 1.0.0
  domain: sales
  owners:
    - data-platform@example.com
  state: draft
  layer: source
  description: Source layer contract pulled from warehouse raw schemas.

entities:
  - name: RawCustomers
    type: table
    description: Raw customer profile records from CRM.
    tags: [BRONZE, SOURCE, CUSTOMER]
    schema: raw
    subject_area: customer_domain
    owner: customer-data@example.com
    grain: [customer_id]
    sla:
      freshness: 4h
      quality_score: 98
    fields:
      - name: customer_id
        type: string
        primary_key: true
        nullable: false
        description: Stable customer identifier from CRM.
        tags: [IDENTIFIER]
      - name: email
        type: string
        nullable: false
        description: Customer email from source system.
        tags: [PII, CONTACT]
        sensitivity: restricted
      - name: created_at
        type: timestamp
        nullable: false
        description: Customer creation timestamp from source.
        tags: [AUDIT]

  - name: RawOrders
    type: table
    description: Raw order transactions from commerce platform.
    tags: [BRONZE, SOURCE, ORDER]
    schema: raw
    subject_area: order_domain
    owner: order-data@example.com
    grain: [order_id]
    sla:
      freshness: 2h
      quality_score: 97
    fields:
      - name: order_id
        type: string
        primary_key: true
        nullable: false
        description: Unique order identifier.
        tags: [IDENTIFIER]
      - name: customer_id
        type: string
        nullable: false
        foreign_key: true
        description: Customer identifier attached to the order.
        tags: [JOIN_KEY]
      - name: order_ts
        type: timestamp
        nullable: false
        description: Order creation timestamp.
        tags: [EVENT_TIME]
      - name: gross_amount
        type: decimal(12,2)
        nullable: false
        description: Total order amount before discounts and tax allocations.
        tags: [AMOUNT, FINANCE]
      - name: status
        type: string
        nullable: false
        description: Raw order lifecycle status.
        tags: [STATUS]

relationships:
  - name: raw_orders_customer
    from: RawOrders.customer_id
    to: RawCustomers.customer_id
    cardinality: many_to_one
    description: Raw order row belongs to a raw customer row.

governance:
  classification:
    RawCustomers.email: PII
  stewards:
    customer_domain: customer-data@example.com
    order_domain: order-data@example.com
  retention:
    period: 3y
    policy: source_contract_baseline

glossary:
  - term: Raw Zone
    definition: Ingested source-aligned data before business transformations.
    owner: data-platform@example.com
    tags: [INGESTION]

rules:
  - name: raw_orders_amount_non_negative
    target: RawOrders.gross_amount
    expression: "value >= 0"
    severity: error
"""

END_TO_END_TRANSFORM = """model:
  name: commerce_transform
  spec_version: 2
  version: 1.0.0
  domain: sales
  owners:
    - analytics-engineering@example.com
  state: draft
  layer: transform
  description: Transform layer business models derived from raw sources.
  imports:
    - model: source_sales_raw
      alias: src
      path: ../source/source_sales_raw.model.yaml

entities:
  - name: CustomerDim
    type: table
    description: Conformed customer dimension for analytics.
    tags: [SILVER, DIMENSION, CUSTOMER]
    schema: analytics
    subject_area: customer_domain
    owner: analytics-engineering@example.com
    grain: [customer_id]
    sla:
      freshness: 8h
      quality_score: 99
    fields:
      - name: customer_id
        type: string
        primary_key: true
        nullable: false
        description: Conformed customer key.
        tags: [IDENTIFIER]
      - name: email
        type: string
        nullable: false
        description: Customer email used by lifecycle reporting.
        tags: [PII, CONTACT]
        sensitivity: restricted
      - name: customer_tier
        type: string
        nullable: false
        description: Normalized customer segment derived from source events.
        tags: [SEGMENT]

  - name: OrderFact
    type: table
    description: Atomic order-level fact table for finance and growth analytics.
    tags: [SILVER, FACT, ORDER]
    schema: analytics
    subject_area: order_domain
    owner: analytics-engineering@example.com
    grain: [order_id]
    sla:
      freshness: 4h
      quality_score: 99
    fields:
      - name: order_id
        type: string
        primary_key: true
        nullable: false
        description: Unique order key.
        tags: [IDENTIFIER]
      - name: customer_id
        type: string
        nullable: false
        foreign_key: true
        description: Foreign key to customer dimension.
        tags: [JOIN_KEY]
      - name: order_date
        type: date
        nullable: false
        description: Business order date used for reporting grain.
        tags: [REPORTING_DATE]
      - name: net_revenue
        type: decimal(12,2)
        nullable: false
        description: Revenue after discount normalization.
        tags: [AMOUNT, FINANCE]
      - name: order_status
        type: string
        nullable: false
        description: Standardized business order status.
        tags: [STATUS]

relationships:
  - name: order_fact_customer_dim
    from: OrderFact.customer_id
    to: CustomerDim.customer_id
    cardinality: many_to_one
    description: Fact row belongs to one customer.

indexes:
  - name: idx_order_fact_order_date
    entity: OrderFact
    fields: [order_date]
  - name: idx_order_fact_customer_id
    entity: OrderFact
    fields: [customer_id]

governance:
  classification:
    CustomerDim.email: PII
  stewards:
    customer_domain: analytics-engineering@example.com
    order_domain: analytics-engineering@example.com
  retention:
    period: 5y
    policy: transformed_contract

glossary:
  - term: Order Fact
    definition: One row per order after transformation and standardization.
    owner: analytics-engineering@example.com
    related_fields:
      - OrderFact.order_id
      - OrderFact.net_revenue
    tags: [FACT]

rules:
  - name: order_fact_revenue_non_negative
    target: OrderFact.net_revenue
    expression: "value >= 0"
    severity: error
"""

END_TO_END_REPORT = """model:
  name: commerce_reporting
  spec_version: 2
  version: 1.0.0
  domain: sales
  owners:
    - bi-team@example.com
  state: draft
  layer: report
  description: Reporting layer metric contracts and dictionary-ready semantic views.
  imports:
    - model: commerce_transform
      alias: tr
      path: ../transform/commerce_transform.model.yaml

entities:
  - name: DailyRevenueMetric
    type: view
    description: Daily revenue KPI contract used by executive dashboards.
    tags: [GOLD, METRIC, KPI, REPORTING]
    schema: reporting
    subject_area: executive_kpis
    owner: bi-team@example.com
    grain: [metric_date]
    sla:
      freshness: 24h
      quality_score: 99
    fields:
      - name: metric_date
        type: date
        nullable: false
        description: Daily reporting grain for KPI trend lines.
        tags: [GRAIN, REPORTING_DATE]
      - name: gross_revenue
        type: decimal(12,2)
        nullable: false
        computed: true
        computed_expression: "SUM(OrderFact.net_revenue)"
        description: Sum of net revenue at daily grain.
        tags: [METRIC, FINANCE]
      - name: order_count
        type: integer
        nullable: false
        computed: true
        computed_expression: "COUNT_DISTINCT(OrderFact.order_id)"
        description: Distinct order count at daily grain.
        tags: [METRIC, VOLUME]
      - name: avg_order_value
        type: decimal(12,2)
        nullable: false
        computed: true
        computed_expression: "gross_revenue / NULLIF(order_count, 0)"
        description: Average order value derived from daily metrics.
        tags: [METRIC, FINANCE]

  - name: CustomerRevenueMetric
    type: view
    description: Customer-level revenue KPI contract for retention analysis.
    tags: [GOLD, METRIC, CUSTOMER]
    schema: reporting
    subject_area: customer_kpis
    owner: bi-team@example.com
    grain: [customer_id, report_month]
    sla:
      freshness: 24h
      quality_score: 99
    fields:
      - name: customer_id
        type: string
        nullable: false
        description: Customer identifier for customer KPI cuts.
        tags: [DIMENSION, IDENTIFIER]
      - name: report_month
        type: date
        nullable: false
        description: Monthly reporting period for customer metrics.
        tags: [GRAIN]
      - name: customer_revenue
        type: decimal(12,2)
        nullable: false
        computed: true
        computed_expression: "SUM(OrderFact.net_revenue)"
        description: Total monthly customer revenue.
        tags: [METRIC, FINANCE]
      - name: active_order_count
        type: integer
        nullable: false
        computed: true
        computed_expression: "COUNT_DISTINCT(OrderFact.order_id)"
        description: Distinct active orders for the customer period.
        tags: [METRIC]

indexes:
  - name: idx_daily_revenue_metric_date
    entity: DailyRevenueMetric
    fields: [metric_date]
  - name: idx_customer_revenue_metric_customer
    entity: CustomerRevenueMetric
    fields: [customer_id]

governance:
  classification:
    CustomerRevenueMetric.customer_id: INTERNAL
  stewards:
    executive_kpis: bi-team@example.com
    customer_kpis: bi-team@example.com
  retention:
    period: 7y
    policy: reporting_contract

glossary:
  - term: Gross Revenue
    abbreviation: GR
    definition: Sum of net revenue values over the reporting grain.
    owner: bi-team@example.com
    related_fields:
      - DailyRevenueMetric.gross_revenue
    tags: [KPI, FINANCE]
  - term: Average Order Value
    abbreviation: AOV
    definition: Gross revenue divided by distinct order count for the period.
    owner: bi-team@example.com
    related_fields:
      - DailyRevenueMetric.avg_order_value
    tags: [KPI, COMMERCE]
  - term: Customer Revenue
    definition: Total revenue attributed to a customer within report_month.
    owner: bi-team@example.com
    related_fields:
      - CustomerRevenueMetric.customer_revenue
    tags: [KPI, CUSTOMER]

rules:
  - name: gross_revenue_non_negative
    target: DailyRevenueMetric.gross_revenue
    expression: "value >= 0"
    severity: error
  - name: order_count_non_negative
    target: DailyRevenueMetric.order_count
    expression: "value >= 0"
    severity: error
  - name: customer_revenue_non_negative
    target: CustomerRevenueMetric.customer_revenue
    expression: "value >= 0"
    severity: error

metrics:
  - name: daily_gross_revenue
    entity: DailyRevenueMetric
    description: Daily gross revenue KPI for executive reporting.
    expression: gross_revenue
    aggregation: sum
    grain: [metric_date]
    dimensions: [metric_date]
    time_dimension: metric_date
    owner: bi-team@example.com
    tags: [KPI, METRIC, FINANCE]
  - name: daily_order_count
    entity: DailyRevenueMetric
    description: Daily distinct order count.
    expression: order_count
    aggregation: count_distinct
    grain: [metric_date]
    dimensions: [metric_date]
    time_dimension: metric_date
    owner: bi-team@example.com
    tags: [KPI, METRIC, VOLUME]
  - name: monthly_customer_revenue
    entity: CustomerRevenueMetric
    description: Monthly revenue by customer.
    expression: customer_revenue
    aggregation: sum
    grain: [customer_id, report_month]
    dimensions: [customer_id]
    time_dimension: report_month
    owner: bi-team@example.com
    tags: [KPI, METRIC, CUSTOMER]

display:
  sections:
    - name: Executive KPIs
      entities: [DailyRevenueMetric]
    - name: Customer KPIs
      entities: [CustomerRevenueMetric]
"""

END_TO_END_POLICY = """pack:
  name: end_to_end_dictionary
  version: 1.0.0
  description: Strict policy profile for end-to-end modeling + dictionary-first projects.
  extends: strict.policy.yaml

policies:
  - id: REQUIRE_MODEL_GOVERNANCE
    type: custom_expression
    severity: error
    params:
      scope: model
      expression: "has_governance"
      message: "Model '{name}' must define governance metadata."

  - id: REQUIRE_MODEL_GLOSSARY
    type: custom_expression
    severity: error
    params:
      scope: model
      expression: "has_glossary"
      message: "Model '{name}' must define glossary terms for dictionary coverage."

  - id: REQUIRE_MODEL_RULES
    type: custom_expression
    severity: error
    params:
      scope: model
      expression: "has_rules"
      message: "Model '{name}' must define rules for business logic checks."

  - id: REQUIRE_REPORT_LAYER_METRICS
    type: custom_expression
    severity: error
    params:
      scope: model
      expression: "layer != 'report' or has_metrics"
      message: "Report layer model '{name}' must define metrics."

  - id: REQUIRE_ENTITY_SUBJECT_AREA
    type: custom_expression
    severity: error
    params:
      scope: entity
      expression: "subject_area != ''"
      message: "Entity '{name}' must define subject_area for dictionary organization."

  - id: REQUIRE_ENTITY_DESCRIPTION
    type: custom_expression
    severity: error
    params:
      scope: entity
      expression: "has_description"
      message: "Entity '{name}' must include a description."

  - id: REQUIRE_FIELD_DESCRIPTION
    type: custom_expression
    severity: error
    params:
      scope: field
      expression: "primary_key or has_description"
      message: "Field '{name}' must include a description unless it is a primary key."

  - id: REQUIRE_FIELD_TAGS
    type: custom_expression
    severity: error
    params:
      scope: field
      expression: "primary_key or tags != []"
      message: "Field '{name}' must include at least one tag unless it is a primary key."
"""

END_TO_END_DICTIONARY_README = """# End-to-End Dictionary Workflow

This project is scaffolded to keep architecture, transformation logic, reporting metrics,
and business dictionary metadata in one programmable YAML system.

## Layers

1. `models/source/`:
   - Physical source contracts (warehouse/raw systems).
2. `models/transform/`:
   - Business-conformed entities and relationships.
3. `models/report/`:
   - Reporting semantic contracts and KPI-focused glossary terms.

## Required Sections Per Model

1. `model` metadata (`name`, `version`, `owners`, `state`, `description`).
2. `entities` with field-level descriptions and tags.
3. `grain` in transform/report entities.
4. `governance` classification/stewardship metadata.
5. `glossary` terms for dictionary clarity.
6. `rules` for enforceable business logic.
7. `metrics` in report models for KPI contracts.

## Mandatory Validation Flow

```bash
datalex validate-all --glob "models/**/*.model.yaml"
datalex policy-check models/source/source_sales_raw.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
datalex policy-check models/transform/commerce_transform.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
datalex policy-check models/report/commerce_reporting.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
datalex resolve-project models
datalex generate docs models/report/commerce_reporting.model.yaml --format html --out docs/dictionary/reporting-dictionary.html
```
"""


def _default_schema_path() -> str:
    return str(Path.cwd() / "schemas" / "model.schema.json")


def _default_policy_schema_path() -> str:
    return str(Path.cwd() / "schemas" / "policy.schema.json")


def _default_policy_path() -> str:
    return str(Path.cwd() / "policies" / "default.policy.yaml")


def _print_issues(issues: List[Issue]) -> None:
    if not issues:
        print("No issues found.")
        return
    for line in to_lines(issues):
        print(line)


def _combined_issues(model: Dict[str, Any], schema: Dict[str, Any]) -> List[Issue]:
    issues = schema_issues(model, schema)
    issues.extend(lint_issues(model))
    return issues


def _normalize_host_and_port(host: str, port: int) -> Tuple[str, int]:
    """Accept URL-ish host input and normalize it to hostname + port."""
    clean_host = (host or "").strip()
    clean_port = port or 0
    if not clean_host:
        return "", clean_port

    target = clean_host if "://" in clean_host else f"//{clean_host}"
    parsed = urlparse(target)
    normalized_host = parsed.hostname or clean_host.split("/", 1)[0].strip()

    parsed_port = 0
    try:
        parsed_port = parsed.port or 0
    except ValueError:
        parsed_port = 0

    if not clean_port and parsed_port:
        clean_port = parsed_port

    return normalized_host, clean_port


def _sanitize_model_file_stem(model_name: str) -> str:
    stem = (model_name or "imported_model").strip() or "imported_model"
    for ch in ("/", "\\", " ", ":", ";"):
        stem = stem.replace(ch, "_")
    return stem


def _should_create_directory(path: Path) -> bool:
    if sys.stdin.isatty():
        answer = input(f'Project folder "{path}" does not exist. Create it? [y/N]: ').strip().lower()
        return answer in {"y", "yes"}
    return False


def _resolve_pull_output_path(args: argparse.Namespace, model_name: str) -> Tuple[bool, str]:
    project_dir_raw = getattr(args, "project_dir", "") or ""
    out_raw = getattr(args, "out", "") or ""
    create_project_dir = bool(getattr(args, "create_project_dir", False))

    if not project_dir_raw:
        return True, out_raw

    project_dir = Path(project_dir_raw).expanduser()
    if project_dir.exists() and not project_dir.is_dir():
        return False, f"Project folder is not a directory: {project_dir}"
    if not project_dir.exists():
        if create_project_dir or _should_create_directory(project_dir):
            project_dir.mkdir(parents=True, exist_ok=True)
        else:
            if not sys.stdin.isatty():
                return False, (
                    f"Project folder does not exist: {project_dir}. "
                    f"Re-run with --create-project-dir to create it."
                )
            return False, f"Aborted: project folder not created: {project_dir}"

    if out_raw:
        out_path = Path(out_raw)
        if out_path.is_absolute():
            return False, "--out must be a relative filename/path when used with --project-dir"
        return True, str(project_dir / out_path)

    file_name = f"{_sanitize_model_file_stem(model_name)}.model.yaml"
    return True, str(project_dir / file_name)


def _validate_model_file(model_path: str, schema: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Issue]]:
    model = load_yaml_model(model_path)
    issues = _combined_issues(model, schema)
    return model, issues


def _print_issue_block(prefix: str, issues: List[Issue]) -> None:
    if not issues:
        print(f"{prefix}: No issues found.")
        return
    print(f"{prefix}:")
    for line in to_lines(issues):
        print(f"  {line}")


def _issues_as_json(issues: List[Issue]) -> List[Dict[str, str]]:
    return [
        {
            "severity": issue.severity,
            "code": issue.code,
            "message": issue.message,
            "path": issue.path,
        }
        for issue in issues
    ]


def _write_yaml(path: str, payload: Dict[str, Any]) -> None:
    output = yaml.safe_dump(payload, sort_keys=False)
    Path(path).write_text(output, encoding="utf-8")


def _print_or_write_yaml(payload: Dict[str, Any], out: str = "") -> None:
    output = yaml.safe_dump(payload, sort_keys=False, default_flow_style=False, allow_unicode=True)
    if out:
        Path(out).write_text(output, encoding="utf-8")
        print(f"Wrote model: {out}")
    else:
        print(output)


def _init_schemas_and_policies(root: Path) -> List[Path]:
    """Copy schema and policy files into the workspace. Returns list of created paths."""
    created = []
    (root / "schemas").mkdir(parents=True, exist_ok=True)
    (root / "policies").mkdir(parents=True, exist_ok=True)

    schema_dst = root / "schemas" / "model.schema.json"
    policy_schema_dst = root / "schemas" / "policy.schema.json"
    default_policy_dst = root / "policies" / "default.policy.yaml"
    strict_policy_dst = root / "policies" / "strict.policy.yaml"

    if not schema_dst.exists():
        repo_schema = Path.cwd() / "schemas" / "model.schema.json"
        if repo_schema.exists():
            schema_dst.write_text(repo_schema.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            schema_dst.write_text("{}", encoding="utf-8")
    created.append(schema_dst)

    if not policy_schema_dst.exists():
        repo_policy_schema = Path.cwd() / "schemas" / "policy.schema.json"
        if repo_policy_schema.exists():
            policy_schema_dst.write_text(
                repo_policy_schema.read_text(encoding="utf-8"), encoding="utf-8"
            )
        else:
            policy_schema_dst.write_text("{}", encoding="utf-8")
    created.append(policy_schema_dst)

    repo_policy_dir = Path.cwd() / "policies"
    if not default_policy_dst.exists():
        repo_default = repo_policy_dir / "default.policy.yaml"
        if repo_default.exists():
            default_policy_dst.write_text(repo_default.read_text(encoding="utf-8"), encoding="utf-8")
    created.append(default_policy_dst)

    if not strict_policy_dst.exists():
        repo_strict = repo_policy_dir / "strict.policy.yaml"
        if repo_strict.exists():
            strict_policy_dst.write_text(repo_strict.read_text(encoding="utf-8"), encoding="utf-8")
    created.append(strict_policy_dst)

    return created


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    created = _init_schemas_and_policies(root)

    template = args.template
    if args.multi_model:
        if template not in {"single", "multi-model"}:
            print(
                "Init failed: --multi-model cannot be combined with --template end-to-end.",
                file=sys.stderr,
            )
            return 1
        template = "multi-model"

    if template == "multi-model":
        # Multi-model project structure
        models_dir = root / "models"
        (models_dir / "shared").mkdir(parents=True, exist_ok=True)
        (models_dir / "orders").mkdir(parents=True, exist_ok=True)

        shared_dst = models_dir / "shared" / "shared_dimensions.model.yaml"
        orders_dst = models_dir / "orders" / "orders.model.yaml"
        config_dst = root / "dm.config.yaml"

        if not shared_dst.exists():
            shared_dst.write_text(MULTI_MODEL_SHARED, encoding="utf-8")
        created.append(shared_dst)

        if not orders_dst.exists():
            orders_dst.write_text(MULTI_MODEL_ORDERS, encoding="utf-8")
        created.append(orders_dst)

        if not config_dst.exists():
            config_dst.write_text(
                "schema: schemas/model.schema.json\n"
                "policy_schema: schemas/policy.schema.json\n"
                "policy_pack: policies/default.policy.yaml\n"
                "model_glob: \"models/**/*.model.yaml\"\n"
                "multi_model: true\n"
                "search_dirs:\n"
                "  - models/shared\n"
                "  - models/orders\n",
                encoding="utf-8",
            )
        created.append(config_dst)

        print(f"Initialized multi-model workspace at {root}")
    elif template == "end-to-end":
        models_dir = root / "models"
        (models_dir / "source").mkdir(parents=True, exist_ok=True)
        (models_dir / "transform").mkdir(parents=True, exist_ok=True)
        (models_dir / "report").mkdir(parents=True, exist_ok=True)
        (root / "docs" / "dictionary").mkdir(parents=True, exist_ok=True)

        source_dst = models_dir / "source" / "source_sales_raw.model.yaml"
        transform_dst = models_dir / "transform" / "commerce_transform.model.yaml"
        report_dst = models_dir / "report" / "commerce_reporting.model.yaml"
        dictionary_readme_dst = root / "docs" / "dictionary" / "README.md"
        end_to_end_policy_dst = root / "policies" / "end_to_end_dictionary.policy.yaml"
        config_dst = root / "dm.config.yaml"

        if not source_dst.exists():
            source_dst.write_text(END_TO_END_SOURCE, encoding="utf-8")
        created.append(source_dst)

        if not transform_dst.exists():
            transform_dst.write_text(END_TO_END_TRANSFORM, encoding="utf-8")
        created.append(transform_dst)

        if not report_dst.exists():
            report_dst.write_text(END_TO_END_REPORT, encoding="utf-8")
        created.append(report_dst)

        if not dictionary_readme_dst.exists():
            dictionary_readme_dst.write_text(END_TO_END_DICTIONARY_README, encoding="utf-8")
        created.append(dictionary_readme_dst)

        if not end_to_end_policy_dst.exists():
            end_to_end_policy_dst.write_text(END_TO_END_POLICY, encoding="utf-8")
        created.append(end_to_end_policy_dst)

        if not config_dst.exists():
            config_dst.write_text(
                "schema: schemas/model.schema.json\n"
                "policy_schema: schemas/policy.schema.json\n"
                "policy_pack: policies/end_to_end_dictionary.policy.yaml\n"
                "model_glob: \"models/**/*.model.yaml\"\n"
                "multi_model: true\n"
                "search_dirs:\n"
                "  - models/source\n"
                "  - models/transform\n"
                "  - models/report\n",
                encoding="utf-8",
            )
        created.append(config_dst)

        print(f"Initialized end-to-end modeling workspace at {root}")
    else:
        # Single-model project structure
        (root / "model-examples").mkdir(parents=True, exist_ok=True)
        sample_dst = root / "model-examples" / "starter.model.yaml"
        config_dst = root / "dm.config.yaml"

        if not sample_dst.exists():
            sample_dst.write_text(STARTER_MODEL, encoding="utf-8")
        created.append(sample_dst)

        if not config_dst.exists():
            config_dst.write_text(
                "schema: schemas/model.schema.json\n"
                "policy_schema: schemas/policy.schema.json\n"
                "policy_pack: policies/default.policy.yaml\n"
                "model_glob: \"**/*.model.yaml\"\n",
                encoding="utf-8",
            )
        created.append(config_dst)

        print(f"Initialized workspace at {root}")

    for path in created:
        print(f"- {path}")
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    _, issues = _validate_model_file(args.model, schema)
    _print_issues(issues)
    return 1 if has_errors(issues) else 0


def cmd_lint(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    issues = lint_issues(model)
    _print_issues(issues)
    return 1 if has_errors(issues) else 0


def cmd_compile(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)
    if has_errors(issues):
        _print_issues(issues)
        return 1

    canonical = compile_model(model)
    output = json.dumps(canonical, indent=2, sort_keys=False)

    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Wrote canonical model: {args.out}")
    else:
        print(output)

    return 0


def cmd_diff(args: argparse.Namespace) -> int:
    old_model = load_yaml_model(args.old)
    new_model = load_yaml_model(args.new)
    diff = semantic_diff(old_model, new_model)
    print(json.dumps(diff, indent=2))
    return 0


def cmd_validate_all(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    paths = sorted(
        {
            Path(path)
            for path in glob.glob(args.glob, recursive=True)
            if Path(path).is_file()
        }
    )

    if not paths:
        print(f"No files matched glob: {args.glob}")
        return 0

    failing_files = 0
    for path in paths:
        if any(path.match(pattern) for pattern in args.exclude):
            continue

        _, issues = _validate_model_file(str(path), schema)
        _print_issue_block(str(path), issues)
        if has_errors(issues):
            failing_files += 1

    if failing_files:
        print(f"Validation failed for {failing_files} file(s).")
        return 1

    print("All model files passed validation.")
    return 0


def cmd_gate(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)

    old_model, old_issues = _validate_model_file(args.old, schema)
    new_model, new_issues = _validate_model_file(args.new, schema)

    _print_issue_block(f"Old model ({args.old})", old_issues)
    _print_issue_block(f"New model ({args.new})", new_issues)

    combined_issues = list(old_issues) + list(new_issues)
    if has_errors(combined_issues):
        print("Gate failed: model validation errors detected.")
        return 1

    diff = semantic_diff(old_model, new_model)
    if args.output_json:
        print(json.dumps(diff, indent=2))
    else:
        summary = diff["summary"]
        print("Diff summary:")
        print(
            f"  entities +{summary['added_entities']} -{summary['removed_entities']} "
            f"changed:{summary['changed_entities']}"
        )
        print(
            f"  relationships +{summary['added_relationships']} -{summary['removed_relationships']}"
        )
        print(f"  metrics +{summary['added_metrics']} -{summary['removed_metrics']} changed:{summary['changed_metrics']}")
        print(f"  breaking changes: {summary['breaking_change_count']}")
        if diff["breaking_changes"]:
            print("Breaking changes:")
            for item in diff["breaking_changes"]:
                print(f"  - {item}")

    if diff["has_breaking_changes"] and not args.allow_breaking:
        print("Gate failed: breaking changes detected. Use --allow-breaking to bypass.")
        return 2

    print("Gate passed.")
    return 0


def cmd_readiness_gate(args: argparse.Namespace) -> int:
    """CI/CD gate: run the shared `datalex_readiness` engine and fail on red.

    Designed for pre-commit hooks and PR jobs — same scoring as the
    `/api/dbt/review` endpoint, no api-server required. Emits SARIF for
    GitHub code-scanning and a sticky-comment markdown summary alongside
    a non-zero exit when thresholds are breached.
    """
    # Lazy import — keeps `datalex --help` fast and avoids importing the
    # readiness engine for users who only run validate/lint locally.
    try:
        from datalex_readiness.scoring import review_project
        from datalex_readiness.finding import findings_to_sarif
    except ModuleNotFoundError as exc:
        print(
            f"ERROR: datalex_readiness is not installed ({exc}). "
            "Install with `pip install datalex-readiness` or run from a dev clone "
            "with PYTHONPATH=packages/readiness_engine/src.",
            file=sys.stderr,
        )
        return 1

    project_path = Path(args.project).resolve()
    if not project_path.exists():
        print(f"ERROR: project path not found: {project_path}", file=sys.stderr)
        return 1

    paths: List[str] = []
    if getattr(args, "changed_only", False):
        paths = _gate_changed_paths(str(project_path), args.base_ref)
        if not paths:
            print("[gate] no YAML/.md changes vs base ref — skipping.", flush=True)
            return 0

    review = review_project(
        project_id="cli",
        project_path=str(project_path),
        paths=paths,
        scope="changed" if paths else "all",
    )

    summary = review["summary"]
    label = (
        f"score={summary['score']} "
        f"red={summary['red']} yellow={summary['yellow']} green={summary['green']} "
        f"errors={summary['errors']} warnings={summary['warnings']}"
    )
    print(f"[gate] {label}", flush=True)

    if args.sarif:
        sarif_path = Path(args.sarif)
        sarif_path.parent.mkdir(parents=True, exist_ok=True)
        with sarif_path.open("w", encoding="utf-8") as fh:
            json.dump(findings_to_sarif(review.get("files", [])), fh, indent=2)
        print(f"[gate] wrote SARIF → {sarif_path}", flush=True)

    if args.pr_comment:
        comment_path = Path(args.pr_comment)
        comment_path.parent.mkdir(parents=True, exist_ok=True)
        comment_path.write_text(_gate_render_pr_comment(review), encoding="utf-8")
        print(f"[gate] wrote PR comment markdown → {comment_path}", flush=True)

    if args.output_json:
        print(json.dumps(review, indent=2))

    fail = False
    if args.min_score is not None and summary["score"] < args.min_score:
        print(
            f"[gate] FAIL: project score {summary['score']} below --min-score {args.min_score}",
            file=sys.stderr,
        )
        fail = True
    if args.max_yellow is not None and summary["yellow"] > args.max_yellow:
        print(
            f"[gate] FAIL: yellow files {summary['yellow']} exceed --max-yellow {args.max_yellow}",
            file=sys.stderr,
        )
        fail = True
    if args.max_red is not None and summary["red"] > args.max_red:
        print(
            f"[gate] FAIL: red files {summary['red']} exceed --max-red {args.max_red}",
            file=sys.stderr,
        )
        fail = True
    if summary["errors"] > 0 and not args.allow_errors:
        print(
            f"[gate] FAIL: {summary['errors']} error finding(s) — pass --allow-errors to bypass",
            file=sys.stderr,
        )
        fail = True
    return 1 if fail else 0


def _gate_changed_paths(project_path: str, base_ref: str) -> List[str]:
    """Return YAML/.md files changed vs base_ref, relative to project_path.

    Falls back to scanning the full project when git isn't available.
    """
    import subprocess

    try:
        proc = subprocess.run(
            ["git", "diff", "--name-only", f"{base_ref}...HEAD"],
            cwd=project_path,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return []
    if proc.returncode != 0:
        return []
    out: List[str] = []
    for line in proc.stdout.splitlines():
        clean = line.strip()
        if not clean:
            continue
        lower = clean.lower()
        if lower.endswith((".yaml", ".yml", ".md")):
            out.append(clean)
    return out


def _gate_render_pr_comment(review: Dict[str, Any]) -> str:
    """Render a sticky PR-comment summary in markdown."""
    summary = review["summary"]
    badge = "🟢" if summary["red"] == 0 and summary["errors"] == 0 else (
        "🟡" if summary["red"] == 0 else "🔴"
    )
    lines = [
        f"## DataLex readiness {badge}",
        "",
        f"**Score:** {summary['score']} · "
        f"red {summary['red']} · yellow {summary['yellow']} · green {summary['green']}",
        f"**Findings:** {summary['errors']} error(s), {summary['warnings']} warning(s), "
        f"{summary['infos']} info",
        "",
    ]
    worst = sorted(
        review.get("files", []),
        key=lambda f: (
            0 if f["status"] == "red" else 1 if f["status"] == "yellow" else 2,
            -f["counts"]["errors"],
            -f["counts"]["warnings"],
            f["score"],
        ),
    )[:8]
    if worst:
        lines.append("| Status | File | Score | Errors | Warnings |")
        lines.append("|---|---|---|---|---|")
        for f in worst:
            icon = {"red": "🔴", "yellow": "🟡", "green": "🟢"}.get(f["status"], "·")
            lines.append(
                f"| {icon} | `{f['path']}` | {f['score']} | "
                f"{f['counts']['errors']} | {f['counts']['warnings']} |"
            )
    else:
        lines.append("_No YAML files were scored._")
    lines.append("")
    lines.append("<sub>Generated by `datalex readiness-gate`.</sub>")
    return "\n".join(lines) + "\n"


def cmd_policy_check(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    policy_schema = load_schema(args.policy_schema)

    policy_paths: List[str] = list(getattr(args, "policy", None) or []) or [_default_policy_path()]

    model, model_issues = _validate_model_file(args.model, schema)
    inherit = bool(getattr(args, "inherit", False))
    loaded_packs = [
        load_policy_pack_with_inheritance(p) if inherit else load_policy_pack(p)
        for p in policy_paths
    ]
    policy_pack = merge_policy_packs(*loaded_packs) if len(loaded_packs) > 1 else loaded_packs[0]
    policy_pack_issues = schema_issues(policy_pack, policy_schema)

    label = ", ".join(policy_paths)
    _print_issue_block(f"Model checks ({args.model})", model_issues)
    _print_issue_block(f"Policy pack checks ({label})", policy_pack_issues)

    if has_errors(model_issues) or has_errors(policy_pack_issues):
        print("Policy check failed: validation errors detected before policy evaluation.")
        return 1

    evaluated_issues = policy_issues(model, policy_pack)
    _print_issue_block("Policy evaluation", evaluated_issues)

    if args.output_json:
        payload = {
            "model": args.model,
            "policy": policy_paths if len(policy_paths) > 1 else policy_paths[0],
            "summary": {
                "error_count": len([item for item in evaluated_issues if item.severity == "error"]),
                "warning_count": len([item for item in evaluated_issues if item.severity == "warn"]),
                "info_count": len([item for item in evaluated_issues if item.severity == "info"]),
            },
            "issues": _issues_as_json(evaluated_issues),
        }
        print(json.dumps(payload, indent=2))

    if has_errors(evaluated_issues):
        print("Policy check failed.")
        return 1

    print("Policy check passed.")
    return 0


def cmd_generate_sql(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    ddl = generate_sql_ddl(model, dialect=args.dialect)
    if args.out:
        Path(args.out).write_text(ddl, encoding="utf-8")
        print(f"Wrote SQL DDL: {args.out}")
    else:
        print(ddl)

    return 0


def cmd_generate_dbt(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    created = write_dbt_scaffold(
        model=model,
        out_dir=args.out_dir,
        source_name=args.source_name,
        project_name=args.project_name,
    )

    print(f"Created dbt scaffold files ({len(created)}):")
    for path in created:
        print(f"- {path}")

    return 0


def cmd_generate_metadata(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)

    if has_errors(issues):
        _print_issues(issues)
        return 1

    canonical = compile_model(model)
    payload = {
        "model": canonical.get("model", {}),
        "summary": {
            "entity_count": len(canonical.get("entities", [])),
            "relationship_count": len(canonical.get("relationships", [])),
            "index_count": len(canonical.get("indexes", [])),
            "glossary_term_count": len(canonical.get("glossary", [])),
            "rule_count": len(canonical.get("rules", [])),
        },
        "entities": canonical.get("entities", []),
        "relationships": canonical.get("relationships", []),
        "indexes": canonical.get("indexes", []),
        "glossary": canonical.get("glossary", []),
        "governance": canonical.get("governance", {}),
        "generated_by": "datalex generate metadata",
    }
    output = json.dumps(payload, indent=2)

    if args.out:
        Path(args.out).write_text(output + "\n", encoding="utf-8")
        print(f"Wrote metadata export: {args.out}")
    else:
        print(output)

    return 0


def cmd_import_sql(args: argparse.Namespace) -> int:
    ddl_text = Path(args.input).read_text(encoding="utf-8")
    model = import_sql_ddl(
        ddl_text=ddl_text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_import_dbml(args: argparse.Namespace) -> int:
    dbml_text = Path(args.input).read_text(encoding="utf-8")
    model = import_dbml(
        dbml_text=dbml_text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_import_spark_schema(args: argparse.Namespace) -> int:
    text = Path(args.input).read_text(encoding="utf-8")
    model = import_spark_schema(
        schema_text=text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
        table_name=getattr(args, "table_name", None),
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_import_dbt(args: argparse.Namespace) -> int:
    schema_text = Path(args.input).read_text(encoding="utf-8")
    model = import_dbt_schema_yml(
        schema_yml_text=schema_text,
        model_name=args.model_name,
        domain=args.domain,
        owners=args.owner if args.owner else ["data-team@example.com"],
    )

    schema = load_schema(args.schema)
    issues = _combined_issues(model, schema)
    _print_issue_block("Imported model checks", issues)

    if args.out:
        _write_yaml(args.out, model)
        print(f"Wrote imported YAML model: {args.out}")
    else:
        print(yaml.safe_dump(model, sort_keys=False))

    return 1 if has_errors(issues) else 0


def cmd_draft(args: argparse.Namespace) -> int:
    """AI-assisted DataLex starter from a dbt project.

    Pipeline:
      1. Load and condense the dbt manifest at <dbt>/target/manifest.json.
      2. Call Anthropic with a system prompt + 2-shot pack (cache-controlled).
      3. Extract a fenced YAML block from the response.
      4. Schema-validate against the bundled DataLex model schema.
      5. Print to stdout, or print a unified diff against --out and only
         write when --force is passed.
    """
    import difflib
    import subprocess

    from datalex_core import (
        DraftError,
        condense_manifest,
        draft_starter,
        load_manifest,
    )

    dbt_path = Path(args.dbt)
    if not dbt_path.exists():
        sys.stderr.write(f"--dbt path does not exist: {dbt_path}\n")
        return 2
    try:
        manifest = load_manifest(dbt_path)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        sys.stderr.write(f"failed to load dbt manifest: {exc}\n")
        return 2
    condensed = condense_manifest(manifest, include_glob=args.include)
    if not condensed["models"]:
        msg = "[draft] no dbt models found in manifest"
        if args.include:
            msg += f" matching --include {args.include!r}"
        sys.stderr.write(msg + ". Nothing to draft.\n")
        return 2

    owner = args.owner or _detect_owner_email()
    schema_path = Path(args.schema) if args.schema else Path(_default_schema_path())
    try:
        yaml_text, summary = draft_starter(
            condensed=condensed,
            domain=args.domain,
            owner=owner,
            model=args.model,
            max_tokens=args.max_tokens,
            schema_path=schema_path,
        )
    except DraftError as exc:
        sys.stderr.write(f"[draft] {exc}\n")
        return 3

    sys.stderr.write(
        f"[draft] tokens: input={summary.get('input_tokens', '?')} "
        f"output={summary.get('output_tokens', '?')} "
        f"cache_read={summary.get('cache_read_tokens', 0)} "
        f"cache_write={summary.get('cache_write_tokens', 0)}\n"
    )
    sys.stderr.write(
        f"[draft] entities={summary['entities']} fields={summary['fields']} "
        f"relationships={summary['relationships']} rules={summary['rules']}\n"
    )

    out = Path(args.out) if args.out else None
    if out is None:
        sys.stdout.write(yaml_text)
        return 0
    if out.exists():
        existing = out.read_text()
        diff = "".join(
            difflib.unified_diff(
                existing.splitlines(keepends=True),
                yaml_text.splitlines(keepends=True),
                fromfile=str(out),
                tofile=f"{out} (proposed)",
            )
        )
        sys.stdout.write(diff or "[draft] no changes\n")
        if not args.force:
            sys.stderr.write(f"[draft] {out} exists; pass --force to overwrite.\n")
            return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml_text)
    sys.stderr.write(f"[draft] wrote {out}\n")
    return 0


def _detect_owner_email() -> str:
    import subprocess

    try:
        result = subprocess.run(
            ["git", "config", "--get", "user.email"],
            capture_output=True,
            text=True,
            check=False,
        )
        email = result.stdout.strip()
        if email:
            return email
    except FileNotFoundError:
        pass
    return "data@example.com"


def cmd_serve(args: argparse.Namespace) -> int:
    """Start the bundled DataLex server.

    The server is the Node/Express api-server that also serves the built
    web-app as static files, so we only ever bind ONE port. This removes
    the old two-terminal / CORS-preflight setup and makes `pip install
    datalex-cli && datalex serve` the smallest possible onboarding
    path.

    Resolution order for the api-server entry point:
      1. `DM_SERVER_JS` env var (for integration tests and dev workflows)
      2. A wheel-bundled copy under `datalex_core/_server/index.js`
         (installed via package-data when the wheel was built)
      3. The repo-local path `packages/api-server/index.js` (for folks
         running from a `pip install -e .` clone)

    Resolution order for the web dist:
      1. `WEB_DIST` env var
      2. Wheel-bundled `datalex_core/_webapp/`
      3. Repo-local `packages/web-app/dist/`

    If `node` isn't on PATH, we print a focused error rather than a
    stack trace — the user just needs to install Node 20+.
    """
    import shutil
    import signal
    import subprocess
    import webbrowser

    try:
        import datalex_core  # noqa: F401
        core_pkg_path = Path(datalex_core.__file__).resolve().parent
    except Exception:
        core_pkg_path = None

    # Repo-root heuristic: walk up from this file until we find packages/.
    here = Path(__file__).resolve()
    repo_root = None
    for parent in here.parents:
        if (parent / "packages" / "api-server" / "index.js").exists():
            repo_root = parent
            break

    # Locate the server entry point.
    server_js = os.environ.get("DM_SERVER_JS") or None
    if not server_js:
        candidates = []
        if core_pkg_path is not None:
            candidates.append(core_pkg_path / "_server" / "index.js")
        if repo_root is not None:
            candidates.append(repo_root / "packages" / "api-server" / "index.js")
        for candidate in candidates:
            if candidate and candidate.exists():
                server_js = str(candidate)
                break
    if not server_js or not Path(server_js).exists():
        print(
            "ERROR: DataLex server bundle not found.\n"
            "Set DM_SERVER_JS=/path/to/packages/api-server/index.js, or "
            "install a wheel that ships _server/index.js.",
            file=sys.stderr,
        )
        return 1

    # Locate the web dist (optional — api routes still work without it).
    web_dist = os.environ.get("WEB_DIST") or None
    if not web_dist:
        candidates = []
        if core_pkg_path is not None:
            candidates.append(core_pkg_path / "_webapp")
        if repo_root is not None:
            candidates.append(repo_root / "packages" / "web-app" / "dist")
        for candidate in candidates:
            if candidate and candidate.exists() and (candidate / "index.html").exists():
                web_dist = str(candidate)
                break

    # If we're running from a source checkout and the web bundle hasn't been
    # built yet, try to build it on-the-fly so the user doesn't have to know
    # about `npm run build`. Skipped in wheel installs (no source tree).
    if not web_dist and repo_root is not None:
        webapp_src = repo_root / "packages" / "web-app"
        if (webapp_src / "package.json").exists():
            import shutil as _shutil
            npm = _shutil.which("npm")
            if npm:
                print("[datalex] Web bundle not found — building once with `npm run build`...")
                try:
                    if not (webapp_src / "node_modules").exists():
                        print("[datalex]   installing web-app dependencies (first-time, ~1 min)...")
                        subprocess.run([npm, "install", "--silent"], cwd=str(webapp_src), check=True)
                    subprocess.run([npm, "run", "build", "--silent"], cwd=str(webapp_src), check=True)
                    built = webapp_src / "dist"
                    if (built / "index.html").exists():
                        web_dist = str(built)
                        print("[datalex]   build complete.")
                except Exception as err:
                    print(f"[datalex]   auto-build failed: {err}")
                    print("[datalex]   run `cd packages/web-app && npm install && npm run build` manually.")
            else:
                print("[datalex] Web bundle missing and `npm` not found on PATH.")
                print("[datalex]   install Node 20+ (https://nodejs.org) and re-run, or")
                print("[datalex]   build manually: `cd packages/web-app && npm install && npm run build`")

    # Node resolution: prefer system/venv node. The `serve` extra installs
    # nodejs-wheel, which exposes `node` next to the active Python executable
    # when the venv's bin directory is not otherwise on PATH.
    node_bin = shutil.which("node")
    if node_bin is None:
        venv_node = Path(sys.executable).resolve().parent / ("node.exe" if os.name == "nt" else "node")
        if venv_node.exists():
            node_bin = str(venv_node)
    if node_bin is None:
        try:
            from nodejs_bin import node as nodejs_bin_node  # type: ignore

            node_bin = str(getattr(nodejs_bin_node, "path", "")) or None
        except Exception:
            node_bin = None
    if not node_bin:
        print(
            "ERROR: `node` was not found on PATH.\n"
            "Install Node 20+ (https://nodejs.org) or `pip install 'datalex-cli[serve]'` "
            "and re-run `datalex serve`.",
            file=sys.stderr,
        )
        return 1

    # Source checkout convenience: the wheel bundles api-server dependencies,
    # but a fresh clone needs packages/api-server/node_modules before Node can
    # import express/js-yaml/glob. Install them once, matching the web auto-build
    # behavior above.
    if repo_root is not None:
        api_src = repo_root / "packages" / "api-server"
        try:
            if Path(server_js).resolve() == (api_src / "index.js").resolve() and not (api_src / "node_modules").exists():
                npm = shutil.which("npm")
                if not npm:
                    print(
                        "ERROR: api-server dependencies are missing and `npm` was not found on PATH.\n"
                        "Install Node 20+ with npm, then re-run `datalex serve`, or run "
                        "`npm --prefix packages/api-server install` from the repo.",
                        file=sys.stderr,
                    )
                    return 1
                print("[datalex] API server dependencies not found — installing once with `npm install`...")
                subprocess.run([npm, "install", "--silent"], cwd=str(api_src), check=True)
                print("[datalex]   api-server dependencies installed.")
        except subprocess.CalledProcessError as err:
            print(f"ERROR: failed to install api-server dependencies: {err}", file=sys.stderr)
            print("Run `npm --prefix packages/api-server install` manually and retry.", file=sys.stderr)
            return 1

    port = int(getattr(args, "port", 3030) or 3030)
    env = os.environ.copy()
    env["PORT"] = str(port)
    if web_dist:
        env["WEB_DIST"] = web_dist
    # Let the api-server know where to put default project metadata
    # when running in "installed" mode. If the user passed --project-dir
    # we use it; otherwise, default to the current working directory so
    # `.dm-projects.json` lives next to their data.
    project_dir = getattr(args, "project_dir", None) or os.getcwd()
    env["REPO_ROOT"] = project_dir
    # Ensure the api-server's subprocess calls to `python3 dm ...` resolve to
    # the same interpreter that has `datalex_cli` installed (the one running
    # this `datalex serve`). Without this, a subprocess-level PATH that points
    # at a different `python3` fails with ModuleNotFoundError: datalex_cli.
    env["DM_PYTHON"] = sys.executable

    # The api-server resolves the CLI script via `join(REPO_ROOT, "dm")`
    # in its `dmExec()` helper. In a repo clone that file exists; in a
    # pip install it doesn't, so we drop a small shim next to REPO_ROOT.
    # NOTE: we intentionally do NOT write a shim named `DataLex` —
    # `<project>/DataLex/` is the canonical folder where DataLex stores
    # domain-first modeling assets, and a file named `DataLex` would
    # collide with that workspace folder. The api-server's dmExec helper
    # already handles the rename (falls back through `datalex` → `dm`
    # → PATH) so the `dm` shim alone is sufficient.
    dm_shim = Path(project_dir) / "dm"
    if not dm_shim.exists():
        try:
            dm_shim.write_text(
                "#!{py}\n"
                "import sys\n"
                "from datalex_cli.main import main\n"
                "raise SystemExit(main())\n".format(py=sys.executable)
            )
            try:
                dm_shim.chmod(0o755)
            except Exception:
                pass
        except Exception as err:
            # Read-only project dir is fine: we'll hit API errors for
            # subprocess-backed routes but the UI still loads.
            print(f"[datalex] Note: could not write CLI shim at {dm_shim}: {err}")

    # Self-heal: if a previous 1.0.1 `datalex serve` run wrote a
    # `datalex` file shim, remove it now so the diagrams folder can be
    # created. We only remove it when it's a regular file (or symlink)
    # under 1KB and starts with the shebang we wrote — never a folder
    # that might be the user's real `datalex/` config dir.
    stray_shim = Path(project_dir) / "datalex"
    try:
        if stray_shim.is_symlink() or (stray_shim.is_file() and stray_shim.stat().st_size < 1024):
            head = ""
            try:
                head = stray_shim.read_text(errors="ignore")[:200]
            except Exception:
                pass
            if "datalex_cli.main" in head or stray_shim.is_symlink():
                stray_shim.unlink()
                print(f"[datalex]   removed stale `datalex` shim at {stray_shim}")
    except Exception:
        pass

    # Auto-register the --project-dir folder as a DataLex project so the UI
    # opens directly into it instead of an empty/default workspace. This must
    # also self-heal Docker bind mounts: a host-created .dm-projects.json can
    # contain /Users/... paths that do not exist inside the container, leaving
    # the UI with no openable project unless we re-add the served /workspace.
    import json as _json
    import time as _time
    projects_file = Path(project_dir) / ".dm-projects.json"
    try:
        default_name = Path(project_dir).name or "project"
        served_path = str(Path(project_dir).resolve())
        projects = []
        if projects_file.exists():
            try:
                parsed = _json.loads(projects_file.read_text(encoding="utf-8"))
                if isinstance(parsed, list):
                    projects = [p for p in parsed if isinstance(p, dict) and p.get("path")]
            except Exception:
                projects = []

        # Keep accessible projects, drop container-invisible stale paths, and
        # dedupe by resolved path. Always preserve/re-add the served path.
        cleaned = []
        seen_paths = set()
        for project in projects:
            raw_path = str(project.get("path") or "")
            if not raw_path:
                continue
            if not Path(raw_path).exists():
                continue
            try:
                key = str(Path(raw_path).resolve())
            except Exception:
                key = raw_path
            if key in seen_paths:
                continue
            seen_paths.add(key)
            cleaned.append(project)

        served_key = served_path
        exists = served_key in seen_paths
        if not exists:
            cleaned.insert(0, {
                "id": f"proj_{int(_time.time() * 1000)}",
                "name": default_name,
                "path": served_path,
            })
            print(f"[datalex]   registered project: {default_name} → {served_path}")
        elif cleaned != projects:
            print(f"[datalex]   refreshed project registry for {served_path}")

        if cleaned != projects or not projects_file.exists():
            projects_file.write_text(_json.dumps(cleaned, indent=2), encoding="utf-8")
    except Exception as err:
        print(f"[datalex]   note: couldn't auto-register project: {err}")

    # Detect an existing server on this port and surface a helpful message
    # rather than letting Node silently fail with EADDRINUSE.
    try:
        import socket as _socket
        with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as _s:
            _s.settimeout(0.2)
            if _s.connect_ex(("127.0.0.1", port)) == 0:
                print(
                    f"[datalex] ERROR: port {port} is already in use.\n"
                    f"[datalex]   another `datalex serve` is probably still running.\n"
                    f"[datalex]   stop it with:  lsof -ti:{port} | xargs kill\n"
                    f"[datalex]   or start on a different port: datalex serve --port {port + 1}",
                    file=sys.stderr,
                )
                return 1
    except Exception:
        pass  # non-fatal — worst case Node will report EADDRINUSE itself

    url = f"http://localhost:{port}"
    print(f"[datalex] Starting DataLex server on {url}")
    print(f"[datalex]   server:   {server_js}")
    print(f"[datalex]   web dist: {web_dist or '(none — API only)'}")
    print(f"[datalex]   project:  {project_dir}")

    proc = subprocess.Popen([node_bin, server_js], env=env, cwd=project_dir)

    # Open the browser after a short delay to let the server bind.
    if not getattr(args, "no_browser", False):
        def _open_when_ready() -> None:
            import threading
            import time as _time

            def _run():
                _time.sleep(1.2)
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            threading.Thread(target=_run, daemon=True).start()

        _open_when_ready()

    # Forward SIGINT/SIGTERM to the child so Ctrl+C is clean.
    def _shutdown(signum, _frame):
        try:
            proc.send_signal(signum)
        except Exception:
            pass

    signal.signal(signal.SIGINT, _shutdown)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _shutdown)

    try:
        return proc.wait()
    except KeyboardInterrupt:
        try:
            proc.terminate()
        except Exception:
            pass
        return 130


def cmd_dbt_sync(args: argparse.Namespace) -> int:
    """Merge DataLex model metadata into an existing dbt schema.yml (non-destructive)."""
    model = load_yaml_model(args.model)
    dbt_schema_path = Path(args.dbt_schema)
    if not dbt_schema_path.exists():
        print(f"ERROR: dbt schema file not found: {dbt_schema_path}", file=sys.stderr)
        return 1
    existing_yml = dbt_schema_path.read_text(encoding="utf-8")
    updated_yml = sync_dbt_schema_yml(model, existing_yml)
    out_path = Path(args.out) if getattr(args, "out", None) else dbt_schema_path
    out_path.write_text(updated_yml, encoding="utf-8")
    print(f"dbt schema synced: {out_path}")
    return 0


def cmd_dbt_import(args: argparse.Namespace) -> int:
    """Import a dbt project's manifest.json + (optional) warehouse types into a DataLex tree.

    Preserves the dbt model folder layout (models/staging/..., models/marts/...)
    under --out so users can see exactly which dbt layer an entity comes from.
    Writes sources to the same folder as their original schema.yml.

    Progress lines `[dbt-import] ...` are emitted on stdout so callers (like the
    api-server SSE bridge) can stream them to the UI.
    """
    from datalex_core.dbt.sync import sync_dbt_project, report_to_json

    project_dir = Path(args.project_dir).resolve()
    out_root = Path(args.out).resolve()

    if not project_dir.is_dir():
        print(f"ERROR: dbt project directory not found: {project_dir}", file=sys.stderr)
        return 1

    manifest_path = project_dir / "target" / "manifest.json"
    if not manifest_path.exists() and not args.manifest:
        print(
            f"ERROR: manifest.json not found at {manifest_path}. "
            f"Run `dbt parse` (or `dbt compile`) in the project first, "
            f"or pass --manifest <path>.",
            file=sys.stderr,
        )
        return 1

    out_root.mkdir(parents=True, exist_ok=True)
    print(f"[dbt-import] project={project_dir}", flush=True)
    print(f"[dbt-import] out={out_root}", flush=True)

    report = sync_dbt_project(
        str(project_dir),
        str(out_root),
        profiles_dir=args.profiles_dir,
        target_override=args.target,
        skip_warehouse=args.skip_warehouse,
        manifest_path=args.manifest,
    )

    for rec in report.tables:
        tag = "wh" if rec.warehouse_reachable else "manifest"
        print(
            f"[dbt-import] {rec.kind}:{rec.database or ''}.{rec.schema or ''}."
            f"{rec.table} ({tag}, {rec.columns_from_warehouse or rec.columns_from_manifest} cols)",
            flush=True,
        )

    for f in report.files_written:
        print(f"[dbt-import] wrote {f}", flush=True)

    if args.json:
        print(report_to_json(report))
    else:
        print(report.summary())
    return 0


def cmd_emit_catalog(args: argparse.Namespace) -> int:
    """Emit glossary + column-binding payloads for an external catalog.

    Targets: atlan | datahub | openmetadata. Output is one JSON file per
    model under --out, named `<target>-<model_name>.json`.
    """
    from datalex_core.exporters import available_targets, export_catalog

    target = (args.target or "").lower()
    if target not in available_targets():
        print(
            f"ERROR: unknown target '{args.target}'. Available: {', '.join(available_targets())}",
            file=sys.stderr,
        )
        return 1

    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)
    if has_errors(issues):
        _print_issues(issues)
        return 1
    compiled = compile_model(model)

    payload = export_catalog(target, compiled)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = compiled.get("model", {}).get("name") or "datalex_model"
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(name))
    out_path = out_dir / f"{target}-{safe_name}.json"
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[catalog] wrote {target} payload → {out_path}")
    return 0


def cmd_docs_export(args: argparse.Namespace) -> int:
    """Walk a DataLex project and write per-model + per-domain Markdown docs.

    Output layout under `--out`:

        <out>/<domain>/<model>.md     — per-model data dictionary
        <out>/<domain>/README.md      — per-domain summary + mermaid ERD
        <out>/README.md               — top-level index over all domains

    Doc-block references (`description_ref: { doc: <name> }`) resolve to
    rendered prose via the existing DocBlockIndex.
    """
    from datalex_core.docs_export import export_docs

    project_root = Path(args.project)
    out_dir = Path(args.out)
    if not project_root.is_dir():
        print(f"ERROR: project directory not found: {project_root}", file=sys.stderr)
        return 1

    summary = export_docs(project_root, out_dir)
    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps(summary.to_json(), indent=2))
    else:
        print(f"[docs export] project = {summary.project_root}")
        print(f"[docs export] out     = {summary.out_dir}")
        print(f"[docs export] domains: {len(summary.domains)} ({sum(summary.domains.values())} models)")
        for domain, count in sorted(summary.domains.items()):
            print(f"  - {domain}: {count} model(s)")
        print(f"[docs export] files written: {len(summary.files_written)}")
    return 0


def cmd_dbt_docs_reindex(args: argparse.Namespace) -> int:
    """Rebuild the dbt `{% docs %}` index for a project and print a summary.

    Uses the same `DocBlockIndex` the importer/emitter consume so output
    matches what `dbt import → emit` will round-trip.
    """
    from datalex_core.dbt.doc_blocks import DocBlockIndex

    project_dir = Path(args.project_dir)
    if not project_dir.is_dir():
        print(f"ERROR: project directory not found: {project_dir}", file=sys.stderr)
        return 1
    idx = DocBlockIndex.build(project_dir)
    if getattr(args, "json", False):
        import json as _json
        print(_json.dumps({"blocks": idx.blocks, "sources": idx.sources, "names": idx.names()}))
    else:
        print(f"[doc-blocks] project={project_dir}")
        print(f"[doc-blocks] sources scanned: {len(idx.sources)}")
        print(f"[doc-blocks] blocks indexed: {len(idx.blocks)}")
        for name in idx.names():
            body = idx.blocks[name]
            preview = body.replace("\n", " ").strip()
            if len(preview) > 80:
                preview = preview[:77] + "..."
            print(f"  - {name}: {preview}")
    return 0


def cmd_dbt_push(args: argparse.Namespace) -> int:
    """Push DataLex metadata into all schema.yml files found in a dbt project directory."""
    model = load_yaml_model(args.model)
    dbt_project_root = Path(args.dbt_project)
    if not dbt_project_root.is_dir():
        print(f"ERROR: dbt project directory not found: {dbt_project_root}", file=sys.stderr)
        return 1
    yaml_files = list(dbt_project_root.rglob("schema.yml")) + list(dbt_project_root.rglob("schema.yaml"))
    if not yaml_files:
        print("No dbt schema.yml files found in project directory.", file=sys.stderr)
        return 1
    updated_count = 0
    for yml_path in sorted(yaml_files):
        try:
            existing_yml = yml_path.read_text(encoding="utf-8")
            updated_yml = sync_dbt_schema_yml(model, existing_yml)
            yml_path.write_text(updated_yml, encoding="utf-8")
            print(f"  synced: {yml_path}")
            updated_count += 1
        except Exception as exc:
            print(f"  WARN: skipping {yml_path}: {exc}", file=sys.stderr)
    print(f"dbt push complete. Updated {updated_count} schema.yml file(s).")
    return 0


def _build_connector_extra(args: argparse.Namespace) -> Dict[str, Any]:
    extra: Dict[str, Any] = {}
    if getattr(args, "odbc_driver", ""):
        extra["odbc_driver"] = getattr(args, "odbc_driver")
    if getattr(args, "encrypt", ""):
        extra["encrypt"] = getattr(args, "encrypt")
    if getattr(args, "trust_server_certificate", ""):
        extra["trust_server_certificate"] = getattr(args, "trust_server_certificate")
    if getattr(args, "http_path", ""):
        extra["http_path"] = getattr(args, "http_path")
    return extra


def cmd_pull(args: argparse.Namespace) -> int:
    connector_type = args.connector
    connector = get_connector(connector_type)
    if connector is None:
        print(f"Unknown connector: {connector_type}", file=sys.stderr)
        print(f"Available: {', '.join(c['type'] for c in list_connectors())}", file=sys.stderr)
        return 1

    ok, msg = connector.check_driver()
    if not ok:
        print(f"Driver check failed: {msg}", file=sys.stderr)
        return 1

    host, port = _normalize_host_and_port(
        getattr(args, "host", "") or "",
        getattr(args, "port", 0) or 0,
    )

    config = ConnectorConfig(
        connector_type=connector_type,
        host=host,
        port=port,
        database=getattr(args, "database", "") or "",
        schema=getattr(args, "db_schema", "") or "",
        user=getattr(args, "user", "") or "",
        password=getattr(args, "password", "") or "",
        warehouse=getattr(args, "warehouse", "") or "",
        project=getattr(args, "project", "") or "",
        dataset=getattr(args, "dataset", "") or "",
        catalog=getattr(args, "catalog", "") or "",
        token=getattr(args, "token", "") or "",
        private_key_path=getattr(args, "private_key_path", "") or "",
        model_name=getattr(args, "model_name", "imported_model") or "imported_model",
        domain=getattr(args, "domain", "imported") or "imported",
        owners=[getattr(args, "owner", None)] if getattr(args, "owner", None) else None,
        tables=getattr(args, "tables", None),
        exclude_tables=getattr(args, "exclude_tables", None),
        extra=_build_connector_extra(args),
    )

    if getattr(args, "test", False):
        ok, msg = connector.test_connection(config)
        print(f"{'OK' if ok else 'FAIL'}: {msg}")
        return 0 if ok else 1

    ok_out, output_path_or_error = _resolve_pull_output_path(args, config.model_name)
    if not ok_out:
        print(output_path_or_error, file=sys.stderr)
        return 1

    print(f"Pulling schema from {connector.display_name}...")
    result = connector.pull_schema(config)

    print(f"\n{result.summary()}")

    if result.warnings:
        for w in result.warnings:
            print(f"  [WARN] {w}")

    # Per-entity progress lines — consumed by the API server's SSE pull
    # stream so the UI can render row-by-row feedback. Safe for human
    # readers too: each line is self-contained and not intermixed with
    # other output ordering.
    _emit_pull_progress_lines(result, config)

    # If the user pointed us at a dbt project and didn't explicitly opt out,
    # fan the single-YAML output into the dbt folder convention:
    #   <project>/sources/<db>__<schema>.yaml
    #   <project>/models/staging/stg_<schema>__<table>.yml
    # Falls back silently to the flat single-file layout on error or when
    # `dbt_project.yml` isn't present.
    dbt_layout_used = False
    if getattr(args, "dbt_layout", True):
        project_dir_raw = getattr(args, "project_dir", "") or ""
        if project_dir_raw:
            project_dir = Path(project_dir_raw).expanduser()
            if (project_dir / "dbt_project.yml").exists():
                try:
                    written = _write_dbt_aware_layout(project_dir, result.model, config)
                    if written:
                        dbt_layout_used = True
                        for p in written:
                            print(f"[pull] wrote {p}")
                except Exception as exc:  # noqa: BLE001
                    print(f"[pull] dbt layout write failed, falling back: {exc}", file=sys.stderr)

    if not dbt_layout_used:
        if output_path_or_error:
            _write_yaml(output_path_or_error, result.model)
            print(f"\nWrote model: {output_path_or_error}")
        else:
            print("\n" + yaml.safe_dump(result.model, sort_keys=False))

    return 0


def _emit_pull_progress_lines(result: "ConnectorResult", config: "ConnectorConfig") -> None:
    """Emit one `[pull] <schema>.<table>: <n> rows` line per imported entity.

    The connector may or may not populate `row_count` on each entity. When
    absent we emit `unknown` so the SSE stream still gets a per-table beat.
    """
    schema_label = config.schema or config.dataset or "default"
    entities = (result.model or {}).get("entities") or []
    for ent in entities:
        name = str(ent.get("name") or "").strip() or "<unknown>"
        row_count = ent.get("row_count")
        if row_count is None:
            # Some connectors tuck counts under `meta` or similar — best-effort fallback.
            meta = ent.get("meta") or {}
            row_count = meta.get("row_count") if isinstance(meta, dict) else None
        row_label = f"{row_count} rows" if isinstance(row_count, (int, float)) else "unknown rows"
        print(f"[pull] {schema_label}.{name}: {row_label}")


def _write_dbt_aware_layout(
    project_dir: Path,
    model: Dict[str, Any],
    config: "ConnectorConfig",
) -> List[str]:
    """Split a pulled model into dbt-convention folders.

    Returns the list of (relative) paths written. Does NOT remove the
    existing `models/<model>.yaml` output — callers decide whether to still
    emit that. We return an empty list if there's nothing to write so the
    caller can fall back to the flat layout.
    """
    entities = (model or {}).get("entities") or []
    if not entities:
        return []

    db = _sanitize_model_file_stem(config.database or config.project or "db", "db")
    schema = _sanitize_model_file_stem(config.schema or config.dataset or "public", "public")

    # 1. sources/<db>__<schema>.yaml — dbt v2 source spec listing every table.
    sources_path = project_dir / "sources" / f"{db}__{schema}.yaml"
    source_block = {
        "version": 2,
        "sources": [
            {
                "name": schema,
                "database": config.database or config.project or None,
                "schema": schema,
                "tables": [
                    {"name": str(ent.get("name") or "").strip() or "unnamed"}
                    for ent in entities
                ],
            }
        ],
    }
    sources_path.parent.mkdir(parents=True, exist_ok=True)
    _write_yaml(str(sources_path), source_block)

    written = [str(sources_path.relative_to(project_dir))]

    # 2. models/staging/stg_<schema>__<table>.yml — one stub per entity so
    #    dbt discovers them and DataLex keeps a per-table model file.
    staging_dir = project_dir / "models" / "staging"
    staging_dir.mkdir(parents=True, exist_ok=True)
    for ent in entities:
        table_name = str(ent.get("name") or "").strip()
        if not table_name:
            continue
        stem = _sanitize_model_file_stem(table_name, "unnamed")
        stub_path = staging_dir / f"stg_{schema}__{stem}.yml"
        stub_block = {
            "version": 2,
            "models": [
                {
                    "name": f"stg_{schema}__{stem}",
                    "description": ent.get("description")
                    or f"Staging model for source {schema}.{table_name}.",
                    "columns": [
                        {
                            "name": f.get("name"),
                            "description": f.get("description") or "",
                            "data_type": f.get("type") or "",
                        }
                        for f in (ent.get("fields") or [])
                        if f.get("name")
                    ],
                }
            ],
        }
        _write_yaml(str(stub_path), stub_block)
        written.append(str(stub_path.relative_to(project_dir)))

    return written


def cmd_connectors(args: argparse.Namespace) -> int:
    connectors = list_connectors()
    if getattr(args, "output_json", False):
        print(json.dumps(connectors, indent=2))
    else:
        print("Available database connectors:\n")
        for c in connectors:
            status = "installed" if c["installed"] else "NOT INSTALLED"
            print(f"  {c['type']:12s}  {c['name']:30s}  driver: {c['driver']:25s}  [{status}]")
        print(
            "\nUsage: datalex pull <connector> --host <host> --database <db> --user <user> "
            "--password <pass> [--out model.yaml | --project-dir ./models]"
        )
    return 0


def _build_connector_config(args: argparse.Namespace) -> "ConnectorConfig":
    host, port = _normalize_host_and_port(
        getattr(args, "host", "") or "",
        getattr(args, "port", 0) or 0,
    )
    extra = _build_connector_extra(args)

    return ConnectorConfig(
        connector_type=args.connector,
        host=host,
        port=port,
        database=getattr(args, "database", "") or "",
        schema=getattr(args, "db_schema", "") or "",
        user=getattr(args, "user", "") or "",
        password=getattr(args, "password", "") or "",
        warehouse=getattr(args, "warehouse", "") or "",
        project=getattr(args, "project", "") or "",
        dataset=getattr(args, "dataset", "") or "",
        catalog=getattr(args, "catalog", "") or "",
        token=getattr(args, "token", "") or "",
        private_key_path=getattr(args, "private_key_path", "") or "",
        extra=extra,
    )


def cmd_schemas(args: argparse.Namespace) -> int:
    connector = get_connector(args.connector)
    if connector is None:
        print(f"Unknown connector: {args.connector}", file=sys.stderr)
        return 1
    ok, msg = connector.check_driver()
    if not ok:
        print(f"Driver check failed: {msg}", file=sys.stderr)
        return 1

    config = _build_connector_config(args)
    schemas = connector.list_schemas(config)

    if getattr(args, "output_json", False):
        print(json.dumps(schemas, indent=2))
    else:
        print(f"Schemas in {connector.display_name} ({config.database or config.project or 'default'}):\n")
        for s in schemas:
            print(f"  {s['name']:30s}  {s['table_count']:4d} tables")
    return 0


def cmd_tables(args: argparse.Namespace) -> int:
    connector = get_connector(args.connector)
    if connector is None:
        print(f"Unknown connector: {args.connector}", file=sys.stderr)
        return 1
    ok, msg = connector.check_driver()
    if not ok:
        print(f"Driver check failed: {msg}", file=sys.stderr)
        return 1

    config = _build_connector_config(args)
    tables = connector.list_tables(config)

    if getattr(args, "output_json", False):
        print(json.dumps(tables, indent=2))
    else:
        schema_label = config.schema or config.dataset or "default"
        print(f"Tables in {connector.display_name} / {schema_label}:\n")
        print(f"  {'TABLE':30s}  {'TYPE':8s}  {'COLUMNS':>8s}  {'ROWS':>12s}")
        print(f"  {'-'*30}  {'-'*8}  {'-'*8}  {'-'*12}")
        for t in tables:
            rows = str(t.get("row_count") or "") if t.get("row_count") is not None else "-"
            print(f"  {t['name']:30s}  {t['type']:8s}  {t['column_count']:>8d}  {rows:>12s}")
        print(f"\n  Total: {len(tables)} tables")
    return 0


def cmd_generate_docs(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    fmt = args.format

    if fmt == "html":
        if args.out:
            write_html_docs(model, args.out, title=args.title)
            print(f"Wrote HTML docs: {args.out}")
        else:
            print(generate_html_docs(model, title=args.title))
    elif fmt == "markdown":
        if args.out:
            write_markdown_docs(model, args.out, title=args.title)
            print(f"Wrote Markdown docs: {args.out}")
        else:
            print(generate_markdown_docs(model, title=args.title))

    return 0


def cmd_generate_changelog(args: argparse.Namespace) -> int:
    old_model = load_yaml_model(args.old)
    new_model = load_yaml_model(args.new)
    diff = semantic_diff(old_model, new_model)

    old_version = old_model.get("model", {}).get("version", "")
    new_version = new_model.get("model", {}).get("version", "")

    if args.out:
        write_changelog(diff, args.out, old_version=old_version, new_version=new_version)
        print(f"Wrote changelog: {args.out}")
    else:
        print(generate_changelog(diff, old_version=old_version, new_version=new_version))

    return 0


def cmd_fmt(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    canonical = compile_model(model)
    output = yaml.safe_dump(canonical, sort_keys=False, default_flow_style=False, allow_unicode=True)

    if args.write:
        Path(args.model).write_text(output, encoding="utf-8")
        print(f"Formatted: {args.model}")
    elif args.out:
        Path(args.out).write_text(output, encoding="utf-8")
        print(f"Wrote formatted model: {args.out}")
    else:
        print(output)

    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    entities = model.get("entities", [])
    relationships = model.get("relationships", [])
    indexes = model.get("indexes", [])
    glossary = model.get("glossary", [])
    rules = model.get("rules", [])

    total_fields = sum(len(e.get("fields", [])) for e in entities)
    pk_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("primary_key")
    )
    fk_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("foreign_key")
    )
    nullable_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("nullable", True)
    )
    described_fields = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("description")
    )
    deprecated_count = sum(
        1 for e in entities for f in e.get("fields", []) if f.get("deprecated")
    )
    entity_types = {}
    for e in entities:
        t = e.get("type", "table")
        entity_types[t] = entity_types.get(t, 0) + 1
    subject_areas = set(e.get("subject_area") for e in entities if e.get("subject_area"))
    tags = set()
    for e in entities:
        for t in e.get("tags", []):
            tags.add(t)

    desc_coverage = f"{described_fields}/{total_fields}" if total_fields else "0/0"
    desc_pct = f"{described_fields / total_fields * 100:.0f}%" if total_fields else "0%"

    stats = {
        "model_name": model.get("model", {}).get("name", "unknown"),
        "version": model.get("model", {}).get("version", "unknown"),
        "entity_count": len(entities),
        "entity_types": entity_types,
        "total_fields": total_fields,
        "primary_keys": pk_count,
        "foreign_keys": fk_count,
        "nullable_fields": nullable_count,
        "relationship_count": len(relationships),
        "index_count": len(indexes),
        "glossary_terms": len(glossary),
        "rule_count": len(rules),
        "description_coverage": f"{desc_coverage} ({desc_pct})",
        "deprecated_fields": deprecated_count,
        "subject_areas": sorted(subject_areas),
        "tags": sorted(tags),
    }

    if args.output_json:
        print(json.dumps(stats, indent=2))
    else:
        print(f"Model: {stats['model_name']} v{stats['version']}")
        print(f"Entities: {stats['entity_count']}  ({', '.join(f'{v} {k}' for k, v in entity_types.items())})")
        print(f"Fields: {stats['total_fields']}  (PK: {pk_count}, FK: {fk_count}, nullable: {nullable_count})")
        print(f"Relationships: {stats['relationship_count']}")
        print(f"Indexes: {stats['index_count']}")
        print(f"Glossary terms: {stats['glossary_terms']}")
        print(f"Rules: {stats['rule_count']}")
        print(f"Description coverage: {desc_coverage} ({desc_pct})")
        if deprecated_count:
            print(f"Deprecated fields: {deprecated_count}")
        if subject_areas:
            print(f"Subject areas: {', '.join(sorted(subject_areas))}")
        if tags:
            print(f"Tags: {', '.join(sorted(tags))}")

    return 0


def cmd_completeness(args: argparse.Namespace) -> int:
    """Score every entity in a model against the single-source-of-truth dimensions."""
    model = load_yaml_model(args.model)
    report = completeness_report(model)
    data = completeness_as_dict(report)

    if args.output_json:
        print(json.dumps(data, indent=2))
        return 0

    # ── Human-readable report ─────────────────────────────────────────────────
    BAR_WIDTH = 20
    SCORE_PASS = 80
    SCORE_WARN = 60

    def _bar(score: int) -> str:
        filled = round(score / 100 * BAR_WIDTH)
        if score >= SCORE_PASS:
            fill_char, empty_char = "█", "░"
        elif score >= SCORE_WARN:
            fill_char, empty_char = "▓", "░"
        else:
            fill_char, empty_char = "▒", "░"
        return fill_char * filled + empty_char * (BAR_WIDTH - filled)

    def _score_label(score: int) -> str:
        if score == 100:
            return "COMPLETE"
        if score >= SCORE_PASS:
            return "GOOD    "
        if score >= SCORE_WARN:
            return "PARTIAL "
        return "GAPS    "

    print(f"\nCompleteness report — {report.model_name}")
    print(f"Model score: {report.model_score}%  "
          f"({report.fully_complete}/{report.total_entities} fully complete)\n")
    print(f"  {'Entity':<30} {'Score':>5}  {'':^{BAR_WIDTH}}  Status")
    print(f"  {'-'*30} {'-----':>5}  {'-'*BAR_WIDTH}  --------")

    for e in report.entities:
        bar = _bar(e.score)
        label = _score_label(e.score)
        print(f"  {e.entity_name:<30} {e.score:>4}%  {bar}  {label}")
        if e.missing and not args.summary:
            for m in e.missing:
                print(f"    {'':30}   ↳ missing: {m}")

    if report.needs_attention:
        print(f"\n  Needs attention (<60%): {', '.join(report.needs_attention)}")

    # Surface completeness as lint-style warnings when --min-score is set
    if args.min_score is not None:
        failed = [e for e in report.entities if e.score < args.min_score]
        if failed:
            print(
                f"\n  {len(failed)} entity/entities below minimum score of {args.min_score}%:"
            )
            for e in failed:
                print(f"    [{e.score}%] {e.entity_name}")
            return 1

    return 0


def cmd_resolve(args: argparse.Namespace) -> int:
    search_dirs = args.search_dir if args.search_dir else []
    resolved = resolve_model(args.model, search_dirs=search_dirs)

    if resolved.issues:
        for iss in resolved.issues:
            sev = iss.severity.upper()
            print(f"  [{sev}] {iss.code}: {iss.message}")

    summary = resolved.to_graph_summary()

    if args.output_json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"Root model: {summary['root_model']}")
        print(f"Models resolved: {summary['model_count']}")
        print(f"Total entities: {summary['total_entities']}")
        for m in summary["models"]:
            prefix = "*" if m["is_root"] else " "
            alias = f" (alias: {m.get('alias', '')})" if m.get("alias") else ""
            print(f"  {prefix} {m['name']}{alias}: {m['entity_count']} entities [{', '.join(m['entities'])}]")
        cross = summary["cross_model_relationships"]
        if cross:
            print(f"Cross-model relationships: {len(cross)}")
            for cr in cross:
                print(f"  {cr['from_model']}.{cr['from']} -> {cr['to_model']}.{cr['to']} ({cr['cardinality']})")

    has_errs = any(i.severity == "error" for i in resolved.issues)
    return 1 if has_errs else 0


def cmd_diff_all(args: argparse.Namespace) -> int:
    diff = project_diff(args.old, args.new)

    if args.output_json:
        print(json.dumps(diff, indent=2))
    else:
        s = diff["summary"]
        print(f"Project diff: {args.old} -> {args.new}")
        print(f"  Models: +{s['added_models']} -{s['removed_models']} changed:{s['changed_models']} unchanged:{s['unchanged_models']}")
        if diff["added_models"]:
            print(f"  Added: {', '.join(diff['added_models'])}")
        if diff["removed_models"]:
            print(f"  Removed: {', '.join(diff['removed_models'])}")
        if diff["changed_models"]:
            print(f"  Changed: {', '.join(diff['changed_models'])}")
            for name, mdiff in diff["model_diffs"].items():
                ms = mdiff["summary"]
                print(f"    [{name}] entities +{ms['added_entities']} -{ms['removed_entities']} changed:{ms['changed_entities']}")
                print(f"    [{name}] metrics +{ms['added_metrics']} -{ms['removed_metrics']} changed:{ms['changed_metrics']}")
        print(f"  Breaking changes: {s['breaking_change_count']}")
        if diff["breaking_changes"]:
            for bc in diff["breaking_changes"]:
                print(f"    - {bc}")

    if diff["has_breaking_changes"] and not args.allow_breaking:
        print("Project diff failed: breaking changes detected. Use --allow-breaking to bypass.")
        return 2

    return 0


def cmd_transform(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)
    if has_errors(issues):
        _print_issues(issues)
        return 1

    target_kind = "logical" if args.transform_command == "conceptual-to-logical" else "physical"
    transformed = transform_model(model, target_kind=target_kind, dialect=getattr(args, "dialect", "postgres"))
    transformed_issues = _combined_issues(transformed, schema)
    if has_errors(transformed_issues):
        _print_issues(transformed_issues)
        return 1

    _print_or_write_yaml(transformed, getattr(args, "out", "") or "")
    return 0


def cmd_standards_check(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    model, issues = _validate_model_file(args.model, schema)
    issues.extend(standards_issues(model))

    if args.output_json:
        print(json.dumps({"issues": _issues_as_json(issues)}, indent=2))
    else:
        _print_issues(issues)
    return 1 if has_errors(issues) else 0


def cmd_standards_fix(args: argparse.Namespace) -> int:
    model = load_yaml_model(args.model)
    fixed, changes = apply_standards_fixes(model)

    if not args.write and not args.out:
        print("# Applied supported standards autofixes")
        for change in changes:
            print(f"# - {change}")
        print("")

    _print_or_write_yaml(fixed, args.model if args.write else (args.out or ""))
    return 0


def cmd_sync_compare(args: argparse.Namespace) -> int:
    current_model = load_yaml_model(args.current)
    candidate_model = load_yaml_model(args.candidate)
    diff = semantic_diff(current_model, candidate_model)
    print(json.dumps(diff, indent=2))
    return 0 if not diff["has_breaking_changes"] or args.allow_breaking else 2


def cmd_sync_merge(args: argparse.Namespace) -> int:
    current_model = load_yaml_model(args.current)
    candidate_model = load_yaml_model(args.candidate)
    merged = merge_models_preserving_docs(current_model, candidate_model)
    _print_or_write_yaml(merged, getattr(args, "out", "") or "")
    return 0


def cmd_sync_pull(args: argparse.Namespace) -> int:
    return cmd_pull(args)


def cmd_resolve_project(args: argparse.Namespace) -> int:
    search_dirs = args.search_dir if args.search_dir else []
    results = resolve_project(args.directory, search_dirs=search_dirs)

    total_issues = 0
    all_models = []

    for path, resolved in sorted(results.items()):
        name = resolved.root_model.get("model", {}).get("name", "unknown")
        imports = list(resolved.imported_models.keys())
        entities = [e.get("name", "") for e in resolved.unified_entities()]
        issue_count = len(resolved.issues)
        total_issues += issue_count

        all_models.append({
            "name": name,
            "file": path,
            "imports": imports,
            "entity_count": len(entities),
            "entities": entities,
            "issue_count": issue_count,
            "issues": [
                {"severity": i.severity, "code": i.code, "message": i.message}
                for i in resolved.issues
            ],
        })

    if args.output_json:
        print(json.dumps({"models": all_models, "total_issues": total_issues}, indent=2))
    else:
        print(f"Project: {args.directory}")
        print(f"Models found: {len(all_models)}")
        for m in all_models:
            imp_str = f" (imports: {', '.join(m['imports'])})" if m["imports"] else ""
            status = "OK" if m["issue_count"] == 0 else f"{m['issue_count']} issues"
            print(f"  {m['name']}: {m['entity_count']} entities{imp_str} [{status}]")
            for iss in m["issues"]:
                print(f"    [{iss['severity'].upper()}] {iss['code']}: {iss['message']}")
        print(f"Total issues: {total_issues}")

    return 1 if total_issues > 0 else 0


def cmd_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    print(json.dumps(schema, indent=2))
    return 0


def cmd_policy_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.policy_schema)
    print(json.dumps(schema, indent=2))
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    project_dir = getattr(args, "path", ".")
    results = run_diagnostics(project_dir)

    if getattr(args, "output_json", False):
        print(json.dumps(diagnostics_as_json(results), indent=2))
    else:
        print(format_diagnostics(results))

    error_count = sum(1 for r in results if r.status == "error")
    return 1 if error_count > 0 else 0


def cmd_migrate(args: argparse.Namespace) -> int:
    old_model = load_yaml_model(args.old)
    new_model = load_yaml_model(args.new)
    dialect = getattr(args, "dialect", "postgres")

    if args.out:
        write_migration(old_model, new_model, args.out, dialect=dialect)
        print(f"Wrote migration SQL: {args.out}")
    else:
        sql = generate_migration(old_model, new_model, dialect=dialect)
        print(sql)

    return 0


def _split_sql_statements(sql_text: str) -> List[str]:
    statements: List[str] = []
    buf: List[str] = []
    in_single = False
    in_double = False
    in_line_comment = False
    in_block_comment = False
    i = 0

    while i < len(sql_text):
        ch = sql_text[i]
        nxt = sql_text[i + 1] if i + 1 < len(sql_text) else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                buf.append(ch)
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue

        if not in_single and not in_double and ch == "-" and nxt == "-":
            in_line_comment = True
            i += 2
            continue

        if not in_single and not in_double and ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        if ch == "'" and not in_double:
            if in_single and nxt == "'":
                buf.append(ch)
                buf.append(nxt)
                i += 2
                continue
            in_single = not in_single
            buf.append(ch)
            i += 1
            continue

        if ch == '"' and not in_single:
            in_double = not in_double
            buf.append(ch)
            i += 1
            continue

        if ch == ";" and not in_single and not in_double:
            stmt = "".join(buf).strip()
            if stmt:
                statements.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = "".join(buf).strip()
    if tail:
        statements.append(tail)
    return statements


def _escape_sql_string(value: str) -> str:
    return value.replace("'", "''")


def _sql_checksum(sql_text: str) -> str:
    return hashlib.sha256(sql_text.encode("utf-8")).hexdigest()


def _default_migration_name() -> str:
    return f"migration_{time.strftime('%Y%m%d%H%M%S', time.gmtime())}"


def _preview_sql(statement: str, max_len: int = 180) -> str:
    flat = " ".join(statement.strip().split())
    return flat if len(flat) <= max_len else f"{flat[: max_len - 3]}..."


def _detect_destructive_statements(statements: List[str]) -> List[Dict[str, Any]]:
    checks = [
        ("DROP TABLE", re.compile(r"\bDROP\s+TABLE\b", re.IGNORECASE)),
        ("DROP VIEW", re.compile(r"\bDROP\s+VIEW\b", re.IGNORECASE)),
        ("DROP SCHEMA", re.compile(r"\bDROP\s+SCHEMA\b", re.IGNORECASE)),
        ("DROP DATABASE", re.compile(r"\bDROP\s+DATABASE\b", re.IGNORECASE)),
        ("TRUNCATE TABLE", re.compile(r"\bTRUNCATE\s+TABLE\b", re.IGNORECASE)),
        ("ALTER TABLE DROP COLUMN", re.compile(r"\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b", re.IGNORECASE)),
    ]
    findings: List[Dict[str, Any]] = []
    for idx, statement in enumerate(statements, start=1):
        for check_name, pattern in checks:
            if pattern.search(statement):
                findings.append({
                    "statement_index": idx,
                    "kind": check_name,
                    "preview": _preview_sql(statement),
                })
                break
    return findings


def _write_apply_report(path: str, payload: Dict[str, Any]) -> None:
    Path(path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


class ApplyExecutionError(RuntimeError):
    def __init__(self, connector: str, statement_index: int, statement: str, error: Exception):
        self.connector = connector
        self.statement_index = statement_index
        self.statement = statement
        self.error = error
        message = (
            f"{connector} apply failed at statement #{statement_index}: "
            f"{_preview_sql(statement)} ({error})"
        )
        super().__init__(message)


def _apply_snowflake(config: ConnectorConfig, statements: List[str], migration_name: str, checksum: str, ledger_table: str, skip_ledger: bool) -> None:
    import snowflake.connector
    from datalex_core.connectors.snowflake import _load_private_key

    params: Dict[str, Any] = {
        "account": config.host,
        "user": config.user,
        "warehouse": config.warehouse,
        "database": config.database,
        "schema": config.schema or "PUBLIC",
    }
    if config.private_key_path:
        passphrase = config.password if config.password else None
        params["private_key"] = _load_private_key(config.private_key_path, passphrase)
    else:
        params["password"] = config.password

    conn = snowflake.connector.connect(**params)
    try:
        cur = conn.cursor()
        try:
            if config.warehouse:
                try:
                    cur.execute(f"ALTER WAREHOUSE IF EXISTS {config.warehouse} RESUME IF SUSPENDED")
                except Exception:
                    pass

            for idx, stmt in enumerate(statements, start=1):
                try:
                    cur.execute(stmt)
                except Exception as e:
                    raise ApplyExecutionError("snowflake", idx, stmt, e) from e

            if not skip_ledger:
                schema_name = (config.schema or "PUBLIC").upper()
                table_name = ledger_table
                create_sql = (
                    f'CREATE TABLE IF NOT EXISTS "{schema_name}"."{table_name}" ('
                    'migration_name VARCHAR, checksum VARCHAR, statement_count NUMBER, '
                    'status VARCHAR, applied_at TIMESTAMP_NTZ)'
                )
                cur.execute(create_sql)
                insert_sql = (
                    f'INSERT INTO "{schema_name}"."{table_name}" '
                    '(migration_name, checksum, statement_count, status, applied_at) VALUES '
                    f"('{_escape_sql_string(migration_name)}', '{checksum}', {len(statements)}, 'success', CURRENT_TIMESTAMP())"
                )
                cur.execute(insert_sql)
        finally:
            cur.close()
    finally:
        conn.close()


def _apply_databricks(config: ConnectorConfig, statements: List[str], migration_name: str, checksum: str, ledger_table: str, skip_ledger: bool) -> None:
    from databricks import sql

    conn = sql.connect(
        server_hostname=config.host,
        http_path=config.extra.get("http_path", ""),
        access_token=config.token,
    )
    try:
        cur = conn.cursor()
        try:
            for idx, stmt in enumerate(statements, start=1):
                try:
                    cur.execute(stmt)
                except Exception as e:
                    raise ApplyExecutionError("databricks", idx, stmt, e) from e

            if not skip_ledger:
                catalog = config.catalog or "main"
                schema_name = config.schema or "default"
                qualified = f"`{catalog}`.`{schema_name}`.`{ledger_table}`"
                cur.execute(
                    f"CREATE TABLE IF NOT EXISTS {qualified} ("
                    "migration_name STRING, checksum STRING, statement_count INT, status STRING, applied_at TIMESTAMP)"
                )
                cur.execute(
                    f"INSERT INTO {qualified} (migration_name, checksum, statement_count, status, applied_at) VALUES ("
                    f"'{_escape_sql_string(migration_name)}', '{checksum}', {len(statements)}, 'success', current_timestamp())"
                )
        finally:
            cur.close()
    finally:
        conn.close()


def _apply_bigquery(config: ConnectorConfig, statements: List[str], migration_name: str, checksum: str, ledger_table: str, skip_ledger: bool) -> None:
    from google.cloud import bigquery

    client = bigquery.Client(project=config.project)
    for idx, stmt in enumerate(statements, start=1):
        try:
            client.query(stmt).result()
        except Exception as e:
            raise ApplyExecutionError("bigquery", idx, stmt, e) from e

    if not skip_ledger:
        dataset = config.dataset
        if not dataset:
            raise ValueError("--dataset is required for BigQuery migration ledger")
        qualified = f"`{config.project}.{dataset}.{ledger_table}`"
        client.query(
            f"CREATE TABLE IF NOT EXISTS {qualified} ("
            "migration_name STRING, checksum STRING, statement_count INT64, status STRING, applied_at TIMESTAMP)"
        ).result()
        client.query(
            f"INSERT INTO {qualified} (migration_name, checksum, statement_count, status, applied_at) VALUES ("
            f"'{_escape_sql_string(migration_name)}', '{checksum}', {len(statements)}, 'success', CURRENT_TIMESTAMP())"
        ).result()


def cmd_apply(args: argparse.Namespace) -> int:
    connector_type = args.connector
    dialect = (getattr(args, "dialect", "") or connector_type).lower()
    started_ts = time.time()
    mode = "sql_file" if args.sql_file else "model_diff"
    policy_results: List[Dict[str, str]] = []

    if connector_type not in {"snowflake", "databricks", "bigquery"}:
        print("Apply currently supports only snowflake, databricks, and bigquery.", file=sys.stderr)
        return 1

    if dialect not in {"snowflake", "databricks", "bigquery"}:
        print(f"Unsupported apply dialect: {dialect}", file=sys.stderr)
        return 1

    if args.sql_file and (args.old or args.new):
        print("Use either --sql-file or --old/--new, not both.", file=sys.stderr)
        return 1

    if not args.sql_file and not (args.old and args.new):
        print("Provide --sql-file or both --old and --new.", file=sys.stderr)
        return 1

    if (args.old and not args.new) or (args.new and not args.old):
        print("Both --old and --new are required together.", file=sys.stderr)
        return 1

    if args.sql_file:
        sql_text = Path(args.sql_file).read_text(encoding="utf-8")
    else:
        schema = load_schema(args.model_schema)
        old_model, old_issues = _validate_model_file(args.old, schema)
        new_model, new_issues = _validate_model_file(args.new, schema)
        _print_issue_block(f"Old model ({args.old})", old_issues)
        _print_issue_block(f"New model ({args.new})", new_issues)
        combined_issues = list(old_issues) + list(new_issues)
        if has_errors(combined_issues):
            print("Apply failed: validation errors detected.", file=sys.stderr)
            return 1
        if not getattr(args, "skip_policy_check", False):
            policy_pack = load_policy_pack_with_inheritance(args.policy_pack)
            evaluated = policy_issues(new_model, policy_pack)
            _print_issue_block(f"Policy evaluation ({args.policy_pack})", evaluated)
            policy_results = _issues_as_json(evaluated)
            if has_errors(evaluated):
                print("Apply failed: policy check failed.", file=sys.stderr)
                return 1
        sql_text = generate_migration(old_model, new_model, dialect=dialect)

    statements = _split_sql_statements(sql_text)
    if not statements:
        print("No executable SQL statements found.", file=sys.stderr)
        return 1

    migration_name = args.migration_name or _default_migration_name()
    checksum = _sql_checksum(sql_text)
    destructive_findings = _detect_destructive_statements(statements)

    if destructive_findings and not getattr(args, "allow_destructive", False):
        print(
            "Apply blocked: destructive SQL detected. Re-run with --allow-destructive if this is intentional.",
            file=sys.stderr,
        )
        for finding in destructive_findings[:5]:
            print(
                f"  - #{finding['statement_index']} {finding['kind']}: {finding['preview']}",
                file=sys.stderr,
            )
        if len(destructive_findings) > 5:
            print(f"  ... and {len(destructive_findings) - 5} more statement(s).", file=sys.stderr)
        return 1

    if getattr(args, "write_sql", ""):
        Path(args.write_sql).write_text(sql_text.strip() + "\n", encoding="utf-8")

    report: Dict[str, Any] = {
        "connector": connector_type,
        "dialect": dialect,
        "mode": mode,
        "status": "pending",
        "migration_name": migration_name,
        "checksum": checksum,
        "statement_count": len(statements),
        "destructive_statement_count": len(destructive_findings),
        "destructive_statements": destructive_findings,
        "policy_checked": mode == "model_diff" and not getattr(args, "skip_policy_check", False),
        "policy_results": policy_results,
        "skip_ledger": bool(args.skip_ledger),
        "ledger_table": args.ledger_table,
        "started_at_epoch": started_ts,
        "started_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started_ts)),
    }

    if getattr(args, "dry_run", False):
        finished_ts = time.time()
        report["status"] = "dry_run"
        report["finished_at_epoch"] = finished_ts
        report["finished_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_ts))
        report["duration_ms"] = int((finished_ts - started_ts) * 1000)
        if getattr(args, "report_json", ""):
            _write_apply_report(args.report_json, report)
        if getattr(args, "output_json", False):
            print(json.dumps(report, indent=2))
        else:
            print(f"DRY RUN: {len(statements)} statements for {connector_type}")
            print(f"Migration: {migration_name}")
            print(f"Checksum: {checksum}")
            if destructive_findings:
                print(f"Destructive statements: {len(destructive_findings)} (allowed)")
            print("\n" + sql_text.strip() + "\n")
        return 0

    if connector_type == "snowflake" and (not getattr(args, "host", "") or not getattr(args, "user", "") or not getattr(args, "database", "")):
        print("Snowflake apply requires --host, --user, and --database.", file=sys.stderr)
        return 1
    if connector_type == "databricks" and (not getattr(args, "host", "") or not getattr(args, "token", "") or not getattr(args, "http_path", "")):
        print("Databricks apply requires --host, --token, and --http-path.", file=sys.stderr)
        return 1
    if connector_type == "bigquery" and (not getattr(args, "project", "") or not getattr(args, "dataset", "")):
        print("BigQuery apply requires --project and --dataset.", file=sys.stderr)
        return 1

    connector = get_connector(connector_type)
    if connector is None:
        print(f"Unknown connector: {connector_type}", file=sys.stderr)
        return 1

    ok, msg = connector.check_driver()
    if not ok:
        print(f"Driver check failed: {msg}", file=sys.stderr)
        return 1

    config = _build_connector_config(args)
    try:
        if connector_type == "snowflake":
            _apply_snowflake(config, statements, migration_name, checksum, args.ledger_table, args.skip_ledger)
        elif connector_type == "databricks":
            _apply_databricks(config, statements, migration_name, checksum, args.ledger_table, args.skip_ledger)
        elif connector_type == "bigquery":
            _apply_bigquery(config, statements, migration_name, checksum, args.ledger_table, args.skip_ledger)
    except ApplyExecutionError as e:
        finished_ts = time.time()
        report["status"] = "failed"
        report["error"] = str(e)
        report["failed_statement_index"] = e.statement_index
        report["failed_statement_preview"] = _preview_sql(e.statement)
        report["finished_at_epoch"] = finished_ts
        report["finished_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_ts))
        report["duration_ms"] = int((finished_ts - started_ts) * 1000)
        if getattr(args, "report_json", ""):
            _write_apply_report(args.report_json, report)
        if getattr(args, "output_json", False):
            print(json.dumps(report, indent=2))
        else:
            print(str(e), file=sys.stderr)
        return 1
    except Exception as e:
        finished_ts = time.time()
        report["status"] = "failed"
        report["error"] = str(e)
        report["finished_at_epoch"] = finished_ts
        report["finished_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_ts))
        report["duration_ms"] = int((finished_ts - started_ts) * 1000)
        if getattr(args, "report_json", ""):
            _write_apply_report(args.report_json, report)
        if getattr(args, "output_json", False):
            print(json.dumps(report, indent=2))
        else:
            print(f"Apply failed: {e}", file=sys.stderr)
        return 1

    finished_ts = time.time()
    report["status"] = "success"
    report["finished_at_epoch"] = finished_ts
    report["finished_at_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(finished_ts))
    report["duration_ms"] = int((finished_ts - started_ts) * 1000)
    if getattr(args, "report_json", ""):
        _write_apply_report(args.report_json, report)

    if getattr(args, "output_json", False):
        print(json.dumps(report, indent=2))
    else:
        print(f"Applied migration '{migration_name}' ({len(statements)} statements) to {connector_type}.")
        if not args.skip_ledger:
            print(f"Ledger table: {args.ledger_table}")
    return 0


def cmd_completion(args: argparse.Namespace) -> int:
    shell = args.shell
    if shell == "bash":
        print(generate_bash_completion())
    elif shell == "zsh":
        print(generate_zsh_completion())
    elif shell == "fish":
        print(generate_fish_completion())
    else:
        print(f"Unsupported shell: {shell}", file=sys.stderr)
        return 1
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    schema_path = getattr(args, "schema", None) or _default_schema_path()
    schema = load_schema(schema_path)
    watch_glob = getattr(args, "glob", "**/*.model.yaml")
    interval = getattr(args, "interval", 2)
    root = Path(".").resolve()

    print(f"Watching for changes: {watch_glob} (every {interval}s)")
    print("Press Ctrl+C to stop.\n")

    mtimes: Dict[str, float] = {}

    try:
        while True:
            current_files: Dict[str, float] = {}
            for pattern in [watch_glob]:
                for path in sorted(root.glob(pattern)):
                    rel = str(path.relative_to(root))
                    if ".git" in rel or "node_modules" in rel or ".venv" in rel:
                        continue
                    try:
                        mtime = path.stat().st_mtime
                        current_files[str(path)] = mtime
                    except OSError:
                        continue

            changed: List[str] = []
            for fpath, mtime in current_files.items():
                if fpath not in mtimes or mtimes[fpath] != mtime:
                    changed.append(fpath)

            mtimes = current_files

            for fpath in changed:
                rel = str(Path(fpath).relative_to(root))
                print(f"\n--- Changed: {rel} ---")
                try:
                    model = load_yaml_model(fpath)
                    s_issues = schema_issues(model, schema)
                    l_issues = lint_issues(model)
                    all_issues = s_issues + l_issues

                    if all_issues:
                        for iss in all_issues:
                            sev = iss.severity.upper()
                            print(f"  [{sev}] {iss.code}: {iss.message}")
                        error_count = sum(1 for i in all_issues if i.severity == "error")
                        warn_count = sum(1 for i in all_issues if i.severity == "warn")
                        print(f"  Result: {error_count} error(s), {warn_count} warning(s)")
                    else:
                        print("  \u2713 Valid")
                except Exception as exc:
                    print(f"  [ERROR] {exc}")

            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nWatch stopped.")
        return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="datalex", description="DataLex CLI")
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {_cli_version()}",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # `datalex serve` — start the bundled api-server + web-app on a
    # single port. Registered first because it's the single most
    # important command for new users (pip install → serve → browse).
    serve_parser = sub.add_parser(
        "serve",
        help="Start the DataLex web UI + API server on a single port",
    )
    serve_parser.add_argument(
        "--port", type=int, default=3030,
        help="Port to bind (default: 3030)",
    )
    serve_parser.add_argument(
        "--no-browser", action="store_true",
        help="Don't auto-open the browser on start",
    )
    serve_parser.add_argument(
        "--project-dir", default=None,
        help="Project root directory (where .dm-projects.json lives). "
             "Defaults to the current working directory.",
    )
    serve_parser.set_defaults(func=cmd_serve)

    init_parser = sub.add_parser("init", help="Initialize a new workspace")
    init_parser.add_argument("--path", default=".", help="Workspace path")
    init_parser.add_argument(
        "--template",
        choices=["single", "multi-model", "end-to-end"],
        default="single",
        help="Starter template to scaffold (default: single).",
    )
    init_parser.add_argument(
        "--multi-model",
        action="store_true",
        help="Deprecated alias for --template multi-model.",
    )
    init_parser.set_defaults(func=cmd_init)

    validate_parser = sub.add_parser("validate", help="Validate model with schema + semantic rules")
    validate_parser.add_argument("model", help="Path to model YAML")
    validate_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    validate_parser.set_defaults(func=cmd_validate)

    lint_parser = sub.add_parser("lint", help="Run semantic lint checks")
    lint_parser.add_argument("model", help="Path to model YAML")
    lint_parser.set_defaults(func=cmd_lint)

    compile_parser = sub.add_parser("compile", help="Compile model to canonical JSON")
    compile_parser.add_argument("model", help="Path to model YAML")
    compile_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    compile_parser.add_argument("--out", help="Output file for canonical JSON")
    compile_parser.set_defaults(func=cmd_compile)

    diff_parser = sub.add_parser("diff", help="Semantic diff between two model files")
    diff_parser.add_argument("old", help="Old model YAML path")
    diff_parser.add_argument("new", help="New model YAML path")
    diff_parser.set_defaults(func=cmd_diff)

    validate_all_parser = sub.add_parser(
        "validate-all", help="Validate all model files matching a glob"
    )
    validate_all_parser.add_argument(
        "--glob", default="**/*.model.yaml", help="Glob pattern for model files"
    )
    validate_all_parser.add_argument(
        "--exclude",
        nargs="*",
        default=["**/node_modules/**", "**/.git/**", "**/.venv/**"],
        help="Glob-style path patterns to exclude",
    )
    validate_all_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to JSON schema"
    )
    validate_all_parser.set_defaults(func=cmd_validate_all)

    gate_parser = sub.add_parser(
        "gate",
        help="PR gate: validate old/new models and fail on breaking changes by default",
    )
    gate_parser.add_argument("old", help="Old model YAML path")
    gate_parser.add_argument("new", help="New model YAML path")
    gate_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to JSON schema"
    )
    gate_parser.add_argument(
        "--allow-breaking",
        action="store_true",
        help="Allow breaking changes (still fails on validation errors)",
    )
    gate_parser.add_argument(
        "--output-json", action="store_true", help="Print semantic diff as JSON"
    )
    gate_parser.set_defaults(func=cmd_gate)

    readiness_gate_parser = sub.add_parser(
        "readiness-gate",
        help="CI/CD gate: run the dbt-readiness engine and fail on red/score thresholds",
    )
    readiness_gate_parser.add_argument(
        "--project", required=True, help="Path to the dbt/DataLex project root",
    )
    readiness_gate_parser.add_argument(
        "--min-score", type=int, default=None, help="Fail if project score < N",
    )
    readiness_gate_parser.add_argument(
        "--max-yellow", type=int, default=None, help="Fail if yellow file count > N",
    )
    readiness_gate_parser.add_argument(
        "--max-red", type=int, default=0, help="Fail if red file count > N (default: 0)",
    )
    readiness_gate_parser.add_argument(
        "--allow-errors",
        action="store_true",
        help="Don't fail on error-severity findings (default: fail when errors > 0)",
    )
    readiness_gate_parser.add_argument(
        "--changed-only",
        action="store_true",
        help="Only score files changed vs --base-ref (uses git diff)",
    )
    readiness_gate_parser.add_argument(
        "--base-ref",
        default="origin/main",
        help="Base ref for --changed-only (default: origin/main)",
    )
    readiness_gate_parser.add_argument(
        "--sarif", default="", help="Write SARIF 2.1.0 output to this path for code-scanning upload",
    )
    readiness_gate_parser.add_argument(
        "--pr-comment", default="", help="Write a sticky PR comment markdown summary to this path",
    )
    readiness_gate_parser.add_argument(
        "--output-json", action="store_true", help="Print full review JSON to stdout",
    )
    readiness_gate_parser.set_defaults(func=cmd_readiness_gate)

    policy_parser = sub.add_parser("policy-check", help="Evaluate a model against a policy pack")
    policy_parser.add_argument("model", help="Path to model YAML")
    # `--policy` may be passed multiple times to merge several packs (e.g.
    # the built-in `datalex/standards/base.yaml` plus an org-specific pack).
    # When omitted, the default pack is used; when one or more are passed,
    # the defaults are not implicitly added — pass them explicitly.
    policy_parser.add_argument(
        "--policy",
        action="append",
        default=None,
        help="Path to policy pack YAML; may be repeated to merge multiple packs",
    )
    policy_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to model schema JSON"
    )
    policy_parser.add_argument(
        "--policy-schema",
        default=_default_policy_schema_path(),
        help="Path to policy schema JSON",
    )
    policy_parser.add_argument("--output-json", action="store_true", help="Print policy output as JSON")
    policy_parser.add_argument("--inherit", action="store_true", help="Resolve pack.extends inheritance chain before evaluation")
    policy_parser.set_defaults(func=cmd_policy_check)

    generate_parser = sub.add_parser("generate", help="Generate artifacts from model YAML")
    generate_sub = generate_parser.add_subparsers(dest="generate_command", required=True)

    gen_sql_parser = generate_sub.add_parser("sql", help="Generate SQL DDL")
    gen_sql_parser.add_argument("model", help="Path to model YAML")
    gen_sql_parser.add_argument("--dialect", default="postgres", choices=["postgres", "snowflake", "bigquery", "databricks"])
    gen_sql_parser.add_argument("--out", help="Output SQL file path")
    gen_sql_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_sql_parser.set_defaults(func=cmd_generate_sql)

    gen_dbt_parser = generate_sub.add_parser("dbt", help="Generate dbt project scaffold")
    gen_dbt_parser.add_argument("model", help="Path to model YAML")
    gen_dbt_parser.add_argument("--out-dir", required=True, help="Target directory for scaffold files")
    gen_dbt_parser.add_argument("--source-name", default="raw", help="dbt source name")
    gen_dbt_parser.add_argument("--project-name", default="data_modeling_mvp", help="dbt project name")
    gen_dbt_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_dbt_parser.set_defaults(func=cmd_generate_dbt)

    gen_metadata_parser = generate_sub.add_parser("metadata", help="Generate metadata JSON export")
    gen_metadata_parser.add_argument("model", help="Path to model YAML")
    gen_metadata_parser.add_argument("--out", help="Output metadata JSON path")
    gen_metadata_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    gen_metadata_parser.set_defaults(func=cmd_generate_metadata)

    gen_docs_parser = generate_sub.add_parser("docs", help="Generate data dictionary documentation")
    gen_docs_parser.add_argument("model", help="Path to model YAML")
    gen_docs_parser.add_argument("--format", default="html", choices=["html", "markdown"], help="Output format")
    gen_docs_parser.add_argument("--out", help="Output file path")
    gen_docs_parser.add_argument("--title", help="Custom page title")
    gen_docs_parser.set_defaults(func=cmd_generate_docs)

    gen_changelog_parser = generate_sub.add_parser("changelog", help="Generate changelog from model diff")
    gen_changelog_parser.add_argument("old", help="Old model YAML path")
    gen_changelog_parser.add_argument("new", help="New model YAML path")
    gen_changelog_parser.add_argument("--out", help="Output changelog file path")
    gen_changelog_parser.set_defaults(func=cmd_generate_changelog)

    import_parser = sub.add_parser("import", help="Import SQL/DBML/Spark/dbt schema into model YAML")
    import_sub = import_parser.add_subparsers(dest="import_command", required=True)

    import_sql_parser = import_sub.add_parser("sql", help="Import SQL DDL file")
    import_sql_parser.add_argument("input", help="Path to SQL DDL file")
    import_sql_parser.add_argument("--out", help="Write output YAML model file")
    import_sql_parser.add_argument("--model-name", default="imported_sql_model", help="Model name")
    import_sql_parser.add_argument("--domain", default="imported", help="Domain value")
    import_sql_parser.add_argument(
        "--owner",
        action="append",
        default=[],
        help="Owner email (repeatable)",
    )
    import_sql_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_sql_parser.set_defaults(func=cmd_import_sql)

    import_dbml_parser = import_sub.add_parser("dbml", help="Import DBML file")
    import_dbml_parser.add_argument("input", help="Path to DBML file")
    import_dbml_parser.add_argument("--out", help="Write output YAML model file")
    import_dbml_parser.add_argument("--model-name", default="imported_dbml_model", help="Model name")
    import_dbml_parser.add_argument("--domain", default="imported", help="Domain value")
    import_dbml_parser.add_argument(
        "--owner",
        action="append",
        default=[],
        help="Owner email (repeatable)",
    )
    import_dbml_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_dbml_parser.set_defaults(func=cmd_import_dbml)

    import_spark_parser = import_sub.add_parser("spark-schema", help="Import Spark schema JSON file")
    import_spark_parser.add_argument("input", help="Path to Spark schema JSON file")
    import_spark_parser.add_argument("--out", help="Write output YAML model file")
    import_spark_parser.add_argument("--model-name", default="imported_spark_schema", help="Model name")
    import_spark_parser.add_argument("--table-name", help="Table name (for single StructType schemas)")
    import_spark_parser.add_argument("--domain", default="imported", help="Domain value")
    import_spark_parser.add_argument("--owner", action="append", default=[], help="Owner email (repeatable)")
    import_spark_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_spark_parser.set_defaults(func=cmd_import_spark_schema)

    import_dbt_parser = import_sub.add_parser("dbt", help="Import dbt schema.yml file")
    import_dbt_parser.add_argument("input", help="Path to dbt schema.yml file")
    import_dbt_parser.add_argument("--out", help="Write output YAML model file")
    import_dbt_parser.add_argument("--model-name", default="imported_dbt_model", help="Model name")
    import_dbt_parser.add_argument("--domain", default="imported", help="Domain value")
    import_dbt_parser.add_argument("--owner", action="append", default=[], help="Owner email (repeatable)")
    import_dbt_parser.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    import_dbt_parser.set_defaults(func=cmd_import_dbt)

    draft_parser = sub.add_parser(
        "draft",
        help="AI-assisted DataLex starter from a dbt project",
        description=(
            "Turn a dbt project's target/manifest.json into a draft DataLex "
            "*.model.yaml the user reviews, edits, and commits. Reviewable AI "
            "output -- never silent rewrites of project files."
        ),
    )
    draft_parser.add_argument(
        "--dbt",
        required=True,
        help="dbt project root (must contain target/manifest.json or dbt_project.yml)",
    )
    draft_parser.add_argument(
        "--domain",
        required=True,
        help="DataLex domain to assign (e.g. commerce, finance)",
    )
    draft_parser.add_argument(
        "--out",
        help="Write proposed YAML to this path (default: stdout)",
    )
    draft_parser.add_argument(
        "--force",
        action="store_true",
        help="Allow --out to overwrite an existing file",
    )
    draft_parser.add_argument(
        "--model",
        default="claude-opus-4-7",
        help="Anthropic model id (default: claude-opus-4-7)",
    )
    draft_parser.add_argument("--max-tokens", type=int, default=8000)
    draft_parser.add_argument(
        "--owner",
        help="Email for model.owners (default: git user.email or data@example.com)",
    )
    draft_parser.add_argument(
        "--include",
        help="dbt model name glob to include (e.g. dim_*)",
    )
    draft_parser.add_argument(
        "--schema",
        default=None,
        help="Path to DataLex model JSON schema (default: bundled)",
    )
    draft_parser.set_defaults(func=cmd_draft)

    # dbt round-trip subcommand group
    dbt_parser = sub.add_parser("dbt", help="dbt round-trip: sync DataLex metadata into dbt schema.yml files")
    dbt_sub = dbt_parser.add_subparsers(dest="dbt_command", required=True)

    dbt_sync_parser = dbt_sub.add_parser("sync", help="Merge DataLex metadata into a single dbt schema.yml (non-destructive)")
    dbt_sync_parser.add_argument("model", help="Path to the DataLex .model.yaml file")
    dbt_sync_parser.add_argument("--dbt-schema", required=True, help="Path to the existing dbt schema.yml to update")
    dbt_sync_parser.add_argument("--out", default=None, help="Output path (default: overwrites --dbt-schema in-place)")
    dbt_sync_parser.set_defaults(func=cmd_dbt_sync)

    dbt_push_parser = dbt_sub.add_parser("push", help="Push DataLex metadata into all schema.yml files found in a dbt project")
    dbt_push_parser.add_argument("model", help="Path to the DataLex .model.yaml file")
    dbt_push_parser.add_argument("--dbt-project", required=True, help="Root path of the dbt project to scan for schema.yml files")
    dbt_push_parser.set_defaults(func=cmd_dbt_push)

    dbt_import_parser = dbt_sub.add_parser(
        "import",
        help="Import a full dbt project (manifest + live types) into a folder-preserving DataLex tree",
    )
    dbt_import_parser.add_argument(
        "--project-dir",
        required=True,
        help="Path to the dbt project (the folder containing dbt_project.yml)",
    )
    dbt_import_parser.add_argument(
        "--out",
        required=True,
        help="Destination directory for the DataLex YAML tree (mirrors dbt models/ layout)",
    )
    dbt_import_parser.add_argument(
        "--manifest",
        default=None,
        help="Override path to manifest.json (default: <project-dir>/target/manifest.json)",
    )
    dbt_import_parser.add_argument(
        "--profiles-dir",
        default=None,
        help="Override profiles.yml search directory (default: dbt's rules)",
    )
    dbt_import_parser.add_argument(
        "--target",
        default=None,
        help="Pick a non-default target from the dbt profile",
    )
    dbt_import_parser.add_argument(
        "--skip-warehouse",
        action="store_true",
        help="Skip live warehouse introspection (rely on manifest data_type)",
    )
    dbt_import_parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the SyncReport as JSON instead of a human summary",
    )
    dbt_import_parser.set_defaults(func=cmd_dbt_import)

    emit_parser = sub.add_parser(
        "emit",
        help="Emit DataLex artifacts for external systems",
    )
    emit_sub = emit_parser.add_subparsers(dest="emit_command", required=True)
    emit_catalog_parser = emit_sub.add_parser(
        "catalog",
        help="Emit glossary + column-binding payload for an external catalog",
    )
    emit_catalog_parser.add_argument(
        "--target",
        required=True,
        help="Catalog target: atlan | datahub | openmetadata",
    )
    emit_catalog_parser.add_argument("--model", required=True, help="Path to the DataLex model YAML")
    emit_catalog_parser.add_argument("--out", required=True, help="Output directory")
    emit_catalog_parser.add_argument(
        "--schema", default=_default_schema_path(), help="Path to model schema JSON",
    )
    emit_catalog_parser.set_defaults(func=cmd_emit_catalog)

    dbt_docs_parser = dbt_sub.add_parser(
        "docs",
        help="Inspect and reindex the doc-block index for a dbt project",
    )
    dbt_docs_sub = dbt_docs_parser.add_subparsers(dest="dbt_docs_command", required=True)
    dbt_docs_reindex = dbt_docs_sub.add_parser(
        "reindex",
        # `%` must be escaped as `%%` in argparse help strings — Python 3.14's
        # stricter argparse validator reads `% d` as a `%d` conversion and
        # rejects the parser at build time.
        help="Rebuild the {%% docs %%} block index and print resolved names",
    )
    dbt_docs_reindex.add_argument(
        "--project-dir",
        required=True,
        help="Path to the dbt project root",
    )
    dbt_docs_reindex.add_argument("--json", action="store_true", help="Emit JSON instead of a summary")
    dbt_docs_reindex.set_defaults(func=cmd_dbt_docs_reindex)

    # ─── Project-wide docs export ─────────────────────────────────────────
    docs_parser = sub.add_parser("docs", help="Project-wide documentation tools")
    docs_sub = docs_parser.add_subparsers(dest="docs_command", required=True)
    docs_export = docs_sub.add_parser(
        "export",
        help="Walk a project and write per-model + per-domain Markdown docs (with mermaid ERDs)",
    )
    docs_export.add_argument("--project", required=True, help="Path to the DataLex project root")
    docs_export.add_argument("--out", required=True, help="Output directory for the generated MD tree")
    docs_export.add_argument("--json", action="store_true", help="Emit JSON summary on stdout")
    docs_export.set_defaults(func=cmd_docs_export)

    pull_parser = sub.add_parser("pull", help="Pull schema from a live database into a DataLex model")
    pull_parser.add_argument("connector", help="Connector type (postgres, mysql, snowflake, bigquery, databricks, sqlserver, azure_sql, azure_fabric, redshift)")
    pull_parser.add_argument("--host", help="Database host (or Snowflake account, Databricks server hostname)")
    pull_parser.add_argument("--port", type=int, help="Database port")
    pull_parser.add_argument("--database", help="Database name")
    pull_parser.add_argument("--db-schema", help="Schema name (default: public/PUBLIC/default)")
    pull_parser.add_argument("--user", help="Database user")
    pull_parser.add_argument("--password", help="Database password")
    pull_parser.add_argument("--warehouse", help="Snowflake warehouse")
    pull_parser.add_argument("--project", help="BigQuery project ID")
    pull_parser.add_argument("--dataset", help="BigQuery dataset")
    pull_parser.add_argument("--catalog", help="Databricks Unity Catalog name")
    pull_parser.add_argument("--token", help="Access token (Databricks)")
    pull_parser.add_argument("--http-path", help="Databricks SQL Warehouse/Cluster HTTP path")
    pull_parser.add_argument("--odbc-driver", help="ODBC driver for SQL Server-family connectors")
    pull_parser.add_argument("--encrypt", help="SQL Server encryption setting (yes/no)")
    pull_parser.add_argument("--trust-server-certificate", help="SQL Server TrustServerCertificate setting (yes/no)")
    pull_parser.add_argument("--private-key-path", help="Path to RSA private key PEM file (Snowflake key-pair auth)")
    pull_parser.add_argument("--tables", nargs="*", help="Only include these tables")
    pull_parser.add_argument("--exclude-tables", nargs="*", help="Exclude these tables")
    pull_parser.add_argument("--model-name", default="imported_model", help="Model name")
    pull_parser.add_argument("--domain", default="imported", help="Domain value")
    pull_parser.add_argument("--owner", help="Owner email")
    pull_parser.add_argument("--out", help="Output YAML model file path")
    pull_parser.add_argument("--project-dir", help="Project folder to write extracted model YAML")
    pull_parser.add_argument(
        "--create-project-dir",
        action="store_true",
        help="Create --project-dir if missing (otherwise prompt in interactive mode)",
    )
    pull_parser.add_argument("--test", action="store_true", help="Test connection only, do not pull schema")
    pull_parser.add_argument(
        "--dbt-layout",
        dest="dbt_layout",
        action="store_true",
        default=True,
        help="When --project-dir contains dbt_project.yml, write sources/ + models/staging/ layout (default on).",
    )
    pull_parser.add_argument(
        "--no-dbt-layout",
        dest="dbt_layout",
        action="store_false",
        help="Opt out of dbt folder convention even when dbt_project.yml is present.",
    )
    pull_parser.set_defaults(func=cmd_pull)

    connectors_parser = sub.add_parser("connectors", help="List available database connectors and driver status")
    connectors_parser.add_argument("--output-json", action="store_true", help="Print as JSON")
    connectors_parser.set_defaults(func=cmd_connectors)

    # Common connection args helper
    def _add_conn_args(p):
        p.add_argument("connector", help="Connector type (postgres, mysql, snowflake, bigquery, databricks, sqlserver, azure_sql, azure_fabric, redshift)")
        p.add_argument("--host", help="Database host")
        p.add_argument("--port", type=int, help="Database port")
        p.add_argument("--database", help="Database name")
        p.add_argument("--db-schema", help="Schema name")
        p.add_argument("--user", help="Database user")
        p.add_argument("--password", help="Database password")
        p.add_argument("--warehouse", help="Snowflake warehouse")
        p.add_argument("--project", help="BigQuery project ID")
        p.add_argument("--dataset", help="BigQuery dataset")
        p.add_argument("--catalog", help="Databricks catalog")
        p.add_argument("--token", help="Access token")
        p.add_argument("--http-path", help="Databricks SQL Warehouse/Cluster HTTP path")
        p.add_argument("--odbc-driver", help="ODBC driver for SQL Server-family connectors")
        p.add_argument("--encrypt", help="SQL Server encryption setting (yes/no)")
        p.add_argument("--trust-server-certificate", help="SQL Server TrustServerCertificate setting (yes/no)")
        p.add_argument("--private-key-path", help="Path to RSA private key PEM file (Snowflake key-pair auth)")
        p.add_argument("--output-json", action="store_true", help="Print as JSON")

    schemas_parser = sub.add_parser("schemas", help="List schemas/datasets in a database")
    _add_conn_args(schemas_parser)
    schemas_parser.set_defaults(func=cmd_schemas)

    tables_parser = sub.add_parser("tables", help="List tables in a database schema")
    _add_conn_args(tables_parser)
    tables_parser.set_defaults(func=cmd_tables)

    resolve_parser = sub.add_parser("resolve", help="Resolve cross-model imports and show unified graph")
    resolve_parser.add_argument("model", help="Path to root model YAML")
    resolve_parser.add_argument(
        "--search-dir",
        action="append",
        default=[],
        help="Additional directories to search for imported models (repeatable)",
    )
    resolve_parser.add_argument("--output-json", action="store_true", help="Print graph as JSON")
    resolve_parser.set_defaults(func=cmd_resolve)

    resolve_project_parser = sub.add_parser("resolve-project", help="Resolve all models in a project directory")
    resolve_project_parser.add_argument("directory", help="Project directory path")
    resolve_project_parser.add_argument(
        "--search-dir",
        action="append",
        default=[],
        help="Additional search directories (repeatable)",
    )
    resolve_project_parser.add_argument("--output-json", action="store_true", help="Print results as JSON")
    resolve_project_parser.set_defaults(func=cmd_resolve_project)

    diff_all_parser = sub.add_parser("diff-all", help="Semantic diff between two model directories")
    diff_all_parser.add_argument("old", help="Old model directory")
    diff_all_parser.add_argument("new", help="New model directory")
    diff_all_parser.add_argument("--output-json", action="store_true", help="Print diff as JSON")
    diff_all_parser.add_argument(
        "--allow-breaking",
        action="store_true",
        help="Allow breaking changes (exit 0 even with breaking changes)",
    )
    diff_all_parser.set_defaults(func=cmd_diff_all)

    transform_parser = sub.add_parser("transform", help="Transform a model between conceptual, logical, and physical forms")
    transform_sub = transform_parser.add_subparsers(dest="transform_command", required=True)

    transform_to_logical = transform_sub.add_parser("conceptual-to-logical", help="Transform a conceptual model into a logical model")
    transform_to_logical.add_argument("model", help="Path to source model YAML")
    transform_to_logical.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    transform_to_logical.add_argument("--out", help="Write transformed model YAML")
    transform_to_logical.set_defaults(func=cmd_transform)

    transform_to_physical = transform_sub.add_parser("logical-to-physical", help="Transform a logical model into a physical model")
    transform_to_physical.add_argument("model", help="Path to source model YAML")
    transform_to_physical.add_argument("--dialect", default="postgres", choices=["postgres", "snowflake", "bigquery", "databricks"])
    transform_to_physical.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    transform_to_physical.add_argument("--out", help="Write transformed model YAML")
    transform_to_physical.set_defaults(func=cmd_transform)

    standards_parser = sub.add_parser("standards", help="Check or autofix model standards, naming rules, and shared libraries")
    standards_sub = standards_parser.add_subparsers(dest="standards_command", required=True)

    standards_check = standards_sub.add_parser("check", help="Evaluate standards and naming rules")
    standards_check.add_argument("model", help="Path to model YAML")
    standards_check.add_argument("--schema", default=_default_schema_path(), help="Path to model schema JSON")
    standards_check.add_argument("--output-json", action="store_true", help="Print standards report as JSON")
    standards_check.set_defaults(func=cmd_standards_check)

    standards_fix = standards_sub.add_parser("fix", help="Apply supported standards autofixes")
    standards_fix.add_argument("model", help="Path to model YAML")
    standards_fix.add_argument("--write", "-w", action="store_true", help="Overwrite the input model in-place")
    standards_fix.add_argument("--out", help="Write fixed YAML to a new path")
    standards_fix.set_defaults(func=cmd_standards_fix)

    sync_parser = sub.add_parser("sync", help="Round-trip compare, merge, or pull workflows")
    sync_sub = sync_parser.add_subparsers(dest="sync_command", required=True)

    sync_compare = sync_sub.add_parser("compare", help="Compare current and candidate models")
    sync_compare.add_argument("current", help="Current local model YAML")
    sync_compare.add_argument("candidate", help="Candidate/live model YAML")
    sync_compare.add_argument("--allow-breaking", action="store_true", help="Return 0 even when breaking changes are detected")
    sync_compare.set_defaults(func=cmd_sync_compare)

    sync_merge = sync_sub.add_parser("merge", help="Merge documentation metadata from current into candidate model")
    sync_merge.add_argument("current", help="Current local model YAML")
    sync_merge.add_argument("candidate", help="Candidate/live model YAML")
    sync_merge.add_argument("--out", help="Write merged model YAML")
    sync_merge.set_defaults(func=cmd_sync_merge)

    sync_pull = sync_sub.add_parser("pull", help="Alias of 'datalex pull' for round-trip workflows")
    sync_pull.add_argument("connector", help="Connector type (postgres, mysql, snowflake, bigquery, databricks, sqlserver, azure_sql, azure_fabric, redshift)")
    sync_pull.add_argument("--host", help="Database host (or Snowflake account, Databricks server hostname)")
    sync_pull.add_argument("--port", type=int, help="Database port")
    sync_pull.add_argument("--database", help="Database name")
    sync_pull.add_argument("--db-schema", help="Schema name (default: public/PUBLIC/default)")
    sync_pull.add_argument("--user", help="Database user")
    sync_pull.add_argument("--password", help="Database password")
    sync_pull.add_argument("--warehouse", help="Snowflake warehouse")
    sync_pull.add_argument("--project", help="BigQuery project ID")
    sync_pull.add_argument("--dataset", help="BigQuery dataset")
    sync_pull.add_argument("--catalog", help="Databricks Unity Catalog name")
    sync_pull.add_argument("--token", help="Access token (Databricks)")
    sync_pull.add_argument("--http-path", help="Databricks SQL Warehouse/Cluster HTTP path")
    sync_pull.add_argument("--odbc-driver", help="ODBC driver for SQL Server-family connectors")
    sync_pull.add_argument("--encrypt", help="SQL Server encryption setting (yes/no)")
    sync_pull.add_argument("--trust-server-certificate", help="SQL Server TrustServerCertificate setting (yes/no)")
    sync_pull.add_argument("--private-key-path", help="Path to RSA private key PEM file (Snowflake key-pair auth)")
    sync_pull.add_argument("--tables", nargs="*", help="Only include these tables")
    sync_pull.add_argument("--exclude-tables", nargs="*", help="Exclude these tables")
    sync_pull.add_argument("--model-name", default="imported_model", help="Model name")
    sync_pull.add_argument("--domain", default="imported", help="Domain value")
    sync_pull.add_argument("--owner", help="Owner email")
    sync_pull.add_argument("--out", help="Output YAML model file path")
    sync_pull.add_argument("--project-dir", help="Project folder to write extracted model YAML")
    sync_pull.add_argument("--create-project-dir", action="store_true", help="Create --project-dir if missing")
    sync_pull.add_argument("--test", action="store_true", help="Test connection only, do not pull schema")
    sync_pull.set_defaults(func=cmd_sync_pull)

    fmt_parser = sub.add_parser("fmt", help="Auto-format YAML model to canonical style")
    fmt_parser.add_argument("model", help="Path to model YAML")
    fmt_parser.add_argument("--write", "-w", action="store_true", help="Overwrite the input file in-place")
    fmt_parser.add_argument("--out", help="Output file path (alternative to --write)")
    fmt_parser.set_defaults(func=cmd_fmt)

    stats_parser = sub.add_parser("stats", help="Print model statistics")
    stats_parser.add_argument("model", help="Path to model YAML")
    stats_parser.add_argument("--output-json", action="store_true", help="Print stats as JSON")
    stats_parser.set_defaults(func=cmd_stats)

    completeness_parser = sub.add_parser(
        "completeness",
        help="Score each entity against single-source-of-truth completeness dimensions",
    )
    completeness_parser.add_argument("model", help="Path to model YAML")
    completeness_parser.add_argument(
        "--output-json", action="store_true", help="Emit full report as JSON (for API/CI integration)"
    )
    completeness_parser.add_argument(
        "--summary", action="store_true", help="Show scores only, suppress per-entity missing detail"
    )
    completeness_parser.add_argument(
        "--min-score",
        type=int,
        default=None,
        metavar="N",
        help="Exit with code 1 if any entity scores below N%% (useful in CI gates)",
    )
    completeness_parser.set_defaults(func=cmd_completeness)

    schema_parser = sub.add_parser("print-schema", help="Print active model schema JSON")
    schema_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    schema_parser.set_defaults(func=cmd_schema)

    policy_schema_parser = sub.add_parser("print-policy-schema", help="Print policy schema JSON")
    policy_schema_parser.add_argument(
        "--policy-schema",
        default=_default_policy_schema_path(),
        help="Path to policy schema JSON",
    )
    policy_schema_parser.set_defaults(func=cmd_policy_schema)

    doctor_parser = sub.add_parser("doctor", help="Diagnose project setup issues")
    doctor_parser.add_argument("--path", default=".", help="Project directory to diagnose")
    doctor_parser.add_argument("--output-json", action="store_true", help="Print diagnostics as JSON")
    doctor_parser.set_defaults(func=cmd_doctor)

    migrate_parser = sub.add_parser("migrate", help="Generate SQL migration between two model versions")
    migrate_parser.add_argument("old", help="Old model YAML path")
    migrate_parser.add_argument("new", help="New model YAML path")
    migrate_parser.add_argument("--dialect", default="postgres", choices=["postgres", "snowflake", "bigquery", "databricks"])
    migrate_parser.add_argument("--out", help="Output SQL migration file path")
    migrate_parser.set_defaults(func=cmd_migrate)

    apply_parser = sub.add_parser("apply", help="Apply SQL/migration to a live database")
    apply_parser.add_argument("connector", choices=["snowflake", "databricks", "bigquery"], help="Target connector")
    apply_parser.add_argument("--dialect", default=None, choices=["snowflake", "bigquery", "databricks"], help="SQL dialect (defaults to connector)")
    apply_parser.add_argument("--sql-file", help="Path to SQL file to apply")
    apply_parser.add_argument("--old", help="Old model YAML path (for generated migration)")
    apply_parser.add_argument("--new", help="New model YAML path (for generated migration)")
    apply_parser.add_argument("--model-schema", default=_default_schema_path(), help="Path to model schema JSON")
    apply_parser.add_argument("--host", help="Database host/account")
    apply_parser.add_argument("--port", type=int, help="Database port")
    apply_parser.add_argument("--database", help="Database name")
    apply_parser.add_argument("--db-schema", help="Schema name")
    apply_parser.add_argument("--user", help="Database user")
    apply_parser.add_argument("--password", help="Database password or key passphrase")
    apply_parser.add_argument("--warehouse", help="Snowflake warehouse")
    apply_parser.add_argument("--project", help="BigQuery project ID")
    apply_parser.add_argument("--dataset", help="BigQuery dataset")
    apply_parser.add_argument("--catalog", help="Databricks catalog")
    apply_parser.add_argument("--token", help="Databricks token")
    apply_parser.add_argument("--http-path", help="Databricks SQL Warehouse/Cluster HTTP path")
    apply_parser.add_argument("--private-key-path", help="Path to RSA private key PEM file (Snowflake key-pair auth)")
    apply_parser.add_argument("--migration-name", help="Migration name override")
    apply_parser.add_argument("--ledger-table", default="datalex_migrations", help="Migration ledger table name")
    apply_parser.add_argument("--skip-ledger", action="store_true", help="Skip writing migration ledger record")
    apply_parser.add_argument("--policy-pack", default=_default_policy_path(), help="Policy pack for model-diff preflight checks")
    apply_parser.add_argument("--skip-policy-check", action="store_true", help="Skip policy preflight checks for model-diff apply")
    apply_parser.add_argument("--allow-destructive", action="store_true", help="Allow destructive SQL statements (DROP/TRUNCATE)")
    apply_parser.add_argument("--write-sql", help="Write final SQL payload to file before execution")
    apply_parser.add_argument("--report-json", help="Write structured apply report JSON to file")
    apply_parser.add_argument("--output-json", action="store_true", help="Print structured apply report JSON")
    apply_parser.add_argument("--dry-run", action="store_true", help="Print SQL and exit without execution")
    apply_parser.set_defaults(func=cmd_apply)

    completion_parser = sub.add_parser("completion", help="Generate shell completion script")
    completion_parser.add_argument("shell", choices=["bash", "zsh", "fish"], help="Shell type")
    completion_parser.set_defaults(func=cmd_completion)

    watch_parser = sub.add_parser("watch", help="Watch model files and validate on change")
    watch_parser.add_argument("--glob", default="**/*.model.yaml", help="Glob pattern for model files")
    watch_parser.add_argument("--interval", type=int, default=2, help="Poll interval in seconds")
    watch_parser.add_argument("--schema", default=_default_schema_path(), help="Path to JSON schema")
    watch_parser.set_defaults(func=cmd_watch)

    from datalex_cli.datalex_cli import register_datalex
    register_datalex(sub)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
