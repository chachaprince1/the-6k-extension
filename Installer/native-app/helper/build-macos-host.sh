#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; OUT="$ROOT/macos/Resources/yomitan-api-host"; BUILD="$ROOT/.build/macos-host"; rm -rf "$BUILD"; mkdir -p "$BUILD"
python3 -m venv "$BUILD/venv"; "$BUILD/venv/bin/python" -m pip install --disable-pip-version-check --quiet pyinstaller==6.11.1
cp "$ROOT/helper/yomitan_api.py" "$BUILD/yomitan_api.py"; sed -i.bak 's#script_path = os.path.realpath(os.path.dirname(__file__))#script_path = (os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.realpath(os.path.dirname(__file__)))#' "$BUILD/yomitan_api.py"
"$BUILD/venv/bin/pyinstaller" --noconfirm --clean --onefile --name yomitan-api-host --distpath "$BUILD/dist" --workpath "$BUILD/work" --specpath "$BUILD/spec" "$BUILD/yomitan_api.py"; cp "$BUILD/dist/yomitan-api-host" "$OUT"; chmod 755 "$OUT"
