<#
.SYNOPSIS
  Renders the Promptholm screenshot matrix: every viewpoint at every hour, plus a contact
  sheet, so a visual change can be judged instead of guessed at.

.DESCRIPTION
  The nine Verify*Runners assert numbers. That is how "20 visual checks green" and an
  unusable screenshot came to coexist. This is the harness that looks at the result.

  Must run WITHOUT --headless: headless selects the dummy rendering driver and the viewport
  texture comes back empty. ScreenshotRunner detects that and fails rather than writing a
  black PNG.

.EXAMPLE
  ./scripts/shots.ps1
  ./scripts/shots.ps1 -Shots overlook,harbour -Hours 12.5,23.0
  ./scripts/shots.ps1 -Label before
#>
[CmdletBinding()]
param(
    [string[]] $Shots = @('overlook', 'harbour', 'street', 'lighthouse'),
    [double[]] $Hours = @(6.4, 9.0, 12.5, 18.2, 20.2, 23.0),
    [string]   $Size = '1600x1000',
    [string]   $Label,
    [string]   $Godot = 'D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe',
    [switch]   $SkipBuild
)

$ErrorActionPreference = 'Stop'

$repo     = Split-Path -Parent $PSScriptRoot
$godotDir = Join-Path $repo 'godot'

if (-not (Test-Path $Godot)) { throw "Godot not found at $Godot (override with -Godot)" }

if (-not $Label) {
    $sha = (& git -C $repo rev-parse --short HEAD).Trim()
    $dirty = ''
    if (& git -C $repo status --porcelain) { $dirty = '-dirty' }
    $Label = "$sha$dirty"
}

$outDir = Join-Path $repo "docs/shots/$Label"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not $SkipBuild) {
    Write-Host 'Building...' -ForegroundColor Cyan
    & dotnet build (Join-Path $godotDir 'Promptholm.csproj') -v q --nologo
    if ($LASTEXITCODE -ne 0) { throw 'build failed' }
}

$total = $Shots.Count * $Hours.Count
$done = 0
$failed = @()

foreach ($shot in $Shots) {
    foreach ($hour in $Hours) {
        $done++
        # InvariantCulture: on a Dutch locale '{0:00.0}' yields "06,4" and commas in filenames
        # are nobody's friend.
        $stamp = [string]::Format([cultureinfo]::InvariantCulture, '{0:00.0}', $hour).Replace('.', '')
        $file = Join-Path $outDir "${shot}_$stamp.png"
        Write-Host ("[{0}/{1}] {2} @ {3}h" -f $done, $total, $shot, $hour) -ForegroundColor Cyan

        # --fixed-fps makes the capture deterministic: the water shader animates on TIME, so
        # without it every run catches a different instant and two shots of identical code do
        # not match. With it, repeated runs are bit-for-bit identical, which is what makes a
        # before/after comparison mean anything.
        #
        # NOTE: no --headless. See the description above.
        # NOTE: no 2>&1 either. In Windows PowerShell, redirecting a native command's stderr
        # wraps every line in a NativeCommandError, which $ErrorActionPreference='Stop' then
        # treats as fatal. Let stderr through and judge the run by whether the PNG exists.
        & $Godot --path $godotDir --fixed-fps 60 --script res://src/Tools/ScreenshotRunner.cs -- `
            --hour ([string]::Format([cultureinfo]::InvariantCulture, '{0}', $hour)) `
            --shot $shot --size $Size --out $file | Out-Null

        if (-not (Test-Path $file)) { $failed += "$shot@$hour" }
    }
}

# ---- contact sheet ----------------------------------------------------------
$rows = foreach ($shot in $Shots) {
    $cells = foreach ($hour in $Hours) {
        $stamp = [string]::Format([cultureinfo]::InvariantCulture, '{0:00.0}', $hour).Replace('.', '')
        "<figure><img src=`"${shot}_$stamp.png`" loading=`"lazy`"><figcaption>$hour h</figcaption></figure>"
    }
    "<section><h2>$shot</h2><div class=`"row`">$($cells -join '')</div></section>"
}

$html = @"
<title>Promptholm shots - $Label</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #14161a; color: #e8e6e1;
         font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  p.meta { color: #8b8b8b; margin: 0 0 24px; }
  h2 { font-size: 14px; font-weight: 600; color: #d9b85c; margin: 24px 0 8px;
       text-transform: uppercase; letter-spacing: .08em; }
  .row { display: grid; grid-template-columns: repeat($($Hours.Count), 1fr); gap: 8px; }
  figure { margin: 0; }
  img { width: 100%; display: block; border-radius: 4px; background: #000; }
  figcaption { color: #8b8b8b; font-size: 12px; padding-top: 4px; }
  @media (max-width: 900px) { .row { grid-template-columns: repeat(2, 1fr); } }
</style>
<h1>Promptholm - $Label</h1>
<p class="meta">$(Get-Date -Format 'yyyy-MM-dd HH:mm') &middot; $total shots &middot; $Size</p>
$($rows -join "`n")
"@

$indexPath = Join-Path $outDir 'index.html'
Set-Content -Path $indexPath -Value $html -Encoding utf8

if ($failed.Count -gt 0) {
    Write-Host "FAILED: $($failed -join ', ')" -ForegroundColor Red
    exit 1
}

Write-Host "`nWrote $total shots to $outDir" -ForegroundColor Green
Write-Host "Contact sheet: $indexPath" -ForegroundColor Green
