#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; payload="$ROOT/payload/extensions"
[[ -d "$payload/the-6k-extension" && -f "$payload/the-6k-extension/manifest.json" ]] || { echo 'The 6K payload missing'; exit 1; }
count=$(find "$payload" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' '); [[ "$count" == 1 ]] || { echo "Expected one extension payload, found $count"; exit 1; }
! find "$payload" -type d \( -name '*anime-episode*' -o -name '*immersionkit*' \) | grep -q . || { echo 'Unexpected legacy extension payload'; exit 1; }
python3 - "$payload/the-6k-extension/manifest.json" <<'PY'
import json,sys
m=json.load(open(sys.argv[1])); assert m['name']=='The 6K Extension'; assert m['manifest_version']==3
PY
grep -q 'extension=the-6k' "$payload/the-6k-extension/installer-probe.js"
! grep -R 'extension=anime\|extension=immersionkit' "$ROOT/macos" "$ROOT/windows" >/dev/null
grep -Fq '@"Google\Chrome\Application\chrome.exe"' "$ROOT/windows/Program.cs"
grep -Fq 'helper/yomitan-api-host.exe' "$ROOT/windows/AnimeStudyToolsInstaller.csproj"
grep -Fq 'build-windows-host.ps1' "$ROOT/build-windows.ps1"
grep -Fq 'The helper executable is' "$ROOT/README.md"
echo 'Windows helper EXE is generated only by build-windows.ps1 on Windows.'
echo 'native-app package check passed'
