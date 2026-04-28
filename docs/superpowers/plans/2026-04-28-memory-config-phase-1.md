# Memory Config Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase 1 memory config discovery, validation, source materialization, and startup diagnostics without enabling profile-aware loading.

**Architecture:** Add a focused `scripts/memory-config.py` helper with TOML parsing, config validation, local/git source materialization, and JSON/human diagnostics. Keep `scripts/memory-session-start.sh` as the runtime startup entry point, but make it consume the helper only for selecting the memory root and emitting a concise diagnostic while preserving V0 fallback behavior.

**Tech Stack:** Bash, Python 3.11+ standard library (`argparse`, `json`, `pathlib`, `subprocess`, `tomllib`, `unittest`), local git fixture repositories for materialization tests.

---

## File Structure

- Create `scripts/memory-config.py`: command implementation and library-style functions for parsing `.pamem/config.toml`, validating config kinds, materializing source configs, and producing diagnostics.
- Create `scripts/memory-config.sh`: small Bash wrapper matching existing script wrapper style.
- Modify `scripts/memory-session-start.sh`: call `memory-config.sh`, parse JSON with `jq`, switch `MEMORY_PATH` to the resolved memory root when config is valid/materialized, and add one concise diagnostic line.
- Create `tests/memory_config/__init__.py`: unittest package marker.
- Create `tests/memory_config/test_memory_config.py`: CLI and validation tests for absent config, memory-repo config, source configs, path policy, profiles, request inbox, and git materialization.
- Create `tests/memory_config/test_memory_session_start.py`: hook-level tests that invoke `memory-session-start.sh` with JSON hook input and inspect returned additional context.
- Modify `README.md`: add a short reference to `.pamem/config.toml` and remote/local memory repo support.
- Modify `DESIGN.md`: align the existing memory config section with `.pamem/config.toml`, source vs memory-repo config, and requests inbox naming.

## Task 1: Add Memory Config Test Harness And Absent/Direct Repo Cases

**Files:**
- Create: `tests/memory_config/__init__.py`
- Create: `tests/memory_config/test_memory_config.py`
- Create: `scripts/memory-config.py`
- Create: `scripts/memory-config.sh`

- [ ] **Step 1: Write failing tests for absent config and direct memory repo config**

Create `tests/memory_config/__init__.py` as an empty file.

Create `tests/memory_config/test_memory_config.py` with:

```python
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"


class MemoryConfigCommandsTest(unittest.TestCase):
    def run_config(self, root, *args, check=True):
        command = [str(SCRIPTS / "memory-config.sh"), "--root", str(root), "--json"]
        command.extend(args)
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if check and result.returncode != 0:
            self.fail(
                f"memory-config failed with {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        return result

    def write(self, root, rel_path, content):
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        return path

    def write_memory_repo(self, root, name="agent-memory"):
        self.write(
            root,
            ".pamem/config.toml",
            f"""
            schema_version = "0.1"
            kind = "memory-repo"
            name = "{name}"
            entry_file = "MEMORY.md"
            notes_dir = "notes"
            """,
        )
        self.write(root, "MEMORY.md", "# Memory\n")
        (root / "notes").mkdir(parents=True, exist_ok=True)

    def report(self, result):
        return json.loads(result.stdout)

    def test_absent_config_reports_v0(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Memory\n")
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "absent")
            self.assertEqual(report["layout"], "v0")
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["diagnostic"], "Memory config: absent, using V0 layout")

    def test_direct_memory_repo_config_reports_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "valid")
            self.assertEqual(report["config_kind"], "memory-repo")
            self.assertEqual(report["name"], "agent-memory")
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["diagnostic"], "Memory config: memory-repo agent-memory, schema 0.1")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: FAIL because `scripts/memory-config.sh` does not exist.

- [ ] **Step 3: Add minimal helper wrapper**

Create `scripts/memory-config.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/memory-config.py" "$@"
```

Make it executable:

```bash
chmod +x scripts/memory-config.sh
```

- [ ] **Step 4: Add minimal Python helper for absent/direct config**

Create `scripts/memory-config.py` with:

```python
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    print("error: Python 3.11+ is required for tomllib support", file=sys.stderr)
    raise


SCHEMA_VERSION = "0.1"
CONFIG_RELATIVE_PATH = Path(".pamem") / "config.toml"


class ConfigError(Exception):
    pass


def normalize_root(raw_root: str | None) -> Path:
    return Path(raw_root or Path.cwd()).expanduser().resolve()


def load_toml(path: Path) -> dict:
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"{path}: TOML parse error: {exc}") from exc
    except OSError as exc:
        raise ConfigError(f"{path}: failed to read config: {exc.strerror}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{path}: top-level config must be a table")
    return data


def require_string(data: dict, key: str, path: Path) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{path}: field {key!r} must be a non-empty string")
    return value


def ensure_common_header(data: dict, path: Path) -> str:
    schema_version = require_string(data, "schema_version", path)
    if schema_version != SCHEMA_VERSION:
        raise ConfigError(f"{path}: unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION!r}")
    kind = require_string(data, "kind", path)
    if kind not in {"source", "memory-repo"}:
        raise ConfigError(f"{path}: invalid kind {kind!r}; expected 'source' or 'memory-repo'")
    return kind


def validate_memory_repo(root: Path) -> dict:
    config_path = root / CONFIG_RELATIVE_PATH
    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind != "memory-repo":
        raise ConfigError(f"{config_path}: expected kind 'memory-repo', found {kind!r}")

    name = require_string(data, "name", config_path)
    entry_file = require_string(data, "entry_file", config_path)
    notes_dir = require_string(data, "notes_dir", config_path)

    report = {
        "status": "valid",
        "config_kind": "memory-repo",
        "bootstrap_root": str(root),
        "memory_root": str(root),
        "schema_version": SCHEMA_VERSION,
        "name": name,
        "entry_file": {"raw": entry_file, "resolved": str((root / entry_file).resolve()), "exists": (root / entry_file).exists()},
        "notes_dir": {"raw": notes_dir, "resolved": str((root / notes_dir).resolve()), "exists": (root / notes_dir).exists()},
        "requests": {"inbox_dir": {"raw": "requests/inbox", "resolved": str((root / "requests/inbox").resolve()), "exists": (root / "requests/inbox").exists()}},
        "profiles": [],
        "warnings": [],
        "errors": [],
        "diagnostic": f"Memory config: memory-repo {name}, schema {SCHEMA_VERSION}",
    }
    return report


def discover(root: Path) -> dict:
    config_path = root / CONFIG_RELATIVE_PATH
    if not config_path.exists():
        return {
            "status": "absent",
            "layout": "v0",
            "bootstrap_root": str(root),
            "memory_root": str(root),
            "config_path": str(config_path),
            "warnings": [],
            "errors": [],
            "diagnostic": "Memory config: absent, using V0 layout",
        }

    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind == "memory-repo":
        return validate_memory_repo(root)
    raise ConfigError(f"{config_path}: source configs are not implemented yet")


def print_human(report: dict) -> None:
    print(report.get("diagnostic", "Memory config: no diagnostic available"))
    for warning in report.get("warnings", []):
        print(f"warning: {warning}")
    for error in report.get("errors", []):
        print(f"error: {error}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="memory-config", description="Discover and validate pamem memory config")
    parser.add_argument("--root", default=None, help="Bootstrap or memory repo root. Defaults to current directory.")
    parser.add_argument("--json", action="store_true", help="Emit JSON diagnostics")
    return parser


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = normalize_root(args.root)
    try:
        report = discover(root)
        exit_code = 0
    except ConfigError as exc:
        report = {
            "status": "error",
            "bootstrap_root": str(root),
            "memory_root": str(root),
            "warnings": [],
            "errors": [str(exc)],
            "diagnostic": f"Memory config error: {exc}",
        }
        exit_code = 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human(report)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
```

Make it executable:

```bash
chmod +x scripts/memory-config.py
```

- [ ] **Step 5: Run tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/memory-config.py scripts/memory-config.sh tests/memory_config/__init__.py tests/memory_config/test_memory_config.py
git commit -m "feat: add memory config discovery helper"
```

## Task 2: Validate Memory Repo Paths, Requests Inbox, And Profiles

**Files:**
- Modify: `tests/memory_config/test_memory_config.py`
- Modify: `scripts/memory-config.py`

- [ ] **Step 1: Add failing tests for repo validation rules**

Append these tests to `MemoryConfigCommandsTest`:

```python
    def test_memory_repo_missing_required_field_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "MEMORY.md"
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(report["status"], "error")
            self.assertIn("notes_dir", report["errors"][0])

    def test_absolute_memory_repo_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "/tmp/MEMORY.md"
                notes_dir = "notes"
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must be relative", report["errors"][0])

    def test_escaping_memory_repo_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "../MEMORY.md"
                notes_dir = "notes"
                """,
            )
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("must stay inside memory repo", report["errors"][0])

    def test_requests_inbox_defaults_and_custom_path_reports_warning_when_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "MEMORY.md"
                notes_dir = "notes"

                [requests]
                inbox_dir = "requests/custom-inbox"
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes").mkdir()
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(report["requests"]["inbox_dir"]["raw"], "requests/custom-inbox")
            self.assertEqual(report["summary"]["warning_count"], 1)
            self.assertIn("requests inbox path does not exist yet", report["warnings"][0])

    def test_profiles_are_validated_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "MEMORY.md"
                notes_dir = "notes"
                default_profile = "developer"

                [profiles.developer]
                description = "Developer profile."
                load = ["MEMORY.md", "notes/shared/workflow.md"]
                stable_targets = ["notes/shared/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes" / "shared").mkdir(parents=True)
            result = self.run_config(root)
            report = self.report(result)
            self.assertEqual(report["default_profile"], "developer")
            self.assertEqual(report["profiles"][0]["name"], "developer")
            self.assertEqual(report["summary"]["warning_count"], 2)

    def test_invalid_default_profile_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "agent-memory"
                entry_file = "MEMORY.md"
                notes_dir = "notes"
                default_profile = "reviewer"

                [profiles.developer]
                description = "Developer profile."
                load = ["MEMORY.md"]
                stable_targets = ["notes/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            (root / "notes").mkdir()
            result = self.run_config(root, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("default_profile", report["errors"][0])
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: FAIL on path validation, missing warnings, profile reporting, and invalid default profile.

- [ ] **Step 3: Implement path validation, summary, requests, and profiles**

Modify `scripts/memory-config.py` by adding these helpers after `require_string`:

```python
def relative_repo_path(root: Path, raw: str, field: str) -> dict:
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise ConfigError(f"field {field!r} must be relative: {raw}")
    resolved = (root / path).resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ConfigError(f"field {field!r} must stay inside memory repo: {raw}") from exc
    return {"raw": raw, "resolved": str(resolved), "exists": resolved.exists()}


def string_list(value: object, field: str) -> list[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise ConfigError(f"field {field!r} must be a list of non-empty strings")
    return list(value)


def summary(warnings: list[str], errors: list[str]) -> dict:
    return {"warning_count": len(warnings), "error_count": len(errors)}
```

Replace the body of `validate_memory_repo` with:

```python
def validate_memory_repo(root: Path) -> dict:
    config_path = root / CONFIG_RELATIVE_PATH
    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind != "memory-repo":
        raise ConfigError(f"{config_path}: expected kind 'memory-repo', found {kind!r}")

    name = require_string(data, "name", config_path)
    entry_raw = require_string(data, "entry_file", config_path)
    notes_raw = require_string(data, "notes_dir", config_path)

    warnings: list[str] = []
    errors: list[str] = []
    entry_file = relative_repo_path(root, entry_raw, "entry_file")
    notes_dir = relative_repo_path(root, notes_raw, "notes_dir")
    if not entry_file["exists"]:
        raise ConfigError(f"{config_path}: entry_file does not exist: {entry_raw}")
    if not notes_dir["exists"]:
        raise ConfigError(f"{config_path}: notes_dir does not exist: {notes_raw}")

    requests_raw = data.get("requests", {})
    if requests_raw is None:
        requests_raw = {}
    if not isinstance(requests_raw, dict):
        raise ConfigError(f"{config_path}: field 'requests' must be a table")
    inbox_raw = requests_raw.get("inbox_dir", "requests/inbox")
    if not isinstance(inbox_raw, str) or not inbox_raw.strip():
        raise ConfigError(f"{config_path}: field 'requests.inbox_dir' must be a non-empty string")
    inbox_dir = relative_repo_path(root, inbox_raw, "requests.inbox_dir")
    if not inbox_dir["exists"]:
        warnings.append(f"requests inbox path does not exist yet: {inbox_raw}")

    profiles_report = []
    profiles_raw = data.get("profiles", {})
    if profiles_raw is None:
        profiles_raw = {}
    if not isinstance(profiles_raw, dict):
        raise ConfigError(f"{config_path}: field 'profiles' must be a table")

    for profile_name, profile_data in profiles_raw.items():
        if not isinstance(profile_data, dict):
            raise ConfigError(f"{config_path}: profile {profile_name!r} must be a table")
        description = profile_data.get("description")
        if not isinstance(description, str) or not description.strip():
            raise ConfigError(f"{config_path}: profile {profile_name!r} field 'description' must be a non-empty string")
        load_items = string_list(profile_data.get("load"), f"profiles.{profile_name}.load")
        stable_items = string_list(profile_data.get("stable_targets"), f"profiles.{profile_name}.stable_targets")
        resolved_load = []
        resolved_stable_targets = []
        for item in load_items:
            resolved = relative_repo_path(root, item, f"profiles.{profile_name}.load")
            resolved_load.append(resolved)
            if not resolved["exists"]:
                warnings.append(f"profile {profile_name!r} load path does not exist yet: {item}")
        for item in stable_items:
            resolved = relative_repo_path(root, item, f"profiles.{profile_name}.stable_targets")
            resolved_stable_targets.append(resolved)
            if not resolved["exists"]:
                warnings.append(f"profile {profile_name!r} stable target does not exist yet: {item}")
        profiles_report.append(
            {
                "name": profile_name,
                "description": description,
                "load": load_items,
                "resolved_load": resolved_load,
                "stable_targets": stable_items,
                "resolved_stable_targets": resolved_stable_targets,
            }
        )

    default_profile = data.get("default_profile")
    if default_profile is not None:
        if not isinstance(default_profile, str) or not default_profile.strip():
            raise ConfigError(f"{config_path}: field 'default_profile' must be a non-empty string")
        if default_profile not in profiles_raw:
            raise ConfigError(f"{config_path}: default_profile {default_profile!r} does not match a configured profile")

    return {
        "status": "valid",
        "config_kind": "memory-repo",
        "bootstrap_root": str(root),
        "memory_root": str(root),
        "schema_version": SCHEMA_VERSION,
        "name": name,
        "entry_file": entry_file,
        "notes_dir": notes_dir,
        "requests": {"inbox_dir": inbox_dir},
        "profiles": profiles_report,
        "default_profile": default_profile,
        "summary": summary(warnings, errors),
        "warnings": warnings,
        "errors": errors,
        "diagnostic": f"Memory config: memory-repo {name}, schema {SCHEMA_VERSION}",
    }
```

Update the absent report in `discover` to include:

```python
"summary": summary([], []),
"config_kind": None,
```

Update the error report in `main` to include:

```python
"summary": summary([], [str(exc)]),
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/memory-config.py tests/memory_config/test_memory_config.py
git commit -m "feat: validate memory repo config"
```

## Task 3: Implement Local Source Config Resolution

**Files:**
- Modify: `tests/memory_config/test_memory_config.py`
- Modify: `scripts/memory-config.py`

- [ ] **Step 1: Add failing local source tests**

Append these tests to `MemoryConfigCommandsTest`:

```python
    def test_local_source_resolves_memory_repo(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bootstrap = base / "bootstrap"
            memory = base / "agent-memory"
            bootstrap.mkdir()
            memory.mkdir()
            self.write_memory_repo(memory, name="shared-memory")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../agent-memory"
                """,
            )
            result = self.run_config(bootstrap)
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["status"], "valid")
            self.assertEqual(report["config_kind"], "source")
            self.assertEqual(report["source"]["type"], "local")
            self.assertEqual(report["memory_root"], str(memory.resolve()))
            self.assertEqual(report["memory_repo"]["name"], "shared-memory")
            self.assertEqual(report["diagnostic"], f"Memory source: local -> {memory.resolve()}")

    def test_local_source_absolute_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "/tmp/agent-memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("source.path must be relative", report["errors"][0])

    def test_local_source_missing_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../missing-memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("local source target does not exist", report["errors"][0])
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: FAIL because source configs still report "not implemented".

- [ ] **Step 3: Implement local source config**

Add helper functions to `scripts/memory-config.py`:

```python
def source_table(data: dict, config_path: Path) -> dict:
    source = data.get("source")
    if not isinstance(source, dict):
        raise ConfigError(f"{config_path}: field 'source' must be a table")
    source_type = source.get("type")
    if source_type not in {"local", "git"}:
        raise ConfigError(f"{config_path}: source.type must be 'local' or 'git'")
    return source


def relative_source_path(bootstrap_root: Path, raw: str, field: str) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise ConfigError(f"{field} must be relative: {raw}")
    return (bootstrap_root / path).resolve()


def validate_source(bootstrap_root: Path) -> dict:
    config_path = bootstrap_root / CONFIG_RELATIVE_PATH
    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind != "source":
        raise ConfigError(f"{config_path}: expected kind 'source', found {kind!r}")
    source = source_table(data, config_path)
    if source["type"] == "local":
        return validate_local_source(bootstrap_root, config_path, source)
    raise ConfigError(f"{config_path}: git source configs are not implemented yet")


def validate_local_source(bootstrap_root: Path, config_path: Path, source: dict) -> dict:
    raw_path = source.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        raise ConfigError(f"{config_path}: source.path must be a non-empty string")
    memory_root = relative_source_path(bootstrap_root, raw_path, "source.path")
    if not memory_root.exists() or not memory_root.is_dir():
        raise ConfigError(f"{config_path}: local source target does not exist or is not a directory: {raw_path}")
    memory_report = validate_memory_repo(memory_root)
    return {
        "status": "valid",
        "config_kind": "source",
        "bootstrap_root": str(bootstrap_root),
        "memory_root": str(memory_root),
        "schema_version": SCHEMA_VERSION,
        "source": {
            "type": "local",
            "path": raw_path,
            "resolved": str(memory_root),
        },
        "memory_repo": memory_report,
        "summary": memory_report["summary"],
        "warnings": memory_report["warnings"],
        "errors": [],
        "diagnostic": f"Memory source: local -> {memory_root}",
    }
```

Update `discover`:

```python
    if kind == "memory-repo":
        return validate_memory_repo(root)
    return validate_source(root)
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/memory-config.py tests/memory_config/test_memory_config.py
git commit -m "feat: resolve local memory source config"
```

## Task 4: Implement Git Source Materialization

**Files:**
- Modify: `tests/memory_config/test_memory_config.py`
- Modify: `scripts/memory-config.py`

- [ ] **Step 1: Add failing git source tests**

Append helper and tests to `MemoryConfigCommandsTest`:

```python
    def git(self, cwd, *args):
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            self.fail(f"git {' '.join(args)} failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        return result

    def make_remote_memory_repo(self, base):
        remote = base / "remote-memory"
        remote.mkdir()
        self.write_memory_repo(remote, name="remote-memory")
        self.git(remote, "init", "-b", "main")
        self.git(remote, "config", "user.email", "test@example.com")
        self.git(remote, "config", "user.name", "Test User")
        self.git(remote, "add", ".")
        self.git(remote, "commit", "-m", "seed memory repo")
        return remote

    def test_git_source_clones_missing_local_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                ref = "main"
                """,
            )
            result = self.run_config(bootstrap)
            report = self.report(result)
            expected_memory = bootstrap / ".pamem" / "memory"
            self.assertEqual(result.returncode, 0)
            self.assertTrue((expected_memory / ".git").exists())
            self.assertEqual(report["source"]["local_path"]["raw"], ".pamem/memory")
            self.assertEqual(report["memory_root"], str(expected_memory.resolve()))
            self.assertEqual(report["memory_repo"]["name"], "remote-memory")

    def test_git_source_existing_repo_does_not_pull(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            local = bootstrap / ".pamem" / "memory"
            local.parent.mkdir(parents=True)
            self.git(bootstrap, "clone", "--branch", "main", str(remote), str(local))
            before = self.git(local, "rev-parse", "HEAD").stdout.strip()
            self.write(remote, "notes/new.md", "new remote content\n")
            self.git(remote, "add", ".")
            self.git(remote, "commit", "-m", "remote update")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                ref = "main"
                """,
            )
            result = self.run_config(bootstrap)
            after = self.git(local, "rev-parse", "HEAD").stdout.strip()
            self.assertEqual(result.returncode, 0)
            self.assertEqual(after, before)

    def test_git_source_existing_non_git_path_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            remote = self.make_remote_memory_repo(base)
            bootstrap = base / "bootstrap"
            bootstrap.mkdir()
            self.write(bootstrap, ".pamem/memory/file.txt", "not a repo\n")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                f"""
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "{remote.as_posix()}"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("exists but is not a git repository", report["errors"][0])

    def test_git_source_local_path_must_stay_under_pamem(self):
        with tempfile.TemporaryDirectory() as tmp:
            bootstrap = Path(tmp)
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "git"
                remote = "../remote-memory"
                local_path = "../memory"
                """,
            )
            result = self.run_config(bootstrap, check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 2)
            self.assertIn("source.local_path must stay under .pamem", report["errors"][0])
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: FAIL because git source configs are not implemented.

- [ ] **Step 3: Implement git source materialization**

Add imports to `scripts/memory-config.py`:

```python
import subprocess
```

Add these functions:

```python
def ensure_under_pamem(bootstrap_root: Path, raw: str, field: str) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise ConfigError(f"{field} must be relative: {raw}")
    resolved = (bootstrap_root / path).resolve()
    pamem_root = (bootstrap_root / ".pamem").resolve()
    try:
        resolved.relative_to(pamem_root)
    except ValueError as exc:
        raise ConfigError(f"{field} must stay under .pamem: {raw}") from exc
    return resolved


def run_git(args: list[str], cwd: Path | None = None) -> None:
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise ConfigError(f"git {' '.join(args)} failed: {detail}")


def validate_git_source(bootstrap_root: Path, config_path: Path, source: dict) -> dict:
    remote = source.get("remote")
    if not isinstance(remote, str) or not remote.strip():
        raise ConfigError(f"{config_path}: source.remote must be a non-empty string")
    ref = source.get("ref", "main")
    if not isinstance(ref, str) or not ref.strip():
        raise ConfigError(f"{config_path}: source.ref must be a non-empty string")
    raw_local_path = source.get("local_path", ".pamem/memory")
    if not isinstance(raw_local_path, str) or not raw_local_path.strip():
        raise ConfigError(f"{config_path}: source.local_path must be a non-empty string")

    memory_root = ensure_under_pamem(bootstrap_root, raw_local_path, "source.local_path")
    if not memory_root.exists():
        memory_root.parent.mkdir(parents=True, exist_ok=True)
        run_git(["clone", "--branch", ref, remote, str(memory_root)])
    elif not (memory_root / ".git").exists():
        raise ConfigError(f"{config_path}: source.local_path exists but is not a git repository: {raw_local_path}")

    memory_report = validate_memory_repo(memory_root)
    return {
        "status": "valid",
        "config_kind": "source",
        "bootstrap_root": str(bootstrap_root),
        "memory_root": str(memory_root),
        "schema_version": SCHEMA_VERSION,
        "source": {
            "type": "git",
            "remote": remote,
            "ref": ref,
            "local_path": {"raw": raw_local_path, "resolved": str(memory_root), "exists": memory_root.exists()},
        },
        "memory_repo": memory_report,
        "summary": memory_report["summary"],
        "warnings": memory_report["warnings"],
        "errors": [],
        "diagnostic": f"Memory source: git -> {memory_root}",
    }
```

Change `validate_source`:

```python
    if source["type"] == "local":
        return validate_local_source(bootstrap_root, config_path, source)
    return validate_git_source(bootstrap_root, config_path, source)
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/memory-config.py tests/memory_config/test_memory_config.py
git commit -m "feat: materialize git memory source"
```

## Task 5: Integrate Startup Diagnostics And Memory Root Selection

**Files:**
- Create: `tests/memory_config/test_memory_session_start.py`
- Modify: `scripts/memory-session-start.sh`

- [ ] **Step 1: Write failing startup hook tests**

Create `tests/memory_config/test_memory_session_start.py`:

```python
import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SESSION_START = REPO_ROOT / "scripts" / "memory-session-start.sh"


class MemorySessionStartConfigTest(unittest.TestCase):
    def run_hook(self, cwd):
        result = subprocess.run(
            [str(SESSION_START)],
            input=json.dumps({"cwd": str(cwd)}),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if result.returncode != 0:
            self.fail(f"session start failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]

    def write(self, root, rel_path, content):
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        return path

    def write_memory_repo(self, root, name="agent-memory"):
        self.write(
            root,
            ".pamem/config.toml",
            f"""
            schema_version = "0.1"
            kind = "memory-repo"
            name = "{name}"
            entry_file = "MEMORY.md"
            notes_dir = "notes"
            """,
        )
        self.write(root, "MEMORY.md", f"# {name}\n")
        (root / "notes").mkdir(parents=True, exist_ok=True)

    def test_absent_config_keeps_v0_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# V0 Memory\n")
            context = self.run_hook(root)
            self.assertIn("Memory config: absent, using V0 layout", context)
            self.assertIn("# V0 Memory", context)

    def test_direct_memory_repo_adds_config_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, name="direct-memory")
            context = self.run_hook(root)
            self.assertIn("Memory config: memory-repo direct-memory, schema 0.1", context)
            self.assertIn("# direct-memory", context)

    def test_local_source_loads_materialized_memory_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            bootstrap = base / "bootstrap"
            memory = base / "memory"
            bootstrap.mkdir()
            memory.mkdir()
            self.write(bootstrap, "MEMORY.md", "# Bootstrap Memory\n")
            self.write_memory_repo(memory, name="local-memory")
            self.write(
                bootstrap,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../memory"
                """,
            )
            context = self.run_hook(bootstrap)
            self.assertIn(f"Memory source: local -> {memory.resolve()}", context)
            self.assertIn("# local-memory", context)
            self.assertNotIn("# Bootstrap Memory", context)

    def test_invalid_config_falls_back_to_current_v0_memory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Fallback Memory\n")
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "memory-repo"
                name = "bad-memory"
                entry_file = "../MEMORY.md"
                notes_dir = "notes"
                """,
            )
            context = self.run_hook(root)
            self.assertIn("Memory config error:", context)
            self.assertIn("# Fallback Memory", context)
```

- [ ] **Step 2: Run tests to verify failures**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_session_start
```

Expected: FAIL because `memory-session-start.sh` does not call `memory-config.sh`.

- [ ] **Step 3: Modify startup script to use config diagnostics**

In `scripts/memory-session-start.sh`, after `ROOT` fallback, insert:

```bash
CONFIG_OUTPUT="$("$SCRIPT_DIR/memory-config.sh" --root "$ROOT" --json 2>/dev/null || true)"
CONFIG_DIAGNOSTIC="$(printf '%s' "$CONFIG_OUTPUT" | jq -r '.diagnostic // empty' 2>/dev/null || true)"
CONFIG_MEMORY_ROOT="$(printf '%s' "$CONFIG_OUTPUT" | jq -r '.memory_root // empty' 2>/dev/null || true)"

if [ -n "$CONFIG_MEMORY_ROOT" ] && [ -d "$CONFIG_MEMORY_ROOT" ]; then
  MEMORY_ROOT="$CONFIG_MEMORY_ROOT"
else
  MEMORY_ROOT="$ROOT"
fi

if [ -z "$CONFIG_DIAGNOSTIC" ]; then
  CONFIG_DIAGNOSTIC="Memory config: diagnostics unavailable, using V0 layout"
fi
```

Replace:

```bash
MEMORY_PATH="$ROOT/MEMORY.md"
```

with:

```bash
MEMORY_PATH="$MEMORY_ROOT/MEMORY.md"
```

At the beginning of context construction, initialize:

```bash
CONTEXT="$CONFIG_DIAGNOSTIC"
```

and ensure later additions use the existing blank-line separator logic. If the current script initializes `CONTEXT=""`, replace that line with the new initialization.

- [ ] **Step 4: Run startup tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_session_start
```

Expected: PASS.

- [ ] **Step 5: Run full memory config tests**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config tests.memory_config.test_memory_session_start
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/memory-session-start.sh tests/memory_config/test_memory_session_start.py
git commit -m "feat: report memory config during startup"
```

## Task 6: Update Documentation And Run Final Verification

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`

- [ ] **Step 1: Update README with config command and config kinds**

In `README.md`, under the runtime/content split, add this Markdown:

### Memory Config

Phase 1 uses `.pamem/config.toml`.

The config can be either:

- `kind = "memory-repo"` inside the actual memory repository
- `kind = "source"` inside a bootstrap directory that points to a local or git-backed memory repository

Run:

```bash
scripts/memory-config.sh --root /path/to/bootstrap-or-memory-repo --json
```

Startup reports the config status but does not enable profile-aware loading yet.

- [ ] **Step 2: Update DESIGN memory config section**

In `DESIGN.md`, replace references to `.pamem/memory.toml` with `.pamem/config.toml` in the memory config section, and add this paragraph:

```markdown
Phase 1 recognizes two config kinds. `kind = "memory-repo"` describes the actual memory repository. `kind = "source"` lives in a bootstrap directory and resolves a local or git-backed memory repository. Source config may clone a missing git memory repo into `.pamem/memory`, but startup does not pull existing clones automatically.
```

Also update request config examples from:

```toml
requests_dir = "requests/pending"
```

to:

```toml
[requests]
inbox_dir = "requests/inbox"
```

- [ ] **Step 3: Run final verification**

Run:

```bash
python3 -m unittest tests.memory_config.test_memory_config tests.memory_config.test_memory_session_start tests.memory_lint.test_memory_lint
bash -n scripts/memory-config.sh scripts/memory-lint.sh scripts/memory-session-start.sh scripts/memory-pre-compact.sh scripts/install-pamem.sh scripts/remove-pamem.sh scripts/repair-pamem.sh
python3 -m py_compile scripts/memory-config.py scripts/memory_lint.py
```

Expected:

- unittest reports all tests passing.
- shell syntax checks produce no output and exit `0`.
- Python compile produces no output and exit `0`.

- [ ] **Step 4: Remove generated cache files**

Run:

```bash
rm -rf scripts/__pycache__ tests/memory_config/__pycache__ tests/memory_lint/__pycache__
```

Expected: no `__pycache__` directories remain.

- [ ] **Step 5: Commit docs and final verification state**

```bash
git add README.md DESIGN.md
git commit -m "docs: document memory config phase 1"
```

## Self-Review Checklist

- Spec coverage:
  - Source and memory-repo config kinds are implemented in Tasks 1, 3, and 4.
  - Strict memory repo path policy is implemented in Task 2.
  - Optional profiles and `default_profile` validation are implemented in Task 2.
  - Requests inbox default and validation are implemented in Task 2.
  - Local and git source materialization are implemented in Tasks 3 and 4.
  - Startup diagnostics and V0 fallback are implemented in Task 5.
  - Docs are updated in Task 6.
- Placeholder scan:
  - No task uses banned placeholder wording or unspecified broad test instructions.
  - Every code-changing step names exact files and includes concrete code or replacement instructions.
- Type and name consistency:
  - Config filename is `.pamem/config.toml`.
  - Config kinds are `source` and `memory-repo`.
  - Request queue field is `[requests].inbox_dir`.
  - CLI wrapper is `scripts/memory-config.sh`.
  - Python helper is `scripts/memory-config.py`.
