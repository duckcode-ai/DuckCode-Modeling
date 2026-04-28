"""Programmatic agents that operate above the SQL line.

P2.1 — Conceptualizer: proposes entities & relationships from staging.
P2.2 — Canonicalizer: lifts shared columns into a logical canonical layer
       with doc-block references.

Both agents are deterministic by default; an LLM call is optional and
layered on top. The deterministic baseline gives DataLex a useful
"propose conceptual model from this dbt repo" capability with no API
keys configured, and gives the LLM a starting point when one is.
"""

from .conceptualizer import (
    ConceptualizerProposal,
    propose_conceptual_model,
)
from .canonicalizer import (
    CanonicalizerProposal,
    propose_canonical_layer,
)

__all__ = [
    "ConceptualizerProposal",
    "propose_conceptual_model",
    "CanonicalizerProposal",
    "propose_canonical_layer",
]
