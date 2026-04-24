"""DataLexProject — the loaded, validated graph.

Holds every kind in its own dict keyed by a stable ID (entity keys are
`<layer>:<name>` because the same logical name can appear at each of the three
layers). Provides convenience lookups and a `resolve()` pass that:
  * Inlines snippet `use:` directives on columns.
  * Validates `logical:` back-references from physical to logical entities.
  * Flags dangling term/entity/source/model references.

Kept as a thin orchestration layer over the dict-of-dict representation — dialect
plugins and diff engine operate on dicts directly, so the Python object is a
convenience, not a requirement.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from datalex_core.datalex.errors import DataLexError, DataLexErrorBag, SourceLocation


@dataclass
class DataLexProject:
    root: Path
    manifest: Optional[Dict[str, Any]]
    entities: Dict[str, Dict[str, Any]]
    sources: Dict[str, Dict[str, Any]]
    models: Dict[str, Dict[str, Any]]
    terms: Dict[str, Dict[str, Any]]
    domains: Dict[str, Dict[str, Any]]
    policies: Dict[str, Dict[str, Any]]
    snippets: Dict[str, Dict[str, Any]]
    diagrams: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    relationships: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    data_types: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    semantic_models: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    file_of: Dict[Tuple[str, str], str] = field(default_factory=dict)
    errors: DataLexErrorBag = field(default_factory=DataLexErrorBag)
    # Phase C: imported packages. Each key is the package's alias; value is a
    # loaded sub-project. Sub-projects are validated independently.
    imports: Dict[str, "DataLexProject"] = field(default_factory=dict)

    # ---------- lookups ----------

    def entity(self, name: str, layer: str = "physical") -> Optional[Dict[str, Any]]:
        return self.entities.get(f"{layer}:{name}")

    def imported_entity(
        self, alias: str, name: str, layer: str = "physical"
    ) -> Optional[Dict[str, Any]]:
        """Look up an entity inside an imported package by alias."""
        sub = self.imports.get(alias)
        if sub is None:
            return None
        return sub.entity(name, layer=layer)

    def resolve_cross_package(
        self, reference: str, layer: str = "physical"
    ) -> Optional[Dict[str, Any]]:
        """Resolve `@alias.entity_name` style references against imported packages.

        Plain names without `@alias.` fall back to local entities so callers can
        use a single lookup path.
        """
        if reference.startswith("@"):
            try:
                alias, name = reference[1:].split(".", 1)
            except ValueError:
                return None
            return self.imported_entity(alias, name, layer=layer)
        return self.entity(reference, layer=layer)

    def iter_entities(self, layer: Optional[str] = None) -> Iterable[Dict[str, Any]]:
        for key, ent in sorted(self.entities.items()):
            if layer is None or key.startswith(f"{layer}:"):
                yield ent

    def physical_entities(self, dialect: Optional[str] = None) -> List[Dict[str, Any]]:
        out = []
        for ent in self.iter_entities(layer="physical"):
            if dialect is None or ent.get("dialect") == dialect:
                out.append(ent)
        return out

    # ---------- resolution ----------

    def resolve(self) -> None:
        """Run post-load resolution: snippet expansion, back-reference checks."""
        self._expand_snippets()
        self._check_logical_backrefs()
        self._check_term_refs()
        self._check_reference_targets()
        self._check_model_relationships()
        self._check_type_mappings()
        self._check_semantic_model_refs()

    def _expand_snippets(self) -> None:
        """Inline `use: <snippet>` on columns with snippet.apply content.

        Merge semantics: column keys win over snippet keys. Snippet fields fill in
        missing keys only. This is conservative — users opt in explicitly.
        """
        for ent in self.entities.values():
            for col in ent.get("columns", []) or []:
                snippet_name = col.pop("use", None)
                if not snippet_name:
                    continue
                snip = self.snippets.get(snippet_name)
                if snip is None:
                    self.errors.add(
                        DataLexError(
                            code="SNIPPET_NOT_FOUND",
                            message=f"Column '{col.get('name')}' uses unknown snippet '{snippet_name}'",
                            location=self._loc_for("entity", ent),
                            suggested_fix=f"Create .datalex/snippets/{snippet_name}.yaml or remove the use: directive.",
                        )
                    )
                    continue
                apply = snip.get("apply", {}) or {}
                for k, v in apply.items():
                    if k not in col:
                        col[k] = v

    def _check_logical_backrefs(self) -> None:
        for key, ent in self.entities.items():
            if not key.startswith("physical:"):
                continue
            logical_name = ent.get("logical")
            if not logical_name:
                continue
            if f"logical:{logical_name}" not in self.entities:
                self.errors.add(
                    DataLexError(
                        code="LOGICAL_BACKREF",
                        severity="warn",
                        message=f"Physical entity '{ent.get('name')}' references logical '{logical_name}' which does not exist.",
                        location=self._loc_for("entity", ent),
                        suggested_fix=f"Create models/logical/{logical_name}.yaml or remove the logical: reference.",
                    )
                )

    def _check_term_refs(self) -> None:
        term_names = set(self.terms.keys())
        for ent in self.entities.values():
            for t in ent.get("terms", []) or []:
                name = t.split(":", 1)[1] if t.startswith("term:") else t
                if name not in term_names:
                    self.errors.add(
                        DataLexError(
                            code="TERM_NOT_FOUND",
                            severity="warn",
                            message=f"Entity '{ent.get('name')}' references unknown term '{name}'",
                            location=self._loc_for("entity", ent),
                            suggested_fix=f"Create glossary/{name}.yaml or remove the term reference.",
                        )
                    )
            for col in ent.get("columns", []) or []:
                for t in col.get("terms", []) or []:
                    name = t.split(":", 1)[1] if t.startswith("term:") else t
                    if name not in term_names:
                        self.errors.add(
                            DataLexError(
                                code="TERM_NOT_FOUND",
                                severity="warn",
                                message=f"Column '{ent.get('name')}.{col.get('name')}' references unknown term '{name}'",
                                location=self._loc_for("entity", ent),
                            )
                        )

    def _check_reference_targets(self) -> None:
        for ent in self.entities.values():
            for col in ent.get("columns", []) or []:
                ref = col.get("references")
                if not ref:
                    continue
                target_entity_name = ref.get("entity")
                layer = ent.get("layer", "physical")
                if not target_entity_name:
                    continue
                if f"{layer}:{target_entity_name}" not in self.entities:
                    self.errors.add(
                        DataLexError(
                            code="REF_TARGET_MISSING",
                            message=f"Column '{ent.get('name')}.{col.get('name')}' references missing entity '{target_entity_name}' at layer '{layer}'",
                            location=self._loc_for("entity", ent),
                            suggested_fix="Check the target entity name and layer.",
                        )
                    )

    def _check_model_relationships(self) -> None:
        for rel in self.relationships.values():
            layer = rel.get("layer", "physical")
            for side in ("from", "to"):
                endpoint = rel.get(side) or {}
                if not isinstance(endpoint, dict):
                    continue
                entity_name = endpoint.get("entity")
                column_name = endpoint.get("column")
                if not entity_name:
                    continue
                ent = self.entities.get(f"{layer}:{entity_name}")
                if ent is None:
                    self.errors.add(
                        DataLexError(
                            code="REL_TARGET_MISSING",
                            message=f"Relationship '{rel.get('name')}' references missing {side} entity '{entity_name}' at layer '{layer}'",
                            location=self._loc_for("relationship", rel),
                            suggested_fix="Create the referenced entity at the same layer or update the relationship endpoint.",
                        )
                    )
                    continue
                if column_name and layer != "conceptual":
                    columns = {c.get("name") for c in ent.get("columns", []) or []}
                    if column_name not in columns:
                        self.errors.add(
                            DataLexError(
                                code="REL_COLUMN_MISSING",
                                message=f"Relationship '{rel.get('name')}' references missing {side} column '{entity_name}.{column_name}'",
                                location=self._loc_for("relationship", rel),
                                suggested_fix="Choose an existing column or remove the column-level endpoint.",
                            )
                        )

    def _check_type_mappings(self) -> None:
        manifest_dialects = set((self.manifest or {}).get("dialects") or [])
        default_dialect = (self.manifest or {}).get("default_dialect")
        if default_dialect:
            manifest_dialects.add(default_dialect)
        if not manifest_dialects:
            return
        for type_name, data_type in self.data_types.items():
            physical = data_type.get("physical") or {}
            missing = sorted(d for d in manifest_dialects if d not in physical)
            if missing:
                self.errors.add(
                    DataLexError(
                        code="DATA_TYPE_MAPPING_MISSING",
                        severity="warn",
                        message=f"Logical data type '{type_name}' has no physical mapping for: {', '.join(missing)}",
                        location=self._loc_for("data_type", data_type),
                        suggested_fix="Add physical mappings for every enabled dialect or remove unused dialects from datalex.yaml.",
                    )
                )

    def _check_semantic_model_refs(self) -> None:
        entity_names = {ent.get("name") for ent in self.entities.values()}
        model_names = set(self.models.keys())
        for semantic_model in self.semantic_models.values():
            ref = semantic_model.get("entity")
            if not ref:
                continue
            if ref not in entity_names and ref not in model_names:
                self.errors.add(
                    DataLexError(
                        code="SEMANTIC_ENTITY_MISSING",
                        severity="warn",
                        message=f"Semantic model '{semantic_model.get('name')}' references missing entity/model '{ref}'",
                        location=self._loc_for("semantic_model", semantic_model),
                        suggested_fix="Point entity: at a loaded DataLex entity or dbt model.",
                    )
                )

    def _loc_for(self, kind: str, obj: Dict[str, Any]) -> SourceLocation:
        name = obj.get("name", "")
        layer = obj.get("layer", "physical") if kind == "entity" else ""
        key = f"{layer}:{name}" if kind == "entity" else name
        path = self.file_of.get((kind, key), str(self.root))
        return SourceLocation(file=path)

    def to_dict(self) -> Dict[str, Any]:
        """Return a plain dict suitable for JSON serialization."""
        return {
            "root": str(self.root),
            "manifest": self.manifest,
            "entities": self.entities,
            "sources": self.sources,
            "models": self.models,
            "terms": self.terms,
            "domains": self.domains,
            "policies": self.policies,
            "snippets": self.snippets,
            "diagrams": self.diagrams,
            "relationships": self.relationships,
            "data_types": self.data_types,
            "semantic_models": self.semantic_models,
            "imports": {
                alias: {
                    "root": str(sub.root),
                    "entities": sorted(sub.entities.keys()),
                    "terms": sorted(sub.terms.keys()),
                }
                for alias, sub in self.imports.items()
            },
            "errors": self.errors.to_list(),
        }
