# Keeps quick-tunnel alive + auto-syncs Retell when URL changes.
# Use UNTIL you have a Cloudflare domain and run setup-named-tunnel.ps1.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-tunnel-watchdog.ps1
#
# Runs in background (hidden window). To stop: Get-Job | Stop-Job; Get-Job | Remove-Job
param(
  [int]$IntervalSec = 120
)

$script = Join-Path $PSScriptRoot "tunnel-watchdog.ps1"
$log = Join-Path $PSScriptRoot "tunnel-watchdog.log"

Write-Host "Starting tunnel watchdog (quick-tunnel mode)..."
Write-Host "Log: $log"
Write-Host "Stop: Get-Job | Stop-Job"

Start-Job -Name "tunnel-watchdog" -ScriptBlock {
  param($WatchdogScript, $Interval)
  & powershell -ExecutionPolicy Bypass -File $WatchdogScript -IntervalSec $Interval
} -ArgumentList $script, $IntervalSec | Out-Null

Write-Host "Watchdog running in background (Job: tunnel-watchdog)."
