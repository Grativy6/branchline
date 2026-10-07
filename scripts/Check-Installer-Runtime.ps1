param(
  [Parameter(Mandatory)][string]$Compiler,
  [Parameter(Mandatory)][string]$OutputFolder
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = [IO.Path]::GetFullPath($OutputFolder)
if (Test-Path -LiteralPath $taskOutput) { throw 'Choose a new diagnostic output folder.' }
$taskSignature = Get-AuthenticodeSignature -LiteralPath $Compiler
if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'Pyrsys B.V.') { throw 'Use the verified Inno compiler.' }
New-Item -ItemType Directory -Path $taskOutput | Out-Null
$taskResults = foreach ($taskArchitecture in @('x86','x64')) {
  $taskArguments = @('/Qp','/DSelfTest',('/DProbeArchitecture='+$taskArchitecture),('/DProbeOutput='+$taskOutput),(Join-Path $taskRoot 'installer\Diagnose-Runtime.iss'))
  & $Compiler @taskArguments
  if ($LASTEXITCODE -ne 0) { throw 'Runtime diagnostic did not compile.' }
  $taskExe = Join-Path $taskOutput ('Branchline-Runtime-Check-'+$taskArchitecture+'.exe')
  $taskLog = Join-Path $taskOutput ($taskArchitecture+'.log')
  $taskProcess = Start-Process -FilePath $taskExe -ArgumentList @('/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/LOG="'+$taskLog+'"')) -Wait -PassThru -WindowStyle Hidden
  $taskText = Get-Content -LiteralPath $taskLog -Raw
  # InitializeSetup returns False intentionally; Inno reports its no-install abort.
  if ($taskProcess.ExitCode -ne 1 -or $taskText -notmatch 'ALL_RUNTIME_CASES_PASS' -or $taskText -notmatch 'READ_ONLY_DIAGNOSTIC_COMPLETE') { throw 'Diagnostic failed; retain the log.' }
  [pscustomobject]@{architecture=$taskArchitecture;behaviorCases='PASS';nativeRuntimePresent=($taskText -match 'RUNTIME_CHECK=PASS');exitCode=$taskProcess.ExitCode;exeSha256=(Get-FileHash -LiteralPath $taskExe).Hash.ToLowerInvariant();logSha256=(Get-FileHash -LiteralPath $taskLog).Hash.ToLowerInvariant()}
}
@{kind='COMPILED_READ_ONLY_CHECKS_WITH_SIMULATED_INSTALLER_RESULTS';results=$taskResults;sharedRuntimeInstallationRun=$false} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskOutput 'results.json') -Encoding utf8
$taskResults | ConvertTo-Json
