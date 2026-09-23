$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root '.build\windows-host'
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $build | Out-Null
python -m venv (Join-Path $build 'venv')
$python = Join-Path $build 'venv\Scripts\python.exe'
& $python -m pip install --disable-pip-version-check pyinstaller==6.11.1
$source = Join-Path $build 'yomitan_api.py'
$helper = [IO.File]::ReadAllText((Join-Path $root 'helper\yomitan_api.py')).Replace('script_path = os.path.realpath(os.path.dirname(__file__))', 'script_path = (os.path.dirname(os.path.abspath(sys.executable)) if getattr(sys, "frozen", False) else os.path.realpath(os.path.dirname(__file__)))')
[IO.File]::WriteAllText($source, $helper, [Text.UTF8Encoding]::new($false))
& (Join-Path $build 'venv\Scripts\pyinstaller.exe') --noconfirm --clean --onefile --name yomitan-api-host --distpath (Join-Path $build 'dist') --workpath (Join-Path $build 'work') --specpath (Join-Path $build 'spec') $source
New-Item -ItemType Directory -Force (Join-Path $root 'windows\resources') | Out-Null
Copy-Item (Join-Path $build 'dist\yomitan-api-host.exe') (Join-Path $root 'windows\resources\yomitan-api-host.exe') -Force
