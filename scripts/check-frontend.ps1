$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

# Equivalent to npm run lint && npm test && npm run build, with the required pre-test memory gate.
# Never continue after a failed command (including any worker/process crash).
& npm.cmd run lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$available = [math]::Floor((Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue)
Write-Output "Available MBytes before Vitest: $available"
if ($available -lt 1500) {
  Write-Output 'Vitest was not started: at least 1500 Available MBytes is required.'
  exit 2
}
& npm.cmd test -- --maxWorkers=2 --bail=1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& npm.cmd run build
exit $LASTEXITCODE
