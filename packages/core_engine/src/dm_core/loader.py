from pathlib import Path
from typing import Any, Dict

import yaml


def load_yaml_model(path: str) -> Dict[str, Any]:
    model_path = Path(path)
    if not model_path.exists():
        raise FileNotFoundError(f"Model file not found: {path}")

    with model_path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)

    if data is None:
        return {}

    if not isinstance(data, dict):
        raise ValueError("Model YAML must parse to an object/map at root.")

    return data
