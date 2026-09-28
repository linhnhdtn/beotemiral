#!/usr/bin/env python3
"""Install per-user Linux shortcuts without launching the application."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def exec_argument(value: str) -> str:
    # Desktop Entry string escaping is applied before Exec argument parsing.
    quoted = value.replace("\\", "\\\\").replace('"', '\\"')
    quoted = quoted.replace("$", "\\$").replace("`", "\\`").replace("%", "%%")
    return '"' + quoted.replace("\\", "\\\\") + '"'


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-sandbox", action="store_true", help="For hosts that block the Chromium sandbox")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent.parent
    manifest = json.loads((project / "package.json").read_text())
    executable = project / manifest["build"]["directories"]["output"] / "linux-unpacked/task-harbor"
    source_icon = project / "resources/icon.png"
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise SystemExit("Chưa có bản đóng gói. Chạy npm run dist trước.")
    if not source_icon.is_file():
        raise SystemExit("Không tìm thấy resources/icon.png.")

    data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
    applications = data_home / "applications"
    icon = data_home / "icons/hicolor/512x512/apps/dev.taskharbor.png"
    launcher = applications / "dev.taskharbor.desktop"
    command = exec_argument(str(executable)) + (" --no-sandbox" if args.no_sandbox else "")
    content = "\n".join([
        "[Desktop Entry]",
        "Version=1.0",
        "Type=Application",
        "Name=Task Harbor",
        "GenericName=Terminal and AI agent manager",
        "GenericName[vi]=Quản lý terminal và AI agent",
        "Comment=Quản lý task, nhóm terminal và AI agent trên máy",
        f"Exec={command}",
        f"Icon={icon}",
        "Terminal=false",
        "StartupNotify=true",
        "StartupWMClass=dev.taskharbor",
        "Categories=Development;",
        "Keywords=terminal;task;agent;AI;workspace;",
        "",
    ])
    validator = shutil.which("desktop-file-validate")
    if validator:
        with tempfile.TemporaryDirectory(prefix="harbor-shortcut-") as temporary:
            candidate = Path(temporary) / "dev.taskharbor.desktop"
            candidate.write_text(content, encoding="utf-8")
            subprocess.run([validator, str(candidate)], check=True)

    applications.mkdir(parents=True, exist_ok=True)
    icon.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_icon, icon)
    launcher.write_text(content, encoding="utf-8")
    launcher.chmod(0o755)
    print(f"Menu ứng dụng: {launcher}")

    desktop = None
    if shutil.which("xdg-user-dir"):
        result = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, check=True)
        if result.stdout.strip():
            desktop = Path(result.stdout.strip())
    elif (Path.home() / "Desktop").is_dir():
        desktop = Path.home() / "Desktop"
    if desktop and desktop != Path.home():
        desktop.mkdir(parents=True, exist_ok=True)
        shortcut = desktop / "Task Harbor.desktop"
        shutil.copyfile(launcher, shortcut)
        shortcut.chmod(0o755)
        if shutil.which("gio"):
            trusted = subprocess.run(["gio", "set", str(shortcut), "metadata::trusted", "true"], capture_output=True, text=True)
            if trusted.returncode:
                print("Desktop: bấm chuột phải shortcut rồi chọn Allow Launching nếu được hỏi.")
        print(f"Biểu tượng desktop: {shortcut}")

    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(applications)], check=True)
    print("Đã cài shortcut. Ứng dụng chưa được mở.")


if __name__ == "__main__":
    main()
