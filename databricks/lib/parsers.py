"""Pure functions to parse and normalize CSV rows. Tested in isolation."""
from __future__ import annotations

import json
from typing import Any

# Indian states/UTs canonical spellings (as appear in dataset, mostly clean).
KNOWN_STATES = {
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
    "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
    "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
    "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
}

# Top 30 cities — used for the heuristic urban classifier in the thin slice.
# Proper district-level mapping comes in a later phase.
URBAN_CITIES = {
    "Mumbai", "Delhi", "Bengaluru", "Bangalore", "Hyderabad", "Ahmedabad",
    "Chennai", "Kolkata", "Surat", "Pune", "Jaipur", "Lucknow", "Kanpur",
    "Nagpur", "Indore", "Thane", "Bhopal", "Visakhapatnam", "Pimpri-Chinchwad",
    "Patna", "Vadodara", "Ghaziabad", "Ludhiana", "Agra", "Nashik",
    "Faridabad", "Meerut", "Rajkot", "Kalyan-Dombivli", "Vasai-Virar",
    "Varanasi", "Srinagar", "Aurangabad", "Dhanbad", "Amritsar", "Navi Mumbai",
    "Allahabad", "Prayagraj", "Ranchi", "Howrah", "Coimbatore", "Jabalpur",
    "Gwalior", "Vijayawada", "Jodhpur", "Madurai", "Raipur", "Kota", "Guwahati",
    "New Delhi",
}


def parse_string_array(raw: Any) -> list[str]:
    """Parse a stringified JSON array to a Python list. Handles 'null', '[]', empty."""
    if raw is None or raw == "" or raw == "null" or raw == "[]":
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def normalize_state(raw: Any) -> str | None:
    """Return canonical state spelling, or None if unrecognized."""
    if raw is None or raw == "" or raw == "null":
        return None
    s = str(raw).strip()
    if s in KNOWN_STATES:
        return s
    # Common variants
    variants = {
        "Bangalore Urban": "Karnataka",
        "Bangalore": "Karnataka",
    }
    return variants.get(s, s)  # pass through if unknown but non-empty


def is_urban(city: Any) -> bool:
    """Heuristic: facility is urban if its city is in the top-30 list. Else rural."""
    if city is None or city == "" or city == "null":
        return False
    return str(city).strip() in URBAN_CITIES


def coerce_int(raw: Any) -> int | None:
    """Parse 'null'/empty/non-numeric to None, else int."""
    if raw is None or raw == "" or raw == "null":
        return None
    try:
        return int(float(str(raw).strip()))
    except (ValueError, TypeError):
        return None
