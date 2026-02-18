import argparse
import glob
import json
import hashlib
import re
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import urlparse

import yaml

from dm_core import (
    compile_model,
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
    list_connectors,
    lint_issues,
    load_policy_pack,
    load_policy_pack_with_inheritance,
    load_schema,
    load_yaml_model,
    merge_policy_packs,
    policy_issues,
    project_diff,
    resolve_model,
    resolve_project,
    run_diagnostics,
    schema_issues,
    semantic_diff,
    write_changelog,
    write_dbt_scaffold,
    write_html_docs,
    write_markdown_docs,
    write_migration,
)
from dm_core.issues import Issue, has_errors, to_lines

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
dm validate-all --glob "models/**/*.model.yaml"
dm policy-check models/source/source_sales_raw.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/transform/commerce_transform.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/report/commerce_reporting.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm resolve-project models
dm generate docs models/report/commerce_reporting.model.yaml --format html --out docs/dictionary/reporting-dictionary.html
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


def cmd_policy_check(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    policy_schema = load_schema(args.policy_schema)

    model, model_issues = _validate_model_file(args.model, schema)
    if getattr(args, "inherit", False):
        policy_pack = load_policy_pack_with_inheritance(args.policy)
    else:
        policy_pack = load_policy_pack(args.policy)
    policy_pack_issues = schema_issues(policy_pack, policy_schema)

    _print_issue_block(f"Model checks ({args.model})", model_issues)
    _print_issue_block(f"Policy pack checks ({args.policy})", policy_pack_issues)

    if has_errors(model_issues) or has_errors(policy_pack_issues):
        print("Policy check failed: validation errors detected before policy evaluation.")
        return 1

    evaluated_issues = policy_issues(model, policy_pack)
    _print_issue_block("Policy evaluation", evaluated_issues)

    if args.output_json:
        payload = {
            "model": args.model,
            "policy": args.policy,
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
        "generated_by": "dm generate metadata",
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

    if output_path_or_error:
        _write_yaml(output_path_or_error, result.model)
        print(f"\nWrote model: {output_path_or_error}")
    else:
        print("\n" + yaml.safe_dump(result.model, sort_keys=False))

    return 0


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
            "\nUsage: dm pull <connector> --host <host> --database <db> --user <user> "
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
    from dm_core.connectors.snowflake import _load_private_key

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
    parser = argparse.ArgumentParser(prog="dm", description="DuckCodeModeling CLI")
    sub = parser.add_subparsers(dest="command", required=True)

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

    policy_parser = sub.add_parser("policy-check", help="Evaluate a model against a policy pack")
    policy_parser.add_argument("model", help="Path to model YAML")
    policy_parser.add_argument(
        "--policy", default=_default_policy_path(), help="Path to policy pack YAML"
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

    pull_parser = sub.add_parser("pull", help="Pull schema from a live database into a DuckCodeModeling model")
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

    fmt_parser = sub.add_parser("fmt", help="Auto-format YAML model to canonical style")
    fmt_parser.add_argument("model", help="Path to model YAML")
    fmt_parser.add_argument("--write", "-w", action="store_true", help="Overwrite the input file in-place")
    fmt_parser.add_argument("--out", help="Output file path (alternative to --write)")
    fmt_parser.set_defaults(func=cmd_fmt)

    stats_parser = sub.add_parser("stats", help="Print model statistics")
    stats_parser.add_argument("model", help="Path to model YAML")
    stats_parser.add_argument("--output-json", action="store_true", help="Print stats as JSON")
    stats_parser.set_defaults(func=cmd_stats)

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
    apply_parser.add_argument("--ledger-table", default="duckcodemodeling_migrations", help="Migration ledger table name")
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

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
