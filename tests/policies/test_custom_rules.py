"""Tests for the P0.3 custom rule types: regex_per_layer, required_meta_keys,
layer_constraint."""

from __future__ import annotations

from datalex_core.policy import policy_issues


def _model(*entities):
    return {"entities": list(entities)}


def _pack(*policies):
    return {
        "pack": {"name": "t", "version": "0.0.1"},
        "policies": list(policies),
    }


def _codes(issues):
    return [i.code for i in issues]


# ---------------------------------------------------------------------------
# regex_per_layer


def test_regex_per_layer_flags_bad_staging_name():
    pack = _pack(
        {
            "id": "naming",
            "type": "regex_per_layer",
            "severity": "warn",
            "params": {"patterns": {"stg": "^stg_[a-z][a-z0-9_]*$"}},
        }
    )
    model = _model(
        {"name": "stg_orders"},          # ok
        {"name": "stg_Orders"},          # bad — capital
        {"name": "fct_revenue"},         # not in pattern map → ignored
    )
    issues = policy_issues(model, pack)
    targets = [i.message for i in issues]
    assert any("stg_Orders" in m for m in targets)
    assert all("stg_orders" not in m for m in targets)
    assert all("fct_revenue" not in m for m in targets)


def test_regex_per_layer_misconfig_raises():
    pack = _pack({"id": "x", "type": "regex_per_layer", "severity": "error", "params": {}})
    issues = policy_issues(_model(), pack)
    assert any(i.code.endswith("MISCONFIGURED") for i in issues)


def test_regex_per_layer_invalid_regex_misconfig():
    pack = _pack(
        {
            "id": "x",
            "type": "regex_per_layer",
            "severity": "warn",
            "params": {"patterns": {"stg": "[unclosed"}},
        }
    )
    issues = policy_issues(_model({"name": "stg_orders"}), pack)
    assert any(i.code.endswith("MISCONFIGURED") for i in issues)


# ---------------------------------------------------------------------------
# required_meta_keys


def test_required_meta_keys_flags_missing():
    pack = _pack(
        {
            "id": "meta_keys",
            "type": "required_meta_keys",
            "severity": "warn",
            "params": {"keys": ["owner", "steward"]},
        }
    )
    model = _model(
        {"name": "fct_x", "meta": {"owner": "data"}},               # missing steward
        {"name": "fct_y", "meta": {"owner": "data", "steward": "a"}},  # ok
        {"name": "fct_z", "meta": {}},                               # missing both
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("fct_x" in m and "steward" in m for m in msgs)
    assert any("fct_z" in m for m in msgs)
    assert all("fct_y" not in m for m in msgs)


def test_required_meta_keys_with_layer_selector():
    pack = _pack(
        {
            "id": "fct_meta",
            "type": "required_meta_keys",
            "severity": "warn",
            "params": {"keys": ["grain"], "selectors": {"layer": "fct"}},
        }
    )
    model = _model(
        {"name": "stg_orders"},  # ignored (different layer)
        {"name": "fct_orders"},  # missing meta.grain → flagged
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("fct_orders" in m for m in msgs)
    assert all("stg_orders" not in m for m in msgs)


# ---------------------------------------------------------------------------
# layer_constraint


def test_layer_constraint_materialization():
    pack = _pack(
        {
            "id": "stg_mat",
            "type": "layer_constraint",
            "severity": "warn",
            "params": {"layers": {"stg": {"materialization": ["view", "ephemeral"]}}},
        }
    )
    model = _model(
        {"name": "stg_a", "materialization": "view"},        # ok
        {"name": "stg_b", "materialization": "table"},       # bad
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("stg_b" in m for m in msgs)
    assert all("stg_a" not in m for m in msgs)


def test_layer_constraint_requires_attribute():
    pack = _pack(
        {
            "id": "fct_grain",
            "type": "layer_constraint",
            "severity": "warn",
            "params": {"layers": {"fct": {"requires": ["grain"]}}},
        }
    )
    model = _model(
        {"name": "fct_a", "grain": "one row per order"},
        {"name": "fct_b"},                                  # missing grain
        {"name": "fct_c", "meta": {"grain": "via meta"}},   # meta.grain also satisfies
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("fct_b" in m for m in msgs)
    assert all("fct_a" not in m for m in msgs)
    assert all("fct_c" not in m for m in msgs)


# ---------------------------------------------------------------------------
# Selector by tag


def test_selector_by_tag():
    pack = _pack(
        {
            "id": "pii_meta",
            "type": "required_meta_keys",
            "severity": "warn",
            "params": {"keys": ["classification"], "selectors": {"tag": "pii"}},
        }
    )
    model = _model(
        {"name": "users", "tags": ["pii"], "meta": {}},
        {"name": "orders", "tags": [], "meta": {}},
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("users" in m for m in msgs)
    assert all("orders" not in m for m in msgs)


# ---------------------------------------------------------------------------
# Existing rules still work end-to-end alongside the new ones


def test_unknown_type_warns():
    pack = _pack({"id": "x", "type": "no_such_rule", "severity": "warn"})
    issues = policy_issues(_model(), pack)
    assert any(i.code.endswith("UNKNOWN_TYPE") for i in issues)


# ---------------------------------------------------------------------------
# P1.D — contracts policies


def test_require_contract_flags_unenforced():
    pack = _pack(
        {
            "id": "fct_contract",
            "type": "require_contract",
            "severity": "warn",
            "params": {"selectors": {"layer": "fct"}},
        }
    )
    model = _model(
        {"name": "fct_a", "contract": {"enforced": True}},
        {"name": "fct_b"},
        {"name": "fct_c", "meta": {"datalex": {"contracts": "enforced"}}},
        {"name": "stg_x"},  # excluded by selector
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("fct_b" in m for m in msgs)
    assert all("fct_a" not in m for m in msgs)
    assert all("fct_c" not in m for m in msgs)
    assert all("stg_x" not in m for m in msgs)


def test_require_data_type_when_contracted():
    pack = _pack(
        {
            "id": "dtype",
            "type": "require_data_type_when_contracted",
            "severity": "warn",
            "params": {},
        }
    )
    model = _model(
        {
            "name": "fct_orders",
            "contract": {"enforced": True},
            "fields": [
                {"name": "id", "data_type": "number"},
                {"name": "amount", "data_type": "unknown"},
                {"name": "status"},
            ],
        },
        {
            "name": "fct_no_contract",
            "fields": [{"name": "x"}],  # not contracted, ignored
        },
    )
    issues = policy_issues(model, pack)
    msgs = [i.message for i in issues]
    assert any("fct_orders" in m and "amount" in m for m in msgs)
    assert any("fct_orders" in m and "status" in m for m in msgs)
    assert all("fct_no_contract" not in m for m in msgs)
