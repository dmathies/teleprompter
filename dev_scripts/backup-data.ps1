# Zips the writable show data: cues, annotations, edited scripts, and revision/settings state.
# Usage: powershell -File dev_scripts\backup-data.ps1 [-Root <app folder>] [-OutDir <folder>] [-IncludeScriptHistory]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string]$OutDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'backups'),
    [switch]$IncludeScriptHistory
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$state = 'scripts\teleprompter_state'
$items = @('show-cues', 'show-annotations', 'show-scripts',
    "$state\cue_revisions.json", "$state\annotation_revisions.json",
    "$state\department_settings.json", "$state\script_updates.json")
if ($IncludeScriptHistory) { $items += "$state\script_revisions" }

$stage = Join-Path ([IO.Path]::GetTempPath()) ('teleprompter-backup-' + [guid]::NewGuid())
try {
    foreach ($item in $items) {
        $source = Join-Path $Root $item
        if (-not (Test-Path $source)) { Write-Warning "Skipping missing $item"; continue }
        $target = Join-Path $stage $item
        New-Item -ItemType Directory -Force (Split-Path -Parent $target) | Out-Null
        Copy-Item $source $target -Recurse -Force -Exclude '*.lock', '.gitkeep'
    }
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $zip = Join-Path $OutDir ('teleprompter-data-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
    Write-Host "Backup written: $zip"
} finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
