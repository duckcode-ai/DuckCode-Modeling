"""Tests for Phase 3: Documentation & Data Dictionary generation."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from dm_core.docs_generator import (
    generate_changelog,
    generate_html_docs,
    generate_markdown_docs,
    write_changelog,
    write_html_docs,
    write_markdown_docs,
)
from dm_core.diffing import semantic_diff
from dm_core.loader import load_yaml_model

ENTERPRISE_MODEL = str(Path(__file__).resolve().parent.parent / "model-examples" / "enterprise-dwh.model.yaml")
STARTER_MODEL = str(Path(__file__).resolve().parent.parent / "model-examples" / "starter-commerce.model.yaml")
REPORTING_MODEL = str(
    Path(__file__).resolve().parent.parent
    / "model-examples"
    / "end-to-end-dictionary"
    / "commerce_reporting.model.yaml"
)
DM_CLI = str(Path(__file__).resolve().parent.parent / "dm")


def _enterprise():
    return load_yaml_model(ENTERPRISE_MODEL)


def _starter():
    return load_yaml_model(STARTER_MODEL)


def _reporting():
    return load_yaml_model(REPORTING_MODEL)


# ---------------------------------------------------------------------------
# HTML Generation
# ---------------------------------------------------------------------------

class TestHTMLDocs:
    def test_generates_valid_html(self):
        html = generate_html_docs(_enterprise())
        assert html.startswith("<!DOCTYPE html>")
        assert "</html>" in html

    def test_contains_model_name(self):
        html = generate_html_docs(_enterprise())
        assert "enterprise_dwh" in html

    def test_contains_all_entities(self):
        model = _enterprise()
        html = generate_html_docs(model)
        for entity in model.get("entities", []):
            assert entity["name"] in html

    def test_contains_field_names(self):
        model = _enterprise()
        html = generate_html_docs(model)
        # Check a few known fields
        assert "customer_id" in html
        assert "email" in html

    def test_contains_relationships(self):
        model = _enterprise()
        html = generate_html_docs(model)
        for rel in model.get("relationships", []):
            assert rel["name"] in html

    def test_contains_indexes(self):
        model = _enterprise()
        html = generate_html_docs(model)
        for idx in model.get("indexes", []):
            assert idx["name"] in html

    def test_contains_glossary(self):
        model = _enterprise()
        html = generate_html_docs(model)
        for term in model.get("glossary", []):
            assert term["term"] in html

    def test_contains_classifications(self):
        model = _enterprise()
        html = generate_html_docs(model)
        classifications = model.get("governance", {}).get("classification", {})
        for target, cls in classifications.items():
            assert cls in html

    def test_contains_search_box(self):
        html = generate_html_docs(_enterprise())
        assert 'id="search"' in html
        assert "filterEntities" in html

    def test_contains_stats_bar(self):
        html = generate_html_docs(_enterprise())
        assert "stat-value" in html
        assert "Entities" in html
        assert "Fields" in html

    def test_entity_type_badges(self):
        html = generate_html_docs(_enterprise())
        assert "materialized_view" in html
        assert "external_table" in html
        assert "snapshot" in html

    def test_field_badges(self):
        html = generate_html_docs(_enterprise())
        assert "badge-pk" in html
        assert "NOT NULL" in html

    def test_custom_title(self):
        html = generate_html_docs(_enterprise(), title="My Custom Title")
        assert "My Custom Title" in html

    def test_self_contained(self):
        html = generate_html_docs(_enterprise())
        assert "<style>" in html
        assert "<script>" in html
        # No external CSS/JS links
        assert 'rel="stylesheet"' not in html

    def test_starter_model_works(self):
        html = generate_html_docs(_starter())
        assert "commerce" in html
        assert "Customer" in html

    def test_write_html_docs(self, tmp_path):
        out = str(tmp_path / "docs.html")
        result = write_html_docs(_enterprise(), out)
        assert Path(result).exists()
        content = Path(result).read_text()
        assert "<!DOCTYPE html>" in content
        assert "enterprise_dwh" in content

    def test_metrics_section_rendered_html(self):
        html = generate_html_docs(_reporting())
        assert "Metric Contracts" in html
        assert "daily_gross_revenue" in html


# ---------------------------------------------------------------------------
# Markdown Generation
# ---------------------------------------------------------------------------

class TestMarkdownDocs:
    def test_generates_markdown(self):
        md = generate_markdown_docs(_enterprise())
        assert md.startswith("# ")

    def test_contains_model_metadata(self):
        md = generate_markdown_docs(_enterprise())
        assert "enterprise_dwh" in md
        assert "analytics" in md

    def test_contains_toc(self):
        md = generate_markdown_docs(_enterprise())
        assert "## Table of Contents" in md

    def test_contains_all_entities(self):
        model = _enterprise()
        md = generate_markdown_docs(model)
        for entity in model.get("entities", []):
            assert f"## {entity['name']}" in md

    def test_contains_field_table(self):
        md = generate_markdown_docs(_enterprise())
        assert "| Field | Type |" in md
        assert "customer_id" in md

    def test_contains_relationships_section(self):
        md = generate_markdown_docs(_enterprise())
        assert "## Relationships" in md

    def test_contains_glossary_section(self):
        md = generate_markdown_docs(_enterprise())
        assert "## Glossary" in md

    def test_contains_classification_section(self):
        md = generate_markdown_docs(_enterprise())
        assert "## Data Classification" in md

    def test_contains_indexes(self):
        model = _enterprise()
        md = generate_markdown_docs(model)
        for idx in model.get("indexes", []):
            assert idx["name"] in md

    def test_custom_title(self):
        md = generate_markdown_docs(_enterprise(), title="Custom Title")
        assert "# Custom Title" in md

    def test_stats_table(self):
        md = generate_markdown_docs(_enterprise())
        assert "| Entities | Fields |" in md

    def test_starter_model_works(self):
        md = generate_markdown_docs(_starter())
        assert "commerce" in md

    def test_write_markdown_docs(self, tmp_path):
        out = str(tmp_path / "docs.md")
        result = write_markdown_docs(_enterprise(), out)
        assert Path(result).exists()
        content = Path(result).read_text()
        assert "enterprise_dwh" in content

    def test_metrics_section_rendered_markdown(self):
        md = generate_markdown_docs(_reporting())
        assert "## Metric Contracts" in md
        assert "daily_gross_revenue" in md


# ---------------------------------------------------------------------------
# Changelog Generation
# ---------------------------------------------------------------------------

class TestChangelog:
    def test_generates_changelog(self):
        diff = semantic_diff(_starter(), _enterprise())
        cl = generate_changelog(diff, old_version="1.0.0", new_version="2.0.0")
        assert "# Changelog" in cl
        assert "1.0.0" in cl
        assert "2.0.0" in cl

    def test_changelog_summary(self):
        diff = semantic_diff(_starter(), _enterprise())
        cl = generate_changelog(diff)
        assert "## Summary" in cl
        assert "Entities added:" in cl
        assert "Breaking changes:" in cl

    def test_changelog_added_entities(self):
        diff = semantic_diff(_starter(), _enterprise())
        cl = generate_changelog(diff)
        assert "## Added Entities" in cl
        assert "Address" in cl

    def test_changelog_changed_entities(self):
        diff = semantic_diff(_starter(), _enterprise())
        cl = generate_changelog(diff)
        assert "## Changed Entities" in cl
        assert "### Customer" in cl

    def test_changelog_no_breaking(self):
        diff = semantic_diff(_starter(), _enterprise())
        cl = generate_changelog(diff)
        assert "Breaking changes: None" in cl

    def test_changelog_with_breaking(self):
        # Simulate a breaking diff by removing an entity
        old = _enterprise()
        new = _starter()
        diff = semantic_diff(old, new)
        cl = generate_changelog(diff)
        assert "Breaking changes: Yes" in cl
        assert "## Removed Entities" in cl or "## Breaking Changes" in cl

    def test_write_changelog(self, tmp_path):
        diff = semantic_diff(_starter(), _enterprise())
        out = str(tmp_path / "CHANGELOG.md")
        result = write_changelog(diff, out, old_version="1.0", new_version="2.0")
        assert Path(result).exists()
        content = Path(result).read_text()
        assert "# Changelog" in content

    def test_empty_diff_changelog(self):
        diff = semantic_diff(_enterprise(), _enterprise())
        cl = generate_changelog(diff)
        assert "Entities added: 0" in cl
        assert "Entities removed: 0" in cl

    def test_changelog_includes_metric_summary(self):
        old = _starter()
        new = _reporting()
        diff = semantic_diff(old, new)
        cl = generate_changelog(diff)
        assert "Metrics added:" in cl


# ---------------------------------------------------------------------------
# CLI Commands
# ---------------------------------------------------------------------------

class TestCLIDocs:
    def test_dm_generate_docs_html(self, tmp_path):
        out = str(tmp_path / "docs.html")
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "docs", ENTERPRISE_MODEL, "--format", "html", "--out", out],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Wrote HTML docs" in result.stdout
        assert Path(out).exists()
        content = Path(out).read_text()
        assert "<!DOCTYPE html>" in content

    def test_dm_generate_docs_markdown(self, tmp_path):
        out = str(tmp_path / "docs.md")
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "docs", ENTERPRISE_MODEL, "--format", "markdown", "--out", out],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Wrote Markdown docs" in result.stdout
        assert Path(out).exists()

    def test_dm_generate_docs_stdout(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "docs", STARTER_MODEL, "--format", "html"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "<!DOCTYPE html>" in result.stdout

    def test_dm_generate_docs_markdown_stdout(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "docs", STARTER_MODEL, "--format", "markdown"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "# commerce" in result.stdout

    def test_dm_generate_docs_custom_title(self, tmp_path):
        out = str(tmp_path / "docs.html")
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "docs", ENTERPRISE_MODEL, "--title", "My DWH Docs", "--out", out],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        content = Path(out).read_text()
        assert "My DWH Docs" in content

    def test_dm_generate_changelog(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "changelog", STARTER_MODEL, ENTERPRISE_MODEL],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "# Changelog" in result.stdout
        assert "Entities added:" in result.stdout

    def test_dm_generate_changelog_to_file(self, tmp_path):
        out = str(tmp_path / "CHANGELOG.md")
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "changelog", STARTER_MODEL, ENTERPRISE_MODEL, "--out", out],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert Path(out).exists()
        content = Path(out).read_text()
        assert "# Changelog" in content
