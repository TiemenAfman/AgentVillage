<#
.SYNOPSIS
  Bouwt Promptholm tot een losstaande Windows-build (.exe + .pck + .NET-runtime) en
  zipt die als beta-release die je kunt doorgeven.

.DESCRIPTION
  Draait de hele keten headless, zonder de Godot-editor te openen:

    1. dotnet build       - zodat een C#-fout hier stukloopt en niet halverwege de export
    2. godot --import     - vult de .godot-cache op een schone checkout
    3. godot --export-*   - gebruikt preset "Windows Desktop" uit godot/export_presets.cfg
    4. Compress-Archive   - dist/Promptholm-<versie>-win64.zip

  Vereist eenmalig de export-templates van exact deze Godot-versie. Ontbreken ze, dan
  stopt het script met de download-URL; met -InstallTemplates haalt het ze zelf op
  (~1 GB voor de mono-templates). In de editor kan het ook:
  Editor > Manage Export Templates.

  De build start zonder de localserver: VillageClient valt terug op res://village.json,
  dus een betatester ziet het dorp zoals het op het moment van builden in git stond.

.EXAMPLE
  ./scripts/build.ps1
  ./scripts/build.ps1 -Version 0.3.0-beta
  ./scripts/build.ps1 -InstallTemplates
  ./scripts/build.ps1 -DebugBuild -SkipZip
#>
[CmdletBinding()]
param(
    [string] $Version,
    [string] $OutDir,
    [string] $Preset = 'Windows Desktop',
    [string] $Godot = 'D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe',
    [switch] $DebugBuild,
    [switch] $SkipBuild,
    [switch] $SkipZip,
    [switch] $InstallTemplates
)

$ErrorActionPreference = 'Stop'

$repo     = Split-Path -Parent $PSScriptRoot
$godotDir = Join-Path $repo 'godot'

if (-not (Test-Path $Godot)) { throw "Godot niet gevonden op $Godot (overschrijf met -Godot)" }
if (-not (Test-Path (Join-Path $godotDir 'export_presets.cfg'))) {
    throw "godot/export_presets.cfg ontbreekt - zonder preset kan Godot niet exporteren."
}
# Zonder solution slaat de .NET-exportplugin ELKE C#-assembly over en levert de export
# doodleuk een .exe + .pck zonder code op - exitcode 0 en al. Vandaar de check vooraf
# en de assembly-check achteraf.
if (-not (Test-Path (Join-Path $godotDir 'Promptholm.sln'))) {
    throw @"
godot/Promptholm.sln ontbreekt. De .NET-exportplugin eist een solution; zonder komt er een
build uit zonder enige C#-code. Haal hem terug uit git, of maak hem opnieuw:
  dotnet new sln -n Promptholm --format sln   # zonder --format levert dotnet 10 een .slnx
  dotnet sln Promptholm.sln add Promptholm.csproj
en vul de configuraties ExportDebug/ExportRelease aan.
"@
}

# ---- versie -----------------------------------------------------------------
if (-not $Version) {
    $sha = (& git -C $repo rev-parse --short HEAD).Trim()
    $Version = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd'), $sha
    if (& git -C $repo status --porcelain) { $Version += '-dirty' }
}
if (-not $OutDir) { $OutDir = Join-Path $repo 'dist' }

$stageDir = Join-Path $OutDir 'win64'
$exePath  = Join-Path $stageDir 'Promptholm.exe'

Write-Host "Promptholm $Version" -ForegroundColor Green
Write-Host "  preset : $Preset"
Write-Host "  uitvoer: $stageDir"

# ---- export-templates -------------------------------------------------------
# "4.7.2.stable.mono.official.ed1daf0bf" -> mapnaam "4.7.2.stable.mono"
$godotVersion = (& $Godot --version | Select-Object -Last 1).Trim()
$templateName = $godotVersion -replace '\.(official|custom_build).*$', ''
$templateDir  = Join-Path $env:APPDATA "Godot\export_templates\$templateName"

if (-not (Test-Path (Join-Path $templateDir 'windows_release_x86_64.exe'))) {
    $tpzVersion = $templateName -replace '\.mono$', ''      # 4.7.2.stable
    $tag        = ($tpzVersion -replace '\.stable$', '') + '-stable'
    $tpzName    = "Godot_v$tag" + '_mono_export_templates.tpz'
    $tpzUrl     = "https://github.com/godotengine/godot/releases/download/$tag/$tpzName"

    if (-not $InstallTemplates) {
        throw @"
Export-templates voor $templateName ontbreken in $templateDir.
Installeer ze eenmalig, op een van deze manieren:
  - dit script opnieuw met -InstallTemplates (downloadt ~1 GB)
  - Godot-editor: Editor > Manage Export Templates > Download and Install
  - handmatig: $tpzUrl uitpakken naar $templateDir
"@
    }

    Write-Host "Export-templates downloaden ($tpzName, ~1 GB)..." -ForegroundColor Cyan
    $tmp = Join-Path $env:TEMP "promptholm-templates"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $tpz = Join-Path $tmp $tpzName
    # Een afgebroken poging opnieuw uitpakken hoeft niet nog eens een gigabyte te kosten.
    if ((Test-Path $tpz) -and (Get-Item $tpz).Length -gt 500MB) {
        Write-Host "Bestaande download hergebruikt: $tpz" -ForegroundColor DarkGray
    }
    else {
        # curl.exe hoort bij Windows 10/11 en streamt ruim sneller dan Invoke-WebRequest;
        # IWR is de terugval, met de progressbalk uit omdat die in PS 5.1 een download van
        # deze omvang tientallen keren trager maakt. Geen --progress-bar bij curl: die
        # schrijft duizenden regels naar een logbestand zodra dit niet in een terminal draait.
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
            & curl.exe -L --fail --silent --show-error -o $tpz $tpzUrl
            if ($LASTEXITCODE -ne 0) { throw "download van $tpzUrl faalde (curl $LASTEXITCODE)" }
        }
        else {
            $oldProgress = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            try { Invoke-WebRequest -Uri $tpzUrl -OutFile $tpz -UseBasicParsing }
            finally { $ProgressPreference = $oldProgress }
        }
    }

    # Een .tpz is een gewone zip met alles in een map "templates/" - maar Expand-Archive
    # kijkt naar de extensie en weigert alles wat geen .zip heet, vandaar ZipFile.
    Write-Host 'Uitpakken...' -ForegroundColor Cyan
    $unzip = Join-Path $tmp 'unzip'
    if (Test-Path $unzip) { Remove-Item -Recurse -Force $unzip }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($tpz, $unzip)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $templateDir) | Out-Null
    if (Test-Path $templateDir) { Remove-Item -Recurse -Force $templateDir }
    Move-Item -LiteralPath (Join-Path $unzip 'templates') -Destination $templateDir
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Write-Host "Templates geinstalleerd in $templateDir" -ForegroundColor Green
}

# ---- C#-build ---------------------------------------------------------------
if (-not $SkipBuild) {
    Write-Host 'Bouwen (dotnet)...' -ForegroundColor Cyan
    & dotnet build (Join-Path $godotDir 'Promptholm.csproj') -c ExportRelease -v q --nologo
    if ($LASTEXITCODE -ne 0) { throw 'dotnet build faalde' }
}

# ---- import ----------------------------------------------------------------
# Op een schone checkout bestaat .godot/ niet en exporteert Godot een lege .pck.
Write-Host 'Resources importeren...' -ForegroundColor Cyan
& $Godot --headless --path $godotDir --import | Out-Null

# ---- export ----------------------------------------------------------------
if (Test-Path $stageDir) { Remove-Item -Recurse -Force $stageDir }
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

$mode = 'release'
if ($DebugBuild) { $mode = 'debug' }
Write-Host "Exporteren ($mode)..." -ForegroundColor Cyan
& $Godot --headless --path $godotDir "--export-$mode" $Preset $exePath
$exportExit = $LASTEXITCODE

if (-not (Test-Path $exePath)) {
    throw "Export leverde geen $exePath op (godot exit $exportExit). Draai zonder --headless of kijk in de uitvoer hierboven."
}
# De export meldt ontbrekende .NET-assemblies alleen als "completed with warnings" en eindigt
# met exit 0. Een build zonder Promptholm.dll start wel en doet niets, dus: hier stuklopen.
if (-not (Get-ChildItem -Recurse -File -Filter 'Promptholm.dll' $stageDir)) {
    throw "Export bevat geen Promptholm.dll - de C#-assemblies zijn niet meegekomen. Zoek in de uitvoer hierboven naar 'Export .NET Project'."
}

# ---- meeleverbestanden ------------------------------------------------------
Set-Content -Path (Join-Path $stageDir 'VERSION.txt') `
    -Value "Promptholm $Version`r`nGodot $godotVersion`r`ngebouwd $(Get-Date -Format 'yyyy-MM-dd HH:mm')" `
    -Encoding utf8

$readme = @"
Promptholm - beta $Version

Starten:  Promptholm.exe
Logs:     Promptholm.console.exe (zelfde spel, met een consolevenster erbij)

Windows SmartScreen kan waarschuwen dat de uitgever onbekend is; deze build is niet
ondertekend. Via "Meer informatie" > "Toch uitvoeren" start hij gewoon.

Het eiland komt uit village.json die in deze build zit. Draait de localserver
(npm start, poort 4747) op dezelfde machine, dan pakt hij die live op en ververst
het dorp elke 5 seconden.

Besturing en sneltoetsen staan in README.md in de repo.
"@
Set-Content -Path (Join-Path $stageDir 'LEESMIJ.txt') -Value $readme -Encoding utf8

$size = '{0:N1} MB' -f ((Get-ChildItem -Recurse -File $stageDir | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "Build klaar: $stageDir ($size)" -ForegroundColor Green

