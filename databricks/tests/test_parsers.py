"""Run with: pytest databricks/tests/ -v"""
from databricks.lib.parsers import (
    coerce_int, is_urban, normalize_state, parse_string_array,
)


def test_parse_string_array_handles_null_sentinels():
    assert parse_string_array("null") == []
    assert parse_string_array("[]") == []
    assert parse_string_array("") == []
    assert parse_string_array(None) == []


def test_parse_string_array_handles_valid_json():
    assert parse_string_array('["a", "b"]') == ["a", "b"]
    assert parse_string_array('["familyMedicine"]') == ["familyMedicine"]


def test_parse_string_array_handles_malformed():
    assert parse_string_array("not json") == []
    assert parse_string_array('{"not": "array"}') == []


def test_normalize_state_canonical():
    assert normalize_state("Bihar") == "Bihar"
    assert normalize_state("Maharashtra") == "Maharashtra"


def test_normalize_state_null():
    assert normalize_state("null") is None
    assert normalize_state("") is None
    assert normalize_state(None) is None


def test_is_urban_known_city():
    assert is_urban("Mumbai") is True
    assert is_urban("Hyderabad") is True


def test_is_urban_unknown_city():
    assert is_urban("Some Village") is False
    assert is_urban("null") is False
    assert is_urban(None) is False


def test_coerce_int():
    assert coerce_int("5") == 5
    assert coerce_int("null") is None
    assert coerce_int("") is None
    assert coerce_int(None) is None
    assert coerce_int("not a number") is None
