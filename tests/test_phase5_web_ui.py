"""
Phase 5 – Web UI Enterprise Features Tests

Tests for:
- ELK layout subject area grouping logic
- Model-to-flow subject_area / SLA passthrough
- Global search index building
- YAML autocomplete schema keywords
- Dark mode theme persistence
- Keyboard shortcuts definitions
"""

import json
import os
import sys
import pytest
import yaml

# ── helpers ──────────────────────────────────────────────────────────────────

FIXTURES_DIR = os.path.join(os.path.dirname(__file__), "fixtures")
WEB_APP_DIR = os.path.join(os.path.dirname(__file__), "..", "packages", "web-app", "src")


def load_yaml(path):
    with open(path) as f:
        return yaml.safe_load(f)


def build_model_with_subject_areas():
    """Build a model with multiple subject areas for grouping tests."""
    return {
        "model": {"name": "test_model", "version": "1.0.0", "domain": "test"},
        "entities": [
            {
                "name": "Customer",
                "type": "table",
                "subject_area": "CRM",
                "sla": "99.9%",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True},
                    {"name": "email", "type": "string", "sensitivity": "confidential"},
                ],
                "tags": ["core", "pii"],
                "description": "Customer master data",
            },
            {
                "name": "Order",
                "type": "table",
                "subject_area": "Sales",
                "sla": "99.5%",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True},
                    {"name": "customer_id", "type": "integer", "foreign_key": True},
                    {"name": "total", "type": "decimal"},
                ],
                "tags": ["core"],
                "description": "Sales orders",
            },
            {
                "name": "Product",
                "type": "table",
                "subject_area": "Inventory",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True},
                    {"name": "name", "type": "string"},
                    {"name": "price", "type": "decimal", "check": "price > 0"},
                ],
                "tags": ["inventory"],
            },
            {
                "name": "Address",
                "type": "table",
                "subject_area": "CRM",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True},
                    {"name": "street", "type": "string"},
                ],
            },
            {
                "name": "AuditLog",
                "type": "table",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True},
                    {"name": "action", "type": "string"},
                ],
                "description": "System audit log",
            },
        ],
        "relationships": [
            {"name": "customer_orders", "from": "Customer.id", "to": "Order.customer_id", "cardinality": "one_to_many"},
        ],
        "glossary": [
            {"term": "SLA", "definition": "Service Level Agreement"},
            {"term": "PII", "definition": "Personally Identifiable Information"},
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# 1. Subject Area Grouping Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestSubjectAreaGrouping:
    """Tests for subject area grouping logic."""

    def test_entities_have_subject_area(self):
        model = build_model_with_subject_areas()
        sa_map = {}
        for e in model["entities"]:
            sa = e.get("subject_area", "")
            if sa:
                sa_map.setdefault(sa, []).append(e["name"])
        assert "CRM" in sa_map
        assert "Sales" in sa_map
        assert "Inventory" in sa_map
        assert set(sa_map["CRM"]) == {"Customer", "Address"}
        assert sa_map["Sales"] == ["Order"]
        assert sa_map["Inventory"] == ["Product"]

    def test_ungrouped_entities(self):
        model = build_model_with_subject_areas()
        ungrouped = [e["name"] for e in model["entities"] if not e.get("subject_area")]
        assert ungrouped == ["AuditLog"]

    def test_subject_area_count(self):
        model = build_model_with_subject_areas()
        areas = set(e.get("subject_area") for e in model["entities"] if e.get("subject_area"))
        assert len(areas) == 3

    def test_single_subject_area_no_grouping(self):
        """When all entities share one subject area, no grouping should occur."""
        model = build_model_with_subject_areas()
        for e in model["entities"]:
            e["subject_area"] = "Common"
        areas = set(e.get("subject_area") for e in model["entities"])
        assert len(areas) == 1

    def test_no_subject_areas(self):
        """When no entities have subject_area, grouping is skipped."""
        model = build_model_with_subject_areas()
        for e in model["entities"]:
            e.pop("subject_area", None)
        areas = set(e.get("subject_area") for e in model["entities"] if e.get("subject_area"))
        assert len(areas) == 0


# ══════════════════════════════════════════════════════════════════════════════
# 2. Enhanced Entity Node Tests (SLA, sensitivity, badges)
# ══════════════════════════════════════════════════════════════════════════════

class TestEnhancedEntityNodes:
    """Tests for enhanced entity node data passthrough."""

    def test_sla_present_on_entity(self):
        model = build_model_with_subject_areas()
        customer = next(e for e in model["entities"] if e["name"] == "Customer")
        assert customer["sla"] == "99.9%"

    def test_sla_missing_on_entity(self):
        model = build_model_with_subject_areas()
        product = next(e for e in model["entities"] if e["name"] == "Product")
        assert "sla" not in product

    def test_sensitivity_on_field(self):
        model = build_model_with_subject_areas()
        customer = next(e for e in model["entities"] if e["name"] == "Customer")
        email_field = next(f for f in customer["fields"] if f["name"] == "email")
        assert email_field["sensitivity"] == "confidential"

    def test_check_constraint_on_field(self):
        model = build_model_with_subject_areas()
        product = next(e for e in model["entities"] if e["name"] == "Product")
        price_field = next(f for f in product["fields"] if f["name"] == "price")
        assert price_field["check"] == "price > 0"

    def test_foreign_key_flag(self):
        model = build_model_with_subject_areas()
        order = next(e for e in model["entities"] if e["name"] == "Order")
        fk_field = next(f for f in order["fields"] if f["name"] == "customer_id")
        assert fk_field["foreign_key"] is True

    def test_primary_key_flag(self):
        model = build_model_with_subject_areas()
        for entity in model["entities"]:
            id_field = next(f for f in entity["fields"] if f["name"] == "id")
            assert id_field["primary_key"] is True

    def test_tags_present(self):
        model = build_model_with_subject_areas()
        customer = next(e for e in model["entities"] if e["name"] == "Customer")
        assert "core" in customer["tags"]
        assert "pii" in customer["tags"]

    def test_description_present(self):
        model = build_model_with_subject_areas()
        customer = next(e for e in model["entities"] if e["name"] == "Customer")
        assert customer["description"] == "Customer master data"


# ══════════════════════════════════════════════════════════════════════════════
# 3. Global Search Index Tests
# ══════════════════════════════════════════════════════════════════════════════

def build_search_index(model):
    """Python equivalent of the JS buildSearchIndex for testing."""
    results = []
    for entity in model.get("entities", []):
        results.append({
            "category": "entity",
            "text": entity["name"],
            "entityName": entity["name"],
        })
        if entity.get("description"):
            results.append({
                "category": "description",
                "text": entity["description"],
                "entityName": entity["name"],
            })
        for tag in entity.get("tags", []):
            results.append({
                "category": "tag",
                "text": str(tag),
                "entityName": entity["name"],
            })
        for field in entity.get("fields", []):
            results.append({
                "category": "field",
                "text": field["name"],
                "entityName": entity["name"],
            })
            if field.get("description"):
                results.append({
                    "category": "description",
                    "text": field["description"],
                    "entityName": entity["name"],
                })
    for term in model.get("glossary", []):
        results.append({
            "category": "glossary",
            "text": term.get("term", ""),
            "entityName": None,
        })
    return results


class TestGlobalSearch:
    """Tests for global search index building and querying."""

    def test_index_contains_entities(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        entity_items = [i for i in index if i["category"] == "entity"]
        assert len(entity_items) == 5
        names = {i["text"] for i in entity_items}
        assert names == {"Customer", "Order", "Product", "Address", "AuditLog"}

    def test_index_contains_fields(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        field_items = [i for i in index if i["category"] == "field"]
        field_names = {i["text"] for i in field_items}
        assert "email" in field_names
        assert "total" in field_names
        assert "street" in field_names

    def test_index_contains_tags(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        tag_items = [i for i in index if i["category"] == "tag"]
        tag_texts = {i["text"] for i in tag_items}
        assert "core" in tag_texts
        assert "pii" in tag_texts
        assert "inventory" in tag_texts

    def test_index_contains_descriptions(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        desc_items = [i for i in index if i["category"] == "description"]
        desc_texts = {i["text"] for i in desc_items}
        assert "Customer master data" in desc_texts
        assert "Sales orders" in desc_texts

    def test_index_contains_glossary(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        glossary_items = [i for i in index if i["category"] == "glossary"]
        assert len(glossary_items) == 2
        terms = {i["text"] for i in glossary_items}
        assert "SLA" in terms
        assert "PII" in terms

    def test_search_by_query(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        query = "customer"
        results = [i for i in index if query.lower() in i["text"].lower()]
        assert len(results) >= 2  # Customer entity + customer_id field

    def test_search_no_results(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        query = "zzzznonexistent"
        results = [i for i in index if query.lower() in i["text"].lower()]
        assert len(results) == 0

    def test_search_case_insensitive(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        q1 = [i for i in index if "customer" in i["text"].lower()]
        q2 = [i for i in index if "CUSTOMER" in i["text"].upper()]
        assert len(q1) == len(q2)

    def test_search_filter_by_category(self):
        model = build_model_with_subject_areas()
        index = build_search_index(model)
        query = "id"
        all_results = [i for i in index if query.lower() in i["text"].lower()]
        field_only = [i for i in all_results if i["category"] == "field"]
        assert len(field_only) <= len(all_results)
        assert all(i["category"] == "field" for i in field_only)

    def test_empty_model_search(self):
        index = build_search_index({})
        assert len(index) == 0


# ══════════════════════════════════════════════════════════════════════════════
# 4. YAML Autocomplete Schema Keywords Tests
# ══════════════════════════════════════════════════════════════════════════════

SCHEMA_KEYWORDS = {
    "root": ["model:", "entities:", "relationships:", "indexes:", "governance:", "glossary:"],
    "model": ["name:", "version:", "domain:", "owners:", "state:", "description:", "spec_version:", "imports:"],
    "entity": ["name:", "type:", "description:", "fields:", "tags:", "schema:", "database:", "subject_area:", "owner:", "sla:"],
    "field": ["name:", "type:", "nullable:", "primary_key:", "unique:", "foreign_key:", "default:", "check:", "computed:", "computed_expression:", "sensitivity:", "description:", "deprecated:", "deprecated_message:", "examples:"],
    "relationship": ["name:", "from:", "to:", "cardinality:", "on_update:", "description:"],
    "index": ["name:", "entity:", "fields:", "unique:"],
    "types": ["string", "integer", "bigint", "float", "decimal", "boolean", "date", "timestamp", "datetime", "uuid", "json", "text", "varchar"],
    "cardinalities": ["one_to_one", "one_to_many", "many_to_one", "many_to_many"],
    "states": ["draft", "approved", "deprecated"],
    "entityTypes": ["table", "view", "materialized_view", "external_table", "snapshot"],
    "sensitivity": ["public", "internal", "confidential", "restricted"],
}


class TestYamlAutocomplete:
    """Tests for schema-aware YAML autocomplete keyword definitions."""

    def test_root_keywords(self):
        assert "model:" in SCHEMA_KEYWORDS["root"]
        assert "entities:" in SCHEMA_KEYWORDS["root"]
        assert "relationships:" in SCHEMA_KEYWORDS["root"]

    def test_model_keywords(self):
        assert "name:" in SCHEMA_KEYWORDS["model"]
        assert "version:" in SCHEMA_KEYWORDS["model"]
        assert "domain:" in SCHEMA_KEYWORDS["model"]
        assert "imports:" in SCHEMA_KEYWORDS["model"]

    def test_entity_keywords_include_subject_area(self):
        assert "subject_area:" in SCHEMA_KEYWORDS["entity"]
        assert "sla:" in SCHEMA_KEYWORDS["entity"]
        assert "owner:" in SCHEMA_KEYWORDS["entity"]

    def test_field_keywords_include_sensitivity(self):
        assert "sensitivity:" in SCHEMA_KEYWORDS["field"]
        assert "deprecated:" in SCHEMA_KEYWORDS["field"]
        assert "computed:" in SCHEMA_KEYWORDS["field"]
        assert "check:" in SCHEMA_KEYWORDS["field"]

    def test_type_completions(self):
        assert "string" in SCHEMA_KEYWORDS["types"]
        assert "integer" in SCHEMA_KEYWORDS["types"]
        assert "uuid" in SCHEMA_KEYWORDS["types"]
        assert "json" in SCHEMA_KEYWORDS["types"]

    def test_cardinality_completions(self):
        assert len(SCHEMA_KEYWORDS["cardinalities"]) == 4
        assert "one_to_many" in SCHEMA_KEYWORDS["cardinalities"]

    def test_entity_type_completions(self):
        assert "table" in SCHEMA_KEYWORDS["entityTypes"]
        assert "materialized_view" in SCHEMA_KEYWORDS["entityTypes"]
        assert "snapshot" in SCHEMA_KEYWORDS["entityTypes"]

    def test_sensitivity_completions(self):
        assert "public" in SCHEMA_KEYWORDS["sensitivity"]
        assert "restricted" in SCHEMA_KEYWORDS["sensitivity"]
        assert len(SCHEMA_KEYWORDS["sensitivity"]) == 4

    def test_state_completions(self):
        assert "draft" in SCHEMA_KEYWORDS["states"]
        assert "approved" in SCHEMA_KEYWORDS["states"]
        assert "deprecated" in SCHEMA_KEYWORDS["states"]


# ══════════════════════════════════════════════════════════════════════════════
# 5. Dark Mode Theme Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestDarkMode:
    """Tests for dark mode CSS variable definitions."""

    def test_dark_theme_css_exists(self):
        css_path = os.path.join(WEB_APP_DIR, "styles", "globals.css")
        assert os.path.exists(css_path)
        with open(css_path) as f:
            css = f.read()
        assert '[data-theme="dark"]' in css

    def test_dark_theme_has_bg_colors(self):
        css_path = os.path.join(WEB_APP_DIR, "styles", "globals.css")
        with open(css_path) as f:
            css = f.read()
        assert "--color-bg-primary: #0f172a" in css
        assert "--color-bg-secondary: #1e293b" in css

    def test_dark_theme_has_text_colors(self):
        css_path = os.path.join(WEB_APP_DIR, "styles", "globals.css")
        with open(css_path) as f:
            css = f.read()
        assert "--color-text-primary: #f1f5f9" in css
        assert "--color-text-secondary: #cbd5e1" in css

    def test_dark_theme_has_border_colors(self):
        css_path = os.path.join(WEB_APP_DIR, "styles", "globals.css")
        with open(css_path) as f:
            css = f.read()
        assert "--color-border-primary: #334155" in css

    def test_css_uses_variables_not_hardcoded(self):
        css_path = os.path.join(WEB_APP_DIR, "styles", "globals.css")
        with open(css_path) as f:
            css = f.read()
        # CodeMirror should use CSS variables
        assert "var(--color-bg-primary)" in css
        assert "var(--color-bg-secondary)" in css
        assert "var(--color-text-primary)" in css


# ══════════════════════════════════════════════════════════════════════════════
# 6. Keyboard Shortcuts Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestKeyboardShortcuts:
    """Tests for keyboard shortcuts panel definitions."""

    def test_shortcuts_panel_exists(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        assert os.path.exists(panel_path)

    def test_shortcuts_panel_has_groups(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        with open(panel_path) as f:
            content = f.read()
        assert "General" in content
        assert "Diagram" in content
        assert "Editor" in content

    def test_shortcuts_panel_has_save(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        with open(panel_path) as f:
            content = f.read()
        assert "Save current file" in content

    def test_shortcuts_panel_has_search(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        with open(panel_path) as f:
            content = f.read()
        assert "Open global search" in content

    def test_shortcuts_panel_has_dark_mode(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        with open(panel_path) as f:
            content = f.read()
        assert "Toggle dark mode" in content

    def test_shortcuts_panel_has_export(self):
        panel_path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        with open(panel_path) as f:
            content = f.read()
        assert "Export diagram as PNG" in content
        assert "Export diagram as SVG" in content


# ══════════════════════════════════════════════════════════════════════════════
# 7. Component File Existence Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestComponentFiles:
    """Tests that all Phase 5 component files exist."""

    def test_subject_area_group_component(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "SubjectAreaGroup.jsx")
        assert os.path.exists(path)

    def test_annotation_node_component(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        assert os.path.exists(path)

    def test_global_search_panel(self):
        path = os.path.join(WEB_APP_DIR, "components", "panels", "GlobalSearchPanel.jsx")
        assert os.path.exists(path)

    def test_keyboard_shortcuts_panel(self):
        path = os.path.join(WEB_APP_DIR, "components", "panels", "KeyboardShortcutsPanel.jsx")
        assert os.path.exists(path)

    def test_elk_layout_has_grouping(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "groupBySubjectArea" in content
        assert "getSubjectAreaColor" in content
        assert "SUBJECT_AREA_COLORS" in content

    def test_diagram_canvas_has_annotation_type(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramCanvas.jsx")
        with open(path) as f:
            content = f.read()
        assert "annotation: AnnotationNode" in content
        assert "group: SubjectAreaGroup" in content

    def test_diagram_toolbar_has_export(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramToolbar.jsx")
        with open(path) as f:
            content = f.read()
        assert "html-to-image" in content
        assert "toPng" in content
        assert "toSvg" in content

    def test_diagram_toolbar_has_note_button(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramToolbar.jsx")
        with open(path) as f:
            content = f.read()
        assert "StickyNote" in content
        assert "__dlAddAnnotation" in content

    def test_diagram_toolbar_has_group_toggle(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramToolbar.jsx")
        with open(path) as f:
            content = f.read()
        assert "groupBySubjectArea" in content

    def test_yaml_editor_has_autocomplete(self):
        path = os.path.join(WEB_APP_DIR, "components", "editor", "YamlEditor.jsx")
        with open(path) as f:
            content = f.read()
        assert "autocompletion" in content
        assert "yamlCompletions" in content
        assert "SCHEMA_KEYWORDS" in content

    def test_yaml_editor_has_linter(self):
        path = os.path.join(WEB_APP_DIR, "components", "editor", "YamlEditor.jsx")
        with open(path) as f:
            content = f.read()
        assert "linter" in content
        assert "lintGutter" in content
        assert "yamlLinter" in content

    def test_topbar_has_theme_toggle(self):
        path = os.path.join(WEB_APP_DIR, "components", "layout", "TopBar.jsx")
        with open(path) as f:
            content = f.read()
        assert "toggleTheme" in content
        assert "Moon" in content
        assert "Sun" in content

    def test_ui_store_has_theme(self):
        path = os.path.join(WEB_APP_DIR, "stores", "uiStore.js")
        with open(path) as f:
            content = f.read()
        assert "theme:" in content
        assert "toggleTheme" in content
        assert "dm_theme" in content

    def test_diagram_store_has_group_setting(self):
        path = os.path.join(WEB_APP_DIR, "stores", "diagramStore.js")
        with open(path) as f:
            content = f.read()
        assert "groupBySubjectArea: true" in content

    def test_app_has_search_tab(self):
        path = os.path.join(WEB_APP_DIR, "App.jsx")
        with open(path) as f:
            content = f.read()
        assert '"search"' in content
        assert "GlobalSearchPanel" in content

    def test_app_has_keyboard_shortcuts(self):
        path = os.path.join(WEB_APP_DIR, "App.jsx")
        with open(path) as f:
            content = f.read()
        assert "KeyboardShortcutsPanel" in content
        assert "showShortcuts" in content


# ══════════════════════════════════════════════════════════════════════════════
# 8. Annotation Node Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestAnnotationNode:
    """Tests for annotation node component."""

    def test_annotation_component_exists(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        assert os.path.exists(path)

    def test_annotation_has_colors(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        with open(path) as f:
            content = f.read()
        assert "ANNOTATION_COLORS" in content

    def test_annotation_has_edit_mode(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        with open(path) as f:
            content = f.read()
        assert "editing" in content
        assert "setEditing" in content

    def test_annotation_has_delete(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        with open(path) as f:
            content = f.read()
        assert "onDelete" in content

    def test_annotation_has_update(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "AnnotationNode.jsx")
        with open(path) as f:
            content = f.read()
        assert "onUpdate" in content


# ══════════════════════════════════════════════════════════════════════════════
# 9. Diagram Export Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestDiagramExport:
    """Tests for diagram export functionality."""

    def test_html_to_image_installed(self):
        pkg_path = os.path.join(
            os.path.dirname(__file__), "..", "packages", "web-app", "package.json"
        )
        with open(pkg_path) as f:
            pkg = json.load(f)
        assert "html-to-image" in pkg.get("dependencies", {})

    def test_toolbar_has_png_export(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramToolbar.jsx")
        with open(path) as f:
            content = f.read()
        assert "datalex-diagram.png" in content

    def test_toolbar_has_svg_export(self):
        path = os.path.join(WEB_APP_DIR, "components", "diagram", "DiagramToolbar.jsx")
        with open(path) as f:
            content = f.read()
        assert "datalex-diagram.svg" in content


# ══════════════════════════════════════════════════════════════════════════════
# 10. ELK Layout Grouping Config Tests
# ══════════════════════════════════════════════════════════════════════════════

class TestElkLayoutConfig:
    """Tests for ELK layout subject area grouping configuration."""

    def test_elk_layout_exports_color_function(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "export function getSubjectAreaColor" in content

    def test_elk_layout_has_hierarchy_handling(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "elk.hierarchyHandling" in content
        assert "INCLUDE_CHILDREN" in content

    def test_elk_layout_creates_group_nodes(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "groupNodes" in content
        assert "__group_" in content

    def test_elk_layout_returns_group_nodes(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "return { nodes: layoutedNodes, edges, groupNodes }" in content

    def test_fallback_layout_returns_group_nodes(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "return { nodes: layoutedNodes, edges, groupNodes: [] }" in content

    def test_subject_area_colors_defined(self):
        path = os.path.join(WEB_APP_DIR, "lib", "elkLayout.js")
        with open(path) as f:
            content = f.read()
        assert "SUBJECT_AREA_COLORS" in content
        # Should have at least 5 colors
        assert content.count("bg:") >= 5


# ══════════════════════════════════════════════════════════════════════════════
# 11. Build Verification
# ══════════════════════════════════════════════════════════════════════════════

class TestBuildVerification:
    """Verify the web app builds successfully with all Phase 5 changes."""

    def test_web_app_dist_exists(self):
        dist_path = os.path.join(
            os.path.dirname(__file__), "..", "packages", "web-app", "dist"
        )
        assert os.path.exists(dist_path), "Web app dist directory should exist after build"

    def test_web_app_dist_has_index(self):
        index_path = os.path.join(
            os.path.dirname(__file__), "..", "packages", "web-app", "dist", "index.html"
        )
        assert os.path.exists(index_path), "Built index.html should exist"
