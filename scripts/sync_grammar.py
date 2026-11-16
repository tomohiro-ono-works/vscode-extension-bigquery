"""Generate TextMate keyword/function patterns from editable flat dictionaries.

Edit shared/googlesql-core/dictionaries/{keywords,functions}.txt, then:
  python scripts/sync_grammar.py --write
CI and VSIX builds use --check to reject unsynchronized grammar.
"""
from pathlib import Path
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[1]
DICTIONARIES = ROOT / "shared/googlesql-core/dictionaries"
GRAMMAR = ROOT / "syntaxes/googlesql.tmLanguage.json"


def read_words(filename):
    words = []
    for line in (DICTIONARIES / filename).read_text(encoding="utf-8").splitlines():
        value = line.strip()
        if not value or value.startswith("#"):
            continue
        if not re.fullmatch(r"[A-Z_][A-Z0-9_.]*", value):
            raise ValueError(f"{filename}: invalid dictionary entry {value!r}")
        words.append(value)
    if len(words) != len(set(words)):
        raise ValueError(f"{filename}: duplicate entries")
    return words


def expected_patterns():
    keywords = read_words("keywords.txt")
    functions = read_words("functions.txt")
    builtin = [f for f in functions if "." not in f]
    namespaced = [f for f in functions if "." in f]
    alternatives = lambda items: "|".join(re.escape(item) for item in items)
    return {
        "keyword.control.googlesql": r"(?i:\b(?:" + alternatives(keywords) + r")\b)",
        "support.function.builtin.googlesql": r"(?i:\b(?:" + alternatives(builtin) + r")\b(?=\s*\())",
        "support.function.namespace.googlesql": r"(?i:\b(?:" + alternatives(namespaced) + r")\b(?=\s*\())",
    }


def sync(write=False):
    data = json.loads(GRAMMAR.read_text(encoding="utf-8"))
    expected = expected_patterns()
    found = set()
    changed = []
    for pattern in data["patterns"]:
        scope = pattern.get("name")
        if scope in expected:
            found.add(scope)
            if pattern["match"] != expected[scope]:
                changed.append(scope)
                if write:
                    pattern["match"] = expected[scope]
    missing = set(expected) - found
    if missing:
        raise ValueError(f"Missing grammar patterns: {sorted(missing)}")
    if changed:
        if not write:
            raise ValueError(f"Grammar differs from dictionaries: {changed}. Run --write")
        GRAMMAR.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return len(read_words("keywords.txt")), len(read_words("functions.txt"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--write", action="store_true")
    options = parser.parse_args()
    keywords, functions = sync(write=options.write)
    print(f"GoogleSQL grammar synced: {keywords} keywords, {functions} functions")
