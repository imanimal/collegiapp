# Writes the Pocket styles into Windhawk's settings for the three styler mods, the same values that
# Settings › Textual mode › Save settings would write. Run it from an elevated PowerShell after installing the
# mods in Windhawk; each mod picks up its new settings within a second or two, without restarting Explorer.
#
#   powershell -ExecutionPolicy Bypass -File integrations\windhawk-pocket\apply.ps1           # all three
#   powershell -ExecutionPolicy Bypass -File integrations\windhawk-pocket\apply.ps1 taskbar   # just these
#
# It reads the YAML files next to it, which use a small subset of YAML: top-level keys holding a list of strings
# or of { target, styles } entries, and top-level scalars. A mod that isn't installed is skipped.
param([Parameter(ValueFromRemainingArguments)][string[]]$Only)

$ErrorActionPreference = 'Stop'
$mods = [ordered]@{
  'taskbar'             = 'windows-11-taskbar-styler'
  'start-menu'          = 'windows-11-start-menu-styler'
  'notification-center' = 'windows-11-notification-center-styler'
}
$root = 'HKLM:\SOFTWARE\Windhawk\Engine\Mods'

function Read-PocketYaml([string]$path) {
  $out = [ordered]@{}
  $top = $null; $i = -1; $s = -1
  foreach ($raw in Get-Content -LiteralPath $path -Encoding UTF8) {
    $line = $raw.TrimEnd()
    if ($line -eq '' -or $line -match '^\s*#') { continue }
    if ($line -match '^([A-Za-z]\w*):\s*(.*)$') {
      $top = $Matches[1]; $i = -1; $s = -1
      if ($Matches[2] -ne '') { $out[$top] = $Matches[2] }
    } elseif ($line -match '^  - target:\s*(.+)$') {
      $i++; $s = -1; $out["$top[$i].target"] = $Matches[1]
    } elseif ($line -match '^    styles:\s*$') {
    } elseif ($line -match '^      - (.+)$') {
      $s++; $out["$top[$i].styles[$s]"] = $Matches[1]
    } elseif ($line -match '^  - (.+)$') {
      $i++; $out["$top[$i]"] = $Matches[1]
    } else {
      throw "${path}: can't read this line: $raw"
    }
  }
  $out
}

foreach ($name in $mods.Keys) {
  if ($Only -and $Only -notcontains $name) { continue }
  $id = $mods[$name]
  if (-not (Test-Path "$root\$id")) { Write-Host "$id isn't installed; skipped."; continue }
  $values = Read-PocketYaml (Join-Path $PSScriptRoot "$name.yaml")
  # Point the Assets constant at the images next to this script.
  $assets = ([Uri](Join-Path $PSScriptRoot 'assets')).AbsoluteUri
  foreach ($k in @($values.Keys)) {
    if ($k -like 'styleConstants*' -and $values[$k] -like 'Assets=*') { $values[$k] = "Assets=$assets" }
  }
  # The registry API directly: PowerShell's *-ItemProperty cmdlets read the [ ] in these names as wildcards.
  $key = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey("SOFTWARE\Windhawk\Engine\Mods\$id\Settings")
  # Clear the list settings this file manages, then write the new ones.
  $lists = $values.Keys | ForEach-Object { ($_ -split '\[')[0] } | Select-Object -Unique
  $key.GetValueNames() | Where-Object { $_ -match '\[' -and ($_ -split '\[')[0] -in $lists } |
    ForEach-Object { $key.DeleteValue($_) }
  foreach ($k in $values.Keys) { $key.SetValue($k, $values[$k], [Microsoft.Win32.RegistryValueKind]::String) }
  $key.Close()
  # Windhawk reloads a mod's settings when this changes.
  Set-ItemProperty -Path "$root\$id" -Name SettingsChangeTime -Value ([int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Type DWord
  Write-Host "${id}: $($values.Count) settings written."
}
