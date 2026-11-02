# Installs the Pocket theme into Spicetify and applies it. Spotify itself is only patched by `spicetify apply`;
# `spicetify restore` undoes that.
#
#   .\install.ps1                  Night (P11), the default
#   .\install.ps1 -Scheme cream    Cream (P9)
#   .\install.ps1 -NoApply         copy the theme and select it, but don't patch Spotify yet
param(
  [ValidateSet("night", "cream")] [string]$Scheme = "night",
  [switch]$NoApply
)
$ErrorActionPreference = "Stop"

$spicetify = (Get-Command spicetify -ErrorAction SilentlyContinue).Source
if (-not $spicetify) { $spicetify = Join-Path $env:LOCALAPPDATA "spicetify\spicetify.exe" }
if (-not (Test-Path $spicetify)) { throw "Spicetify isn't installed. See https://spicetify.app/docs/getting-started" }

$dest = Join-Path (& $spicetify path userdata) "Themes\Pocket"
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $PSScriptRoot "Pocket\*") $dest -Recurse -Force
Write-Host "Copied Pocket to $dest"

& $spicetify config current_theme Pocket color_scheme $Scheme inject_css 1 replace_colors 1 inject_theme_js 1
Write-Host "Theme set to Pocket ($Scheme)"

if ($NoApply) { Write-Host "Skipped apply. Run: spicetify apply"; return }

# -n: don't restart Spotify; a running copy keeps its old look until you restart it
& $spicetify -n apply
if (Get-Process -Name Spotify -ErrorAction SilentlyContinue) {
  Write-Host "Spotify is running: quit it from the tray and open it again to see Pocket."
} else {
  Write-Host "Done. Open Spotify to see Pocket."
}
