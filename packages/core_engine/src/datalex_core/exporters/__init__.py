"""Catalog exporters for glossary <-> column bindings (P1.E).

Each exporter takes a compiled DataLex model and returns a structured
payload an external catalog can ingest. Use the registry in
`available_targets()` to enumerate supported targets.
"""

from .atlan import export_atlan
from .datahub import export_datahub
from .openmetadata import export_openmetadata


_EXPORTERS = {
    "atlan": export_atlan,
    "datahub": export_datahub,
    "openmetadata": export_openmetadata,
}


def available_targets():
    return sorted(_EXPORTERS.keys())


def export_catalog(target: str, model: dict) -> dict:
    target = (target or "").strip().lower()
    if target not in _EXPORTERS:
        raise ValueError(f"Unsupported catalog target: {target}. Choose from {available_targets()}.")
    return _EXPORTERS[target](model)


__all__ = ["available_targets", "export_catalog", "export_atlan", "export_datahub", "export_openmetadata"]
