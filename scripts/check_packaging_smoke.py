#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def fail(msg: str) -> None:
    print(f"[packaging-smoke] ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def info(msg: str) -> None:
    print(f"[packaging-smoke] {msg}")


def check_config_source(repo_root: Path) -> None:
    config_path = repo_root / "src-tauri" / "tauri.conf.json"
    if not config_path.exists():
        fail(f"missing config: {config_path}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    bundle = config.get("bundle") or {}
    resources = bundle.get("resources")
    if resources is None:
        fail("bundle.resources is missing")

    has_model_mapping = False
    if isinstance(resources, dict):
        for src, dst in resources.items():
            src_norm = src.replace("\\", "/").rstrip("/")
            dst_norm = str(dst).replace("\\", "/").rstrip("/")
            if src_norm.endswith("web/model") and dst_norm == "web/model":
                has_model_mapping = True
                break
    elif isinstance(resources, list):
        for src in resources:
            src_norm = str(src).replace("\\", "/")
            if src_norm.endswith("web/model") or src_norm.endswith("web/model/") or "web/model/**" in src_norm:
                has_model_mapping = True
                break
    else:
        fail("bundle.resources must be object or array")

    if not has_model_mapping:
        fail("bundle.resources does not include web/model packaging rule")

    source_model_dir = repo_root / "web" / "model"
    if not source_model_dir.is_dir():
        fail(f"missing source model directory: {source_model_dir}")

    manifest_count = sum(1 for _ in source_model_dir.rglob("manifest.json"))
    if manifest_count <= 0:
        fail("source model directory has no manifest.json")

    info(f"config/source check passed (manifest_count={manifest_count})")


def check_mac_app(app_path: Path) -> None:
    model_dir = app_path / "Contents" / "Resources" / "web" / "model"
    if not model_dir.is_dir():
        fail(f"missing bundled model dir in app: {model_dir}")

    manifest_count = sum(1 for _ in model_dir.rglob("manifest.json"))
    if manifest_count <= 0:
        fail(f"no manifest.json in bundled model dir: {model_dir}")

    info(f"mac app check passed for {app_path} (manifest_count={manifest_count})")


def file_contains_any(path: Path, patterns: list[bytes]) -> bool:
    max_pat = max(len(p) for p in patterns)
    overlap = b""
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                return False
            data = overlap + chunk
            for p in patterns:
                if p in data:
                    return True
            overlap = data[-(max_pat - 1):] if max_pat > 1 else b""


def check_windows_artifacts(artifacts: list[Path]) -> None:
    if not artifacts:
        fail("no windows artifacts provided")

    path_markers = [b"web/model/", b"web\\model\\"]
    manifest_marker = [b"manifest.json"]

    for artifact in artifacts:
        if not artifact.exists():
            fail(f"artifact not found: {artifact}")
        if not file_contains_any(artifact, path_markers):
            fail(f"artifact missing web/model marker: {artifact}")
        if not file_contains_any(artifact, manifest_marker):
            fail(f"artifact missing manifest.json marker: {artifact}")
        info(f"windows artifact check passed: {artifact}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Packaging smoke gate for ArkDock resources")
    parser.add_argument(
        "--check",
        required=True,
        choices=["config-source", "mac-app", "windows-artifact"],
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--app")
    parser.add_argument("--artifact", action="append", default=[])
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()

    if args.check == "config-source":
        check_config_source(repo_root)
    elif args.check == "mac-app":
        if not args.app:
            fail("--app is required for --check mac-app")
        check_mac_app(Path(args.app).resolve())
    elif args.check == "windows-artifact":
        check_windows_artifacts([Path(a).resolve() for a in args.artifact])


if __name__ == "__main__":
    main()
