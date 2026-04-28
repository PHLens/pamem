#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
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


def ensure_common_header(data: dict, path: Path) -> str:
    schema_version = require_string(data, "schema_version", path)
    if schema_version != SCHEMA_VERSION:
        raise ConfigError(f"{path}: unsupported schema_version {schema_version!r}; expected {SCHEMA_VERSION!r}")
    kind = require_string(data, "kind", path)
    if kind not in {"source", "memory-repo"}:
        raise ConfigError(f"{path}: invalid kind {kind!r}; expected 'source' or 'memory-repo'")
    return kind


def source_table(data: dict, config_path: Path) -> dict:
    source = data.get("source")
    if not isinstance(source, dict):
        raise ConfigError(f"{config_path}: field 'source' must be a table")
    source_type = source.get("type")
    if not isinstance(source_type, str) or source_type not in {"local", "git"}:
        raise ConfigError(f"{config_path}: source.type must be 'local' or 'git'")
    return source


def relative_source_path(bootstrap_root: Path, raw: str, field: str) -> Path:
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise ConfigError(f"{field} must be relative: {raw}")
    return (bootstrap_root / path).resolve()


def ensure_under_pamem(bootstrap_root: Path, raw: str, field: str) -> dict:
    path = Path(raw).expanduser()
    if path.is_absolute():
        raise ConfigError(f"{field} must be relative: {raw}")
    resolved = (bootstrap_root / path).resolve()
    pamem_root = (bootstrap_root / ".pamem").resolve()
    try:
        resolved.relative_to(pamem_root)
    except ValueError as exc:
        raise ConfigError(f"{field} must stay under .pamem: {raw}") from exc
    return {"raw": raw, "resolved": str(resolved), "exists": resolved.exists()}


def run_git(args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        command = "git " + " ".join(args)
        raise ConfigError(f"{command} failed with {result.returncode}: {result.stderr.strip() or result.stdout.strip()}")
    return result


def ensure_git_work_tree(memory_root: Path, config_path: Path, local_raw: str) -> None:
    try:
        result = run_git(["-C", str(memory_root), "rev-parse", "--show-toplevel"])
    except ConfigError as exc:
        raise ConfigError(
            f"{config_path}: source.local_path exists but is not a git repository/work tree: {local_raw}"
        ) from exc
    git_root = Path(result.stdout.strip()).resolve()
    if git_root != memory_root.resolve():
        raise ConfigError(
            f"{config_path}: source.local_path is not the git repository root: {local_raw}"
        )


def validate_source(bootstrap_root: Path) -> dict:
    config_path = bootstrap_root / CONFIG_RELATIVE_PATH
    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind != "source":
        raise ConfigError(f"{config_path}: expected kind 'source', found {kind!r}")
    source = source_table(data, config_path)
    if source["type"] == "local":
        return validate_local_source(bootstrap_root, config_path, source)
    return validate_git_source(bootstrap_root, config_path, source)


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


def validate_git_source(bootstrap_root: Path, config_path: Path, source: dict) -> dict:
    remote = source.get("remote")
    if not isinstance(remote, str) or not remote.strip():
        raise ConfigError(f"{config_path}: source.remote must be a non-empty string")
    ref = source.get("ref", "main")
    if not isinstance(ref, str) or not ref.strip():
        raise ConfigError(f"{config_path}: source.ref must be a non-empty string")
    local_raw = source.get("local_path", ".pamem/memory")
    if not isinstance(local_raw, str) or not local_raw.strip():
        raise ConfigError(f"{config_path}: source.local_path must be a non-empty string")

    local_path = ensure_under_pamem(bootstrap_root, local_raw, "source.local_path")
    memory_root = Path(local_path["resolved"])
    if not memory_root.exists():
        memory_root.parent.mkdir(parents=True, exist_ok=True)
        run_git(["clone", "--branch", ref, remote, str(memory_root)], cwd=bootstrap_root)
        local_path["exists"] = True

    ensure_git_work_tree(memory_root, config_path, local_raw)

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
            "local_path": local_path,
        },
        "memory_repo": memory_report,
        "summary": memory_report["summary"],
        "warnings": memory_report["warnings"],
        "errors": [],
        "diagnostic": f"Memory source: git -> {memory_root}",
    }


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
    inbox_is_configured = "inbox_dir" in requests_raw
    inbox_raw = requests_raw.get("inbox_dir", "requests/inbox")
    if not isinstance(inbox_raw, str) or not inbox_raw.strip():
        raise ConfigError(f"{config_path}: field 'requests.inbox_dir' must be a non-empty string")
    inbox_dir = relative_repo_path(root, inbox_raw, "requests.inbox_dir")
    if inbox_is_configured and not inbox_dir["exists"]:
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

    report = {
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
            "config_kind": None,
            "summary": summary([], []),
            "warnings": [],
            "errors": [],
            "diagnostic": "Memory config: absent, using V0 layout",
        }

    data = load_toml(config_path)
    kind = ensure_common_header(data, config_path)
    if kind == "memory-repo":
        return validate_memory_repo(root)
    return validate_source(root)


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
            "summary": summary([], [str(exc)]),
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
