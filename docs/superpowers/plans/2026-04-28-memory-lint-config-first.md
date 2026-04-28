# Memory Lint Config-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the migrated V0 memory lint prototype with a config-first memory repo lint command.

**Architecture:** Keep `scripts/memory-lint.sh` as the Bash wrapper and update `scripts/memory_lint.py` to parse `.pamem/config.toml` directly into a lint-specific model. Lint rules should run against `entry_file` and the union of `profiles.*.stable_targets`, with config-derived health findings for stable targets, load paths, and the request inbox.

**Tech Stack:** Bash, Python 3.11+ standard library (`argparse`, `json`, `pathlib`, `re`, `tomllib`, `unittest`), existing shell wrapper style, existing report JSON shape.

---

## File Structure

- Modify `scripts/memory_lint.py`: remove legacy V0/writeback intent behavior, add config parsing, build a config-first lint model, retarget rules to `entry_file` and config-defined stable targets, and include config diagnostics in reports.
- Modify `tests/memory_lint/test_memory_lint.py`: replace legacy V0/writeback tests with config-first CLI, config-derived, stable target, and entry file tests.
- Modify `skills/memory-lint/SKILL.md`: document config-first usage and remove parked prototype/writeback language.
- Modify `docs/drafts/2026-04-28-memory-lint-migration.md`: mark the migrated prototype as superseded.
- Modify `README.md`: document that memory lint requires `.pamem/config.toml`.

## Task 1: Require Memory Repo Config And Remove Legacy CLI Options

**Files:**
- Modify: `tests/memory_lint/test_memory_lint.py`
- Modify: `scripts/memory_lint.py`

- [ ] **Step 1: Replace the memory lint test harness with config-first boundary tests**

Replace `tests/memory_lint/test_memory_lint.py` with:

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


class MemoryLintCommandsTest(unittest.TestCase):
    def run_lint(self, memory_root, *args, check=True):
        command = [str(SCRIPTS / "memory-lint.sh"), "--memory-root", str(memory_root)]
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
                f"memory-lint failed with {result.returncode}\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        return result

    def write(self, root, rel_path, content):
        path = root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip(), encoding="utf-8")
        return path

    def write_memory_repo(self, root, *, entry_file="MEMORY.md", notes_dir="notes", profiles=True):
        profile_block = ""
        if profiles:
            profile_block = """

            [profiles.developer]
            description = "Developer profile."
            load = [
              "MEMORY.md",
              "notes/shared/preferences.md",
              "notes/shared/experience.md",
            ]
            stable_targets = [
              "notes/shared/experience.md",
            ]
            """
        self.write(
            root,
            ".pamem/config.toml",
            f"""
            schema_version = "0.1"
            kind = "memory-repo"
            name = "agent-memory"
            entry_file = "{entry_file}"
            notes_dir = "{notes_dir}"

            [requests]
            inbox_dir = "requests/inbox"
            {profile_block}
            """,
        )
        self.write(root, entry_file, "# Memory\n\n- See notes/shared/experience.md\n")
        self.write(root, "notes/shared/preferences.md", "# Preferences\n")
        self.write(
            root,
            "notes/shared/experience.md",
            "## Test workflow\n\ntype: finding\n\nWhen working in this repo, run unittest before commit.\n",
        )
        (root / "requests" / "inbox").mkdir(parents=True, exist_ok=True)

    def report(self, result):
        return json.loads(result.stdout)

    def rules(self, report):
        return {finding["rule"] for finding in report["findings"]}

    def test_wrapper_help(self):
        result = subprocess.run(
            [str(SCRIPTS / "memory-lint.sh"), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_help_does_not_require_site_packages(self):
        result = subprocess.run(
            [sys.executable, "-S", str(SCRIPTS / "memory_lint.py"), "--help"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("usage:", result.stdout.lower())

    def test_missing_config_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, "MEMORY.md", "# Memory\n")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("config.toml", result.stderr)

    def test_source_config_is_invalid_lint_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(
                root,
                ".pamem/config.toml",
                """
                schema_version = "0.1"
                kind = "source"

                [source]
                type = "local"
                path = "../memory"
                """,
            )
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("kind 'memory-repo'", result.stderr)

    def test_invalid_config_is_invalid_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write(root, ".pamem/config.toml", "schema_version = [")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("TOML parse error", result.stderr)

    def test_invalid_default_profile_is_invalid_input(self):
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
                stable_targets = ["notes/shared/experience.md"]
                """,
            )
            self.write(root, "MEMORY.md", "# Memory\n")
            self.write(root, "notes/shared/experience.md", "## Test workflow\n\ntype: finding\n\nReusable.\n")
            result = self.run_lint(root, "--json", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("default_profile", result.stderr)

    def test_clean_configured_memory_repo_passes_and_reports_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(report["summary"], {"error_count": 0, "warning_count": 0, "info_count": 0})
            self.assertEqual(report["memory_root"], str(root.resolve()))
            self.assertEqual(report["config"]["kind"], "memory-repo")
            self.assertEqual(report["config"]["name"], "agent-memory")
            self.assertEqual(report["config"]["entry_file"], "MEMORY.md")
            self.assertEqual(report["config"]["notes_dir"], "notes")
            self.assertEqual(report["config"]["requests_inbox_dir"], "requests/inbox")
            self.assertEqual(report["config"]["profiles"], ["developer"])
            self.assertEqual(report["config"]["stable_targets"], ["notes/shared/experience.md"])
            self.assertEqual(
                report["config"]["load_paths"],
                ["MEMORY.md", "notes/shared/preferences.md", "notes/shared/experience.md"],
            )

    def test_removed_workspace_and_intent_options_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            result = self.run_lint(
                root,
                "--workspace",
                str(root),
                "--intent",
                "legacy-intent.json",
                "--json",
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("unrecognized arguments", result.stderr)
```

- [ ] **Step 2: Run the boundary tests and verify they fail**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: FAIL because the current command accepts absent config, still exposes `--workspace` and `--intent`, and does not include `config` in the JSON report.

- [ ] **Step 3: Add config parsing types and helpers**

In `scripts/memory_lint.py`, add this import block change near the top:

```python
import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

try:
    import tomllib
except ModuleNotFoundError:
    print("error: Python 3.11+ is required for tomllib support", file=sys.stderr)
    raise
```

Add this constant next to `SCHEMA_VERSION`:

```python
CONFIG_RELATIVE_PATH = Path(".pamem") / "config.toml"
```

Add these dataclasses after `MemoryFile`:

```python
@dataclass
class PathInfo:
    raw: str
    resolved: Path
    exists: bool

    def report(self):
        return {"raw": self.raw, "resolved": str(self.resolved), "exists": self.exists}


@dataclass
class ProfileInfo:
    name: str
    description: str
    load: list[PathInfo]
    stable_targets: list[PathInfo]


@dataclass
class LintConfig:
    path: Path
    schema_version: str
    kind: str
    name: str
    entry_file: PathInfo
    notes_dir: PathInfo
    requests_inbox_dir: PathInfo
    profiles: list[ProfileInfo]
```

Add these helpers after `read_text`:

```python
def load_toml(path):
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise MemoryLintError(f"{path}: TOML parse error: {exc}") from exc
    except OSError as exc:
        raise MemoryLintError(f"{path}: failed to read config: {exc.strerror}") from exc
    if not isinstance(data, dict):
        raise MemoryLintError(f"{path}: top-level config must be a table")
    return data


def require_string(data, key, path):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise MemoryLintError(f"{path}: field {key!r} must be a non-empty string")
    return value


def string_list(value, field, path):
    if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
        raise MemoryLintError(f"{path}: field {field!r} must be a list of non-empty strings")
    return list(value)


def repo_path(memory_root, raw, field, config_path):
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise MemoryLintError(f"{config_path}: field {field!r} must be relative: {raw}")
    resolved = (memory_root / path).resolve()
    try:
        resolved.relative_to(memory_root.resolve())
    except ValueError as exc:
        raise MemoryLintError(f"{config_path}: field {field!r} must stay inside memory repo: {raw}") from exc
    return PathInfo(raw=raw, resolved=resolved, exists=resolved.exists())


def load_lint_config(memory_root):
    config_path = memory_root / CONFIG_RELATIVE_PATH
    if not config_path.exists():
        raise MemoryLintError(f"{config_path}: memory lint requires .pamem/config.toml")
    data = load_toml(config_path)
    schema_version = require_string(data, "schema_version", config_path)
    if schema_version != SCHEMA_VERSION:
        raise MemoryLintError(
            f"{config_path}: unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION!r}"
        )
    kind = require_string(data, "kind", config_path)
    if kind != "memory-repo":
        raise MemoryLintError(f"{config_path}: expected kind 'memory-repo', found {kind!r}")

    name = require_string(data, "name", config_path)
    entry_file = repo_path(memory_root, require_string(data, "entry_file", config_path), "entry_file", config_path)
    notes_dir = repo_path(memory_root, require_string(data, "notes_dir", config_path), "notes_dir", config_path)
    if not entry_file.exists or not entry_file.resolved.is_file():
        raise MemoryLintError(f"{config_path}: entry_file does not exist or is not a file: {entry_file.raw}")
    if not notes_dir.exists or not notes_dir.resolved.is_dir():
        raise MemoryLintError(f"{config_path}: notes_dir does not exist or is not a directory: {notes_dir.raw}")

    requests_raw = data.get("requests", {})
    if requests_raw is None:
        requests_raw = {}
    if not isinstance(requests_raw, dict):
        raise MemoryLintError(f"{config_path}: field 'requests' must be a table")
    inbox_raw = requests_raw.get("inbox_dir", "requests/inbox")
    if not isinstance(inbox_raw, str) or not inbox_raw.strip():
        raise MemoryLintError(f"{config_path}: field 'requests.inbox_dir' must be a non-empty string")
    requests_inbox_dir = repo_path(memory_root, inbox_raw, "requests.inbox_dir", config_path)

    profiles_raw = data.get("profiles", {})
    if profiles_raw is None:
        profiles_raw = {}
    if not isinstance(profiles_raw, dict):
        raise MemoryLintError(f"{config_path}: field 'profiles' must be a table")

    profiles = []
    for profile_name, profile_data in profiles_raw.items():
        if not isinstance(profile_name, str) or not profile_name.strip():
            raise MemoryLintError(f"{config_path}: profile names must be non-empty strings")
        if not isinstance(profile_data, dict):
            raise MemoryLintError(f"{config_path}: profile {profile_name!r} must be a table")
        description = require_string(profile_data, "description", config_path)
        load_items = string_list(profile_data.get("load"), f"profiles.{profile_name}.load", config_path)
        stable_items = string_list(
            profile_data.get("stable_targets"),
            f"profiles.{profile_name}.stable_targets",
            config_path,
        )
        profiles.append(
            ProfileInfo(
                name=profile_name,
                description=description,
                load=[repo_path(memory_root, item, f"profiles.{profile_name}.load", config_path) for item in load_items],
                stable_targets=[
                    repo_path(memory_root, item, f"profiles.{profile_name}.stable_targets", config_path)
                    for item in stable_items
                ],
            )
        )

    default_profile = data.get("default_profile")
    if default_profile is not None:
        if not isinstance(default_profile, str) or not default_profile.strip():
            raise MemoryLintError(f"{config_path}: field 'default_profile' must be a non-empty string")
        if default_profile not in {profile.name for profile in profiles}:
            raise MemoryLintError(
                f"{config_path}: default_profile {default_profile!r} does not match a configured profile"
            )

    return LintConfig(
        path=config_path,
        schema_version=schema_version,
        kind=kind,
        name=name,
        entry_file=entry_file,
        notes_dir=notes_dir,
        requests_inbox_dir=requests_inbox_dir,
        profiles=profiles,
    )
```

- [ ] **Step 4: Add config report helpers and update report output**

Add these helpers after `load_lint_config`:

```python
def unique_path_infos(path_infos):
    seen = set()
    result = []
    for path_info in path_infos:
        if path_info.raw in seen:
            continue
        seen.add(path_info.raw)
        result.append(path_info)
    return result


def stable_target_infos(lint_config):
    return unique_path_infos(
        target for profile in lint_config.profiles for target in profile.stable_targets
    )


def load_path_infos(lint_config):
    return unique_path_infos(path_info for profile in lint_config.profiles for path_info in profile.load)


def config_report(lint_config):
    return {
        "path": str(lint_config.path),
        "schema_version": lint_config.schema_version,
        "kind": lint_config.kind,
        "name": lint_config.name,
        "entry_file": lint_config.entry_file.raw,
        "notes_dir": lint_config.notes_dir.raw,
        "requests_inbox_dir": lint_config.requests_inbox_dir.raw,
        "profiles": [profile.name for profile in lint_config.profiles],
        "stable_targets": [item.raw for item in stable_target_infos(lint_config)],
        "load_paths": [item.raw for item in load_path_infos(lint_config)],
    }
```

Change `build_report` to accept `lint_config` and include `config`:

```python
def build_report(findings, memory_root, lint_config):
    summary = {
        "error_count": sum(1 for item in findings if item.severity == "error"),
        "warning_count": sum(1 for item in findings if item.severity == "warning"),
        "info_count": sum(1 for item in findings if item.severity == "info"),
    }
    serialized = []
    for index, item in enumerate(findings, start=1):
        data = {
            "id": f"finding-{index}",
            "rule": item.rule,
            "severity": item.severity,
            "path": item.path,
            "line": item.line,
            "title": item.title,
            "message": item.message,
            "evidence": item.evidence,
            "suggested_action": item.suggested_action,
        }
        if item.source_refs:
            data["source_refs"] = item.source_refs
        serialized.append(data)
    created_at = now_utc()
    return {
        "schema_version": SCHEMA_VERSION,
        "lint_id": f"{created_at.replace(':', '-')}__memory_lint",
        "created_at": created_at,
        "memory_root": str(memory_root),
        "config": config_report(lint_config),
        "summary": summary,
        "findings": serialized,
    }
```

- [ ] **Step 5: Remove legacy CLI options and wire minimal config-first lint flow**

Replace `build_parser` with:

```python
def build_parser():
    parser = argparse.ArgumentParser(
        prog="memory-lint",
        description="Report-only lint for configured pamem memory repositories.",
    )
    parser.add_argument("--memory-root", required=True, help="Path containing .pamem/config.toml")
    parser.add_argument("--json", action="store_true", help="Emit JSON report")
    parser.add_argument("--strict", action="store_true", help="Return 1 when warnings are present")
    parser.add_argument("--line-threshold", type=int, default=80)
    parser.add_argument("--max-code-blocks", type=int, default=2)
    parser.add_argument("--max-paragraph-chars", type=int, default=1200)
    return parser
```

Replace `run_lint` with this minimal version:

```python
def run_lint(args):
    memory_root = Path(args.memory_root).expanduser().resolve()
    if not memory_root.exists() or not memory_root.is_dir():
        raise MemoryLintError(f"memory root does not exist or is not a directory: {memory_root}")
    lint_config = load_lint_config(memory_root)
    findings = []
    return build_report(findings, memory_root, lint_config)
```

Keep `main` as the exit-code authority:

```python
def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        report = run_lint(args)
    except MemoryLintError as exc:
        return fail(str(exc))
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)
    summary = report["summary"]
    if summary["error_count"] > 0:
        return 1
    if args.strict and summary["warning_count"] > 0:
        return 1
    return 0
```

- [ ] **Step 6: Run the boundary tests**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: PASS.

- [ ] **Step 7: Commit the config-first CLI boundary**

Run:

```bash
git add scripts/memory_lint.py tests/memory_lint/test_memory_lint.py
git commit -m "feat: require config for memory lint"
```

## Task 2: Add Config-Derived Lint Findings

**Files:**
- Modify: `tests/memory_lint/test_memory_lint.py`
- Modify: `scripts/memory_lint.py`

- [ ] **Step 1: Add failing tests for ML011, ML012, and ML013**

Append these tests inside `MemoryLintCommandsTest` before the `if __name__ == "__main__"` block:

```python
    def test_no_stable_targets_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, profiles=False)
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML011", self.rules(report))
            self.assertIn("No stable targets", report["findings"][0]["title"])

    def test_missing_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "notes" / "shared" / "experience.md").unlink()
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML011", self.rules(report))
            self.assertEqual(report["summary"]["error_count"], 1)

    def test_stable_target_outside_notes_dir_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "outside.md", "## Outside\n\ntype: finding\n\nStable content.\n")
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace('"notes/shared/experience.md"', '"outside.md"')
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            finding = report["findings"][0]
            self.assertEqual(finding["rule"], "ML011")
            self.assertIn("under notes_dir", finding["message"])

    def test_stable_target_equal_to_entry_file_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace('"notes/shared/experience.md"', '"MEMORY.md"')
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            finding = report["findings"][0]
            self.assertEqual(finding["rule"], "ML011")
            self.assertIn("entry_file", finding["message"])

    def test_missing_requests_inbox_is_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "requests" / "inbox").rmdir()
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML012", self.rules(report))
            self.assertEqual(report["summary"]["warning_count"], 1)

    def test_missing_load_path_is_warning(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "notes" / "shared" / "preferences.md").unlink()
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML013", self.rules(report))
            self.assertEqual(report["summary"]["warning_count"], 1)

    def test_strict_fails_when_config_warning_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            (root / "requests" / "inbox").rmdir()
            result = self.run_lint(root, "--json", "--strict", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML012", self.rules(report))
```

- [ ] **Step 2: Run tests and verify the new tests fail**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: FAIL because config-derived findings are not emitted.

- [ ] **Step 3: Implement config-derived lint functions**

Add these helpers after `config_report`:

```python
def path_under(child, parent):
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def lint_config_model(lint_config):
    findings = []
    stable_targets = stable_target_infos(lint_config)
    if not stable_targets:
        findings.append(
            finding(
                "ML011",
                "error",
                lint_config.path.relative_to(lint_config.path.parents[1]).as_posix(),
                None,
                "No stable targets are configured",
                "Memory lint requires at least one profiles.*.stable_targets entry.",
                "profiles.*.stable_targets",
                "request-review",
            )
        )

    for target in stable_targets:
        if not target.exists:
            findings.append(
                finding(
                    "ML011",
                    "error",
                    target.raw,
                    None,
                    "Stable target does not exist",
                    "Every configured stable target must exist before it can be linted.",
                    target.raw,
                    "request-review",
                )
            )
            continue
        if not target.resolved.is_file():
            findings.append(
                finding(
                    "ML011",
                    "error",
                    target.raw,
                    None,
                    "Stable target is not a file",
                    "Every configured stable target must be a file.",
                    target.raw,
                    "request-review",
                )
            )
        if not path_under(target.resolved, lint_config.notes_dir.resolved):
            findings.append(
                finding(
                    "ML011",
                    "error",
                    target.raw,
                    None,
                    "Stable target is outside notes_dir",
                    "Stable targets must be under notes_dir so durable memory writes stay in the notes boundary.",
                    target.raw,
                    "request-review",
                )
            )
        if target.resolved == lint_config.entry_file.resolved:
            findings.append(
                finding(
                    "ML011",
                    "error",
                    target.raw,
                    None,
                    "Stable target equals entry_file",
                    "The startup entry_file is an index and must not be a stable memory target.",
                    target.raw,
                    "request-review",
                )
            )

    if not lint_config.requests_inbox_dir.exists or not lint_config.requests_inbox_dir.resolved.is_dir():
        findings.append(
            finding(
                "ML012",
                "warning",
                lint_config.requests_inbox_dir.raw,
                None,
                "Requests inbox directory is missing",
                "The configured request inbox directory should exist for future memory update workflows.",
                lint_config.requests_inbox_dir.raw,
                "request-review",
            )
        )

    for load_path in load_path_infos(lint_config):
        if not load_path.exists:
            findings.append(
                finding(
                    "ML013",
                    "warning",
                    load_path.raw,
                    None,
                    "Profile load path is missing",
                    "Configured profile load paths should exist before profile-aware startup loading is enabled.",
                    load_path.raw,
                    "request-review",
                )
            )
    return findings
```

Update `run_lint` so it starts with these findings:

```python
def run_lint(args):
    memory_root = Path(args.memory_root).expanduser().resolve()
    if not memory_root.exists() or not memory_root.is_dir():
        raise MemoryLintError(f"memory root does not exist or is not a directory: {memory_root}")
    lint_config = load_lint_config(memory_root)
    findings = []
    findings.extend(lint_config_model(lint_config))
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda item: (severity_rank[item.severity], item.path, item.line or 0, item.rule))
    return build_report(findings, memory_root, lint_config)
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: PASS.

- [ ] **Step 5: Commit config-derived findings**

Run:

```bash
git add scripts/memory_lint.py tests/memory_lint/test_memory_lint.py
git commit -m "feat: lint memory config targets"
```

## Task 3: Retarget Stable Memory Rules To Config Stable Targets

**Files:**
- Modify: `tests/memory_lint/test_memory_lint.py`
- Modify: `scripts/memory_lint.py`

- [ ] **Step 1: Add stable target rule tests**

Append these tests inside `MemoryLintCommandsTest`:

```python
    def test_domain_content_in_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                "## DTensor note\n\ntype: finding\n\nDTensor is PyTorch's distributed tensor abstraction.\n",
            )
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML001", self.rules(report))

    def test_domain_content_in_non_stable_note_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/background.md",
                "## DTensor note\n\ntype: finding\n\nDTensor is PyTorch's distributed tensor abstraction.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn("ML001", self.rules(report))

    def test_mixed_content_in_stable_target_is_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                (
                    "## DTensor workflow\n\n"
                    "type: finding\n\n"
                    "DTensor is PyTorch's distributed tensor abstraction, and the agent should stage it in wiki.\n"
                ),
            )
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML002", self.rules(report))

    def test_pending_split_review_stable_target_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                (
                    "## Pending split review\n\n"
                    "category: mixed\n"
                    "destination: split\n"
                    "review_status: pending\n\n"
                    "Pending split decision for reviewer.\n"
                ),
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertNotIn("ML002", self.rules(report))

    def test_transient_content_in_stable_target_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(
                root,
                "notes/shared/experience.md",
                "## Temporary output\n\ntype: finding\ncategory: transient\n\nTemporary command output.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML004", self.rules(report))

    def test_stable_target_entry_missing_type_warns_and_strict_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "notes/shared/experience.md", "## Plugin behavior\n\nReusable finding.\n")
            result = self.run_lint(root, "--json", "--strict", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML008", self.rules(report))

    def test_duplicate_stable_memory_is_info(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "notes/roles/developer.md", "## Plugin behavior\n\ntype: finding\n\n- Refresh plugin marketplace before plugin updates.\n")
            config = (root / ".pamem" / "config.toml").read_text(encoding="utf-8")
            config = config.replace(
                'stable_targets = [\n  "notes/shared/experience.md",\n]',
                'stable_targets = [\n  "notes/shared/experience.md",\n  "notes/roles/developer.md",\n]',
            )
            (root / ".pamem" / "config.toml").write_text(config, encoding="utf-8")
            self.write(
                root,
                "notes/shared/experience.md",
                "## Plugin behavior\n\ntype: finding\n\n- Refresh plugin marketplace before plugin updates.\n",
            )
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML009", self.rules(report))
```

- [ ] **Step 2: Run tests and verify stable target tests fail**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: FAIL because stable target content rules are not wired after Task 1.

- [ ] **Step 3: Replace memory file collection with config-defined files**

Replace `collect_memory_files` with:

```python
def collect_memory_files(memory_root, lint_config):
    files = []
    entry_path = lint_config.entry_file.resolved
    files.append(MemoryFile(entry_path, lint_config.entry_file.raw, read_text(entry_path), "entry-file"))
    for target in stable_target_infos(lint_config):
        if target.exists and target.resolved.is_file():
            files.append(MemoryFile(target.resolved, target.raw, read_text(target.resolved), "stable-target"))
    return files
```

Replace `is_stable_note`, `is_memory_index`, and `is_experience_note` with:

```python
def is_stable_note(memory_file):
    return memory_file.kind == "stable-target"


def is_memory_index(memory_file):
    return memory_file.kind == "entry-file"
```

- [ ] **Step 4: Retarget stable rule functions to MemoryFile kind**

In `lint_note_boundaries`, replace path-based checks with object-kind checks:

```python
def lint_note_boundaries(memory_files):
    findings = []
    for memory_file in memory_files:
        domain_hit = domain_evidence(memory_file.text)
        mixed_hit = mixed_evidence(memory_file.text)
        if is_stable_note(memory_file) and domain_hit:
            offset, evidence = domain_hit
            findings.append(
                finding(
                    "ML001",
                    "error",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Domain content appears in a pamem note",
                    "Stable pamem notes must hold agent operating memory, not domain knowledge.",
                    evidence,
                    "stage-wiki-note",
                )
            )
        if is_stable_note(memory_file) and mixed_hit:
            offset, evidence = mixed_hit
            findings.append(
                finding(
                    "ML002",
                    "error",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Mixed domain and operating memory content appears in a pamem note",
                    "Mixed content should be split before stable memory persistence.",
                    evidence,
                    "split-item",
                )
            )
        if is_memory_index(memory_file) and domain_hit:
            offset, evidence = domain_hit
            findings.append(
                finding(
                    "ML006",
                    "warning",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Entry file contains domain explanation",
                    "The entry file should stay a compact pointer file, not a domain knowledge store.",
                    evidence,
                    "request-review",
                )
            )
    return findings
```

Replace `lint_entry_metadata` with:

```python
def lint_entry_metadata(memory_files):
    findings = []
    for memory_file in memory_files:
        if not is_stable_note(memory_file):
            continue
        for offset, entry_text in iter_entry_blocks(memory_file.text):
            category = metadata_value(entry_text, "category")
            destination = metadata_value(entry_text, "destination")
            if category == "domain" or destination == "wiki-stage":
                evidence = f"category: {category}" if category == "domain" else f"destination: {destination}"
                findings.append(
                    finding(
                        "ML001",
                        "error",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Domain-routed memory entry appears in a pamem note",
                        "Stable pamem entries marked domain/wiki-stage must be staged through an external knowledge store.",
                        evidence,
                        "stage-wiki-note",
                    )
                )
            if category == "mixed" or destination == "split":
                if not pending_split_review_note(entry_text):
                    evidence = f"category: {category}" if category == "mixed" else f"destination: {destination}"
                    findings.append(
                        finding(
                            "ML002",
                            "error",
                            memory_file.rel_path,
                            line_for_offset(memory_file.text, offset),
                            "Mixed-routed memory entry appears in a pamem note",
                            "Mixed entries must be split or kept as pending review notes before stable memory persistence.",
                            evidence,
                            "request-review",
                        )
                    )
            if category == "transient" or destination == "none":
                evidence = f"category: {category}" if category == "transient" else f"destination: {destination}"
                findings.append(
                    finding(
                        "ML004",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Transient-routed memory entry appears in a pamem note",
                        "Transient or discard-routed entries should not be persisted in stable memory.",
                        evidence,
                        "discard",
                    )
                )
            confidence = metadata_value(entry_text, "confidence")
            if confidence == "low" and bool_metadata_value(entry_text, "review_required") is not True:
                findings.append(
                    finding(
                        "ML005",
                        "error",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, offset),
                        "Low-confidence memory entry lacks review requirement",
                        "Low-confidence entries must require review before stable memory persistence.",
                        "confidence: low",
                        "request-review",
                    )
                )
    return findings
```

Replace `lint_experience_types` with:

```python
def lint_stable_entry_types(memory_files):
    findings = []
    for memory_file in memory_files:
        if not is_stable_note(memory_file):
            continue
        headings = [
            match for match in re.finditer(r"(?m)^(#{2,6})\s+(.+?)\s*$", memory_file.text)
        ]
        if not headings:
            continue
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(memory_file.text)
            section = memory_file.text[heading.start() : end]
            if not section.strip():
                continue
            type_match = re.search(r"(?mi)^\s*type\s*[:=]\s*([A-Za-z_-]+)\s*$", section)
            if not type_match:
                findings.append(
                    finding(
                        "ML008",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, heading.start()),
                        "Stable memory entry lacks type marker",
                        "Stable memory entries should declare type: finding, correction, or meta.",
                        heading.group(2),
                        "request-review",
                    )
                )
            elif type_match.group(1) not in ALLOWED_EXPERIENCE_TYPES:
                findings.append(
                    finding(
                        "ML008",
                        "warning",
                        memory_file.rel_path,
                        line_for_offset(memory_file.text, type_match.start()),
                        "Stable memory entry has invalid type marker",
                        "Stable memory entry type should be finding, correction, or meta.",
                        type_match.group(0),
                        "request-review",
                    )
                )
    return findings
```

Update `lint_duplicates` to use `is_stable_note(memory_file)` instead of `is_stable_note(memory_file.rel_path)`.

- [ ] **Step 5: Wire stable target rules into run_lint**

Replace `run_lint` with:

```python
def run_lint(args):
    memory_root = Path(args.memory_root).expanduser().resolve()
    if not memory_root.exists() or not memory_root.is_dir():
        raise MemoryLintError(f"memory root does not exist or is not a directory: {memory_root}")
    lint_config = load_lint_config(memory_root)
    memory_files = collect_memory_files(memory_root, lint_config)
    findings = []
    findings.extend(lint_config_model(lint_config))
    findings.extend(lint_note_boundaries(memory_files))
    findings.extend(lint_entry_metadata(memory_files))
    findings.extend(lint_stable_entry_types(memory_files))
    findings.extend(lint_duplicates(memory_files))
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda item: (severity_rank[item.severity], item.path, item.line or 0, item.rule))
    return build_report(findings, memory_root, lint_config)
```

- [ ] **Step 6: Run tests**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: PASS.

- [ ] **Step 7: Commit stable target lint**

Run:

```bash
git add scripts/memory_lint.py tests/memory_lint/test_memory_lint.py
git commit -m "feat: lint config stable targets"
```

## Task 4: Retarget Entry File Rules

**Files:**
- Modify: `tests/memory_lint/test_memory_lint.py`
- Modify: `scripts/memory_lint.py`

- [ ] **Step 1: Add entry file tests**

Append these tests inside `MemoryLintCommandsTest`:

```python
    def test_custom_entry_file_pointer_check_uses_config_entry_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, entry_file="INDEX.md")
            self.write(root, "MEMORY.md", "- See notes/missing.md\n")
            self.write(root, "INDEX.md", "- See notes/shared/missing.md\n")
            result = self.run_lint(root, "--json", check=False)
            report = self.report(result)
            self.assertEqual(result.returncode, 1)
            self.assertIn("ML007", self.rules(report))
            self.assertEqual(report["findings"][0]["path"], "INDEX.md")
            self.assertIn("notes/shared/missing.md", report["findings"][0]["evidence"])

    def test_entry_file_domain_explanation_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "MEMORY.md", "DTensor is PyTorch's distributed tensor abstraction.\n")
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML006", self.rules(report))

    def test_entry_file_size_warning_uses_config_entry_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root, entry_file="INDEX.md")
            self.write(root, "INDEX.md", "\n".join(f"- item {index}" for index in range(85)))
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML006", self.rules(report))
            self.assertEqual(report["findings"][0]["path"], "INDEX.md")

    def test_entry_file_transient_metadata_warns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_memory_repo(root)
            self.write(root, "MEMORY.md", "category: transient\n\nTemporary command output.\n")
            result = self.run_lint(root, "--json")
            report = self.report(result)
            self.assertEqual(result.returncode, 0)
            self.assertIn("ML004", self.rules(report))
```

- [ ] **Step 2: Run tests and verify entry file tests fail**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: FAIL because entry size and pointer checks are still tied to old `MEMORY.md` assumptions or are not wired.

- [ ] **Step 3: Add dynamic note pointer regex**

Replace the global `NOTE_POINTER_RE` with this function:

```python
def note_pointer_re(notes_dir_raw):
    escaped = re.escape(notes_dir_raw.strip("/"))
    return re.compile(rf"(?<![\w./-])({escaped}/[A-Za-z0-9][A-Za-z0-9._/\- ]*?\.md)")
```

- [ ] **Step 4: Replace memory index lint with entry file lint**

Replace `lint_memory_index` with:

```python
def lint_entry_file(memory_files, memory_root, lint_config, line_threshold, max_code_blocks, max_paragraph_chars):
    findings = []
    memory_file = next((item for item in memory_files if is_memory_index(item)), None)
    if not memory_file:
        return findings
    lines = memory_file.text.splitlines()
    if len(lines) > line_threshold:
        findings.append(
            finding(
                "ML006",
                "warning",
                memory_file.rel_path,
                line_threshold + 1,
                "Entry file exceeds line threshold",
                "The entry file should remain a compact pointer and governance entry point.",
                f"{len(lines)} lines",
                "request-review",
            )
        )
    code_blocks = len(re.findall(r"(?m)^```", memory_file.text)) // 2
    if code_blocks > max_code_blocks:
        findings.append(
            finding(
                "ML006",
                "warning",
                memory_file.rel_path,
                None,
                "Entry file contains too many fenced code blocks",
                "Command output or detailed examples should live outside the startup index.",
                f"{code_blocks} fenced code blocks",
                "request-review",
            )
        )
    for offset, paragraph in paragraph_spans(memory_file.text):
        if len(paragraph) > max_paragraph_chars:
            findings.append(
                finding(
                    "ML006",
                    "warning",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Entry file contains an oversized paragraph",
                    "Long explanatory blocks should move to an appropriate note with a pointer.",
                    paragraph,
                    "request-review",
                )
            )
            break
    if len(re.findall(r"(?mi)^\s*(user|assistant|agent)\s*:", memory_file.text)) >= 4:
        findings.append(
            finding(
                "ML006",
                "warning",
                memory_file.rel_path,
                None,
                "Entry file appears to contain transcript text",
                "Full transcripts should not be stored in the entry file.",
                "Repeated speaker labels detected.",
                "request-review",
            )
        )
    for match in note_pointer_re(lint_config.notes_dir.raw).finditer(memory_file.text):
        note_rel = match.group(1).strip()
        if not (memory_root / note_rel).exists():
            findings.append(
                finding(
                    "ML007",
                    "error",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, match.start()),
                    "Entry file points to a missing note",
                    "Local note pointers in the entry file must resolve under the memory root.",
                    note_rel,
                    "request-review",
                )
            )
    for offset, entry_text in iter_entry_blocks(memory_file.text):
        category = metadata_value(entry_text, "category")
        destination = metadata_value(entry_text, "destination")
        if category == "transient" or destination == "none":
            evidence = f"category: {category}" if category == "transient" else f"destination: {destination}"
            findings.append(
                finding(
                    "ML004",
                    "warning",
                    memory_file.rel_path,
                    line_for_offset(memory_file.text, offset),
                    "Transient-routed memory entry appears in the entry file",
                    "Transient or discard-routed entries should not be persisted in startup memory.",
                    evidence,
                    "discard",
                )
            )
    return findings
```

Update `run_lint` to call it:

```python
    findings.extend(
        lint_entry_file(
            memory_files,
            memory_root,
            lint_config,
            args.line_threshold,
            args.max_code_blocks,
            args.max_paragraph_chars,
        )
    )
```

- [ ] **Step 5: Run tests**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
```

Expected: PASS.

- [ ] **Step 6: Commit entry file lint**

Run:

```bash
git add scripts/memory_lint.py tests/memory_lint/test_memory_lint.py
git commit -m "feat: lint config entry file"
```

## Task 5: Delete Legacy Writeback Intent Code And Update Documentation

**Files:**
- Modify: `scripts/memory_lint.py`
- Modify: `README.md`
- Modify: `skills/memory-lint/SKILL.md`
- Modify: `docs/drafts/2026-04-28-memory-lint-migration.md`

- [ ] **Step 1: Remove legacy intent code from `scripts/memory_lint.py`**

Delete these dataclasses, constants, and functions from `scripts/memory_lint.py`:

```text
IntentItem
intent_item_ref
source_ref_for_item
possible_item_refs
find_item_ref
marker_value
source_ref_markers
entry_bounds_for_offset
entry_text_for_offset
validate_intent_item
validate_source_refs
validate_intent_batch
load_intents
lint_intent_integrity
lint_intent_application
valid_reviewed_at
review_state
```

Keep `metadata_value` and `bool_metadata_value`; they are still used by stable target and entry file rules.

Run:

```bash
rg -n "IntentItem|intent_item|source_ref_for_item|possible_item_refs|find_item_ref|marker_value|source_ref_markers|entry_bounds_for_offset|entry_text_for_offset|validate_intent|load_intents|lint_intent|valid_reviewed_at|review_state" scripts/memory_lint.py
```

Expected: no output.

- [ ] **Step 2: Update README optional checks**

Replace the Optional Checks section in `README.md` with:

````markdown
### Optional Checks

`scripts/memory-lint.sh` can run an explicit read-only health check on a configured memory repository:

```bash
scripts/memory-lint.sh --memory-root /path/to/memory-repo --json
```

The memory root must contain `.pamem/config.toml` with `kind = "memory-repo"`. Lint uses `entry_file`, `notes_dir`, `requests.inbox_dir`, and `profiles.*.stable_targets` from that config.

It is not run automatically and does not modify memory files.
````

- [ ] **Step 3: Replace the memory-lint skill body**

Replace `skills/memory-lint/SKILL.md` with:

````markdown
---
name: memory-lint
description: Report-only pamem memory lint for configured memory repositories. Use when explicitly checking a memory repo with .pamem/config.toml for stable target, entry file, pointer, boundary, and cleanup issues.
---

# Memory Lint

Report-only lint for configured pamem memory repositories.

This capability is explicit and read-only. It validates the configured memory repo boundary and reports issues, but it does not repair files, promote requests, or run automatically from hooks.

## Boundary

It must not:

- modify `entry_file`
- modify files under `notes_dir`
- stage or promote external knowledge notes
- mutate request artifacts
- run as part of startup or compact hooks
- block config discovery or profile loading
- sync, promote, or apply memory changes

It may:

- read an explicitly provided memory root
- require `.pamem/config.toml` with `kind = "memory-repo"`
- read `entry_file`, `notes_dir`, `[requests].inbox_dir`, `profiles.*.load`, and `profiles.*.stable_targets`
- report stable target, entry file, pointer, boundary, duplicate, and cleanup findings
- emit human-readable or JSON reports

## Commands

- `scripts/memory-lint.sh`

## Usage

```text
scripts/memory-lint.sh --memory-root /path/to/memory-repo
```

JSON report:

```text
scripts/memory-lint.sh --memory-root /path/to/memory-repo --json
```

Important options:

- `--memory-root`: required path containing `.pamem/config.toml`.
- `--json`: emit structured report.
- `--strict`: return exit code `1` when warnings are present.

Exit codes:

- `0`: no lint errors.
- `1`: lint errors, or warnings with `--strict`.
- `2`: invalid input, including missing config, invalid config, non-memory-repo config, or missing memory root.

## References

- `docs/superpowers/specs/2026-04-28-memory-lint-config-first-design.md`
- `DESIGN.md`
````

- [ ] **Step 4: Mark the migration draft as superseded**

At the top of `docs/drafts/2026-04-28-memory-lint-migration.md`, replace:

```markdown
Status: parked prototype
```

with:

```markdown
Status: superseded by config-first memory lint design
```

Add this paragraph after the date:

```markdown
This draft describes the shallow migration of the old prototype. The active design is now `docs/superpowers/specs/2026-04-28-memory-lint-config-first-design.md`, which removes V0 layout inference and legacy `.writeback/intents` behavior.
```

- [ ] **Step 5: Run targeted tests and stale-text checks**

Run:

```bash
python3 -m unittest tests.memory_lint.test_memory_lint
bash -n scripts/memory-lint.sh
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile scripts/memory_lint.py
rg -n "\\.writeback|--workspace|--intent|V0 stable|notes/agent-workflow|notes/user-preferences" scripts/memory_lint.py skills/memory-lint/SKILL.md README.md
```

Expected:

- unittest passes
- shell syntax check has no output
- py_compile has no output
- `rg` has no output

- [ ] **Step 6: Commit legacy cleanup and docs**

Run:

```bash
git add scripts/memory_lint.py README.md skills/memory-lint/SKILL.md docs/drafts/2026-04-28-memory-lint-migration.md
git commit -m "docs: update config-first memory lint usage"
```

## Task 6: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run full relevant tests**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest tests.memory_lint.test_memory_lint tests.memory_config.test_memory_config tests.memory_config.test_memory_session_start
```

Expected: PASS.

- [ ] **Step 2: Run script syntax checks**

Run:

```bash
bash -n scripts/memory-lint.sh scripts/memory-config.sh scripts/memory-session-start.sh scripts/memory-pre-compact.sh scripts/install-pamem.sh scripts/remove-pamem.sh scripts/repair-pamem.sh
```

Expected: no output.

- [ ] **Step 3: Run Python compile checks**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile scripts/memory_lint.py scripts/memory-config.py
```

Expected: no output.

- [ ] **Step 4: Remove Python cache directories if created**

Run:

```bash
rm -rf scripts/__pycache__ tests/memory_lint/__pycache__ tests/memory_config/__pycache__
```

Expected: no output.

- [ ] **Step 5: Confirm worktree status**

Run:

```bash
git status --short
```

Expected: no output.

- [ ] **Step 6: Commit final verification fixes only if needed**

If verification required code or doc fixes, commit them with:

```bash
git add scripts/memory_lint.py tests/memory_lint/test_memory_lint.py README.md skills/memory-lint/SKILL.md docs/drafts/2026-04-28-memory-lint-migration.md
git commit -m "fix: complete config-first memory lint verification"
```

If no files changed, do not create an empty commit.
