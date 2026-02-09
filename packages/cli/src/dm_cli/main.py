import argparse
import glob
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

import yaml

from dm_core import (
    compile_model,
    generate_sql_ddl,
    import_dbml,
    import_sql_ddl,
    lint_issues,
    load_policy_pack,
    load_schema,
    load_yaml_model,
    policy_issues,
    schema_issues,
    semantic_diff,
    write_dbt_scaffold,
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


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.path).resolve()
    (root / "schemas").mkdir(parents=True, exist_ok=True)
    (root / "model-examples").mkdir(parents=True, exist_ok=True)
    (root / "policies").mkdir(parents=True, exist_ok=True)

    schema_dst = root / "schemas" / "model.schema.json"
    policy_schema_dst = root / "schemas" / "policy.schema.json"
    sample_dst = root / "model-examples" / "starter.model.yaml"
    default_policy_dst = root / "policies" / "default.policy.yaml"
    strict_policy_dst = root / "policies" / "strict.policy.yaml"
    config_dst = root / "dm.config.yaml"

    if not schema_dst.exists():
        repo_schema = Path.cwd() / "schemas" / "model.schema.json"
        if repo_schema.exists():
            schema_dst.write_text(repo_schema.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            schema_dst.write_text("{}", encoding="utf-8")

    if not policy_schema_dst.exists():
        repo_policy_schema = Path.cwd() / "schemas" / "policy.schema.json"
        if repo_policy_schema.exists():
            policy_schema_dst.write_text(
                repo_policy_schema.read_text(encoding="utf-8"), encoding="utf-8"
            )
        else:
            policy_schema_dst.write_text("{}", encoding="utf-8")

    if not sample_dst.exists():
        sample_dst.write_text(STARTER_MODEL, encoding="utf-8")

    repo_policy_dir = Path.cwd() / "policies"
    if not default_policy_dst.exists():
        repo_default = repo_policy_dir / "default.policy.yaml"
        if repo_default.exists():
            default_policy_dst.write_text(repo_default.read_text(encoding="utf-8"), encoding="utf-8")

    if not strict_policy_dst.exists():
        repo_strict = repo_policy_dir / "strict.policy.yaml"
        if repo_strict.exists():
            strict_policy_dst.write_text(repo_strict.read_text(encoding="utf-8"), encoding="utf-8")

    if not config_dst.exists():
        config_dst.write_text(
            "schema: schemas/model.schema.json\n"
            "policy_schema: schemas/policy.schema.json\n"
            "policy_pack: policies/default.policy.yaml\n"
            "model_glob: \"**/*.model.yaml\"\n",
            encoding="utf-8",
        )

    print(f"Initialized MVP workspace at {root}")
    print(f"- {schema_dst}")
    print(f"- {policy_schema_dst}")
    print(f"- {sample_dst}")
    print(f"- {default_policy_dst}")
    print(f"- {strict_policy_dst}")
    print(f"- {config_dst}")
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
            "rule_count": len(canonical.get("rules", [])),
        },
        "entities": canonical.get("entities", []),
        "relationships": canonical.get("relationships", []),
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


def cmd_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    print(json.dumps(schema, indent=2))
    return 0


def cmd_policy_schema(args: argparse.Namespace) -> int:
    schema = load_schema(args.policy_schema)
    print(json.dumps(schema, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="dm", description="DataLex CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    init_parser = sub.add_parser("init", help="Initialize a new workspace")
    init_parser.add_argument("--path", default=".", help="Workspace path")
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
    policy_parser.set_defaults(func=cmd_policy_check)

    generate_parser = sub.add_parser("generate", help="Generate artifacts from model YAML")
    generate_sub = generate_parser.add_subparsers(dest="generate_command", required=True)

    gen_sql_parser = generate_sub.add_parser("sql", help="Generate SQL DDL")
    gen_sql_parser.add_argument("model", help="Path to model YAML")
    gen_sql_parser.add_argument("--dialect", default="postgres", choices=["postgres", "snowflake"])
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

    import_parser = sub.add_parser("import", help="Import SQL/DBML into model YAML")
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

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
