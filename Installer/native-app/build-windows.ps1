$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = $PSScriptRoot
$hostBuild = Join-Path $root 'helper\build-windows-host.ps1'
$hostExecutable = Join-Path $root 'windows\resources\yomitan-api-host.exe'
$project = Join-Path $root 'windows\AnimeStudyToolsInstaller.csproj'
$output = Join-Path $root 'dist\windows'

if (-not (Test-Path -LiteralPath $hostBuild -PathType Leaf)) {
    throw "Windows helper build script is missing: $hostBuild"
}
if (-not (Test-Path -LiteralPath $project -PathType Leaf)) {
    throw "Windows installer project is missing: $project"
}

& $hostBuild
if ($LASTEXITCODE -ne 0) {
    throw "Building the Windows Yomitan helper failed with exit code $LASTEXITCODE."
}
if (-not (Test-Path -LiteralPath $hostExecutable -PathType Leaf) -or (Get-Item -LiteralPath $hostExecutable).Length -eq 0) {
    throw "The Windows helper build did not produce a non-empty executable: $hostExecutable"
}

Remove-Item -LiteralPath $output -Recurse -Force -ErrorAction SilentlyContinue
& dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $output
if ($LASTEXITCODE -ne 0) {
    throw "Publishing the Windows installer failed with exit code $LASTEXITCODE."
}

$installer = Join-Path $output 'The6KExtensionInstaller.exe'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf) -or (Get-Item -LiteralPath $installer).Length -eq 0) {
    throw "dotnet publish did not produce a non-empty installer: $installer"
}

$checksum = Get-FileHash -LiteralPath $installer -Algorithm SHA256
$checksumPath = "$installer.sha256"
"$($checksum.Hash.ToLowerInvariant()) *$([IO.Path]::GetFileName($installer))" | Set-Content -LiteralPath $checksumPath -NoNewline
Write-Host "Created $installer"
Write-Host "Created $checksumPath"
