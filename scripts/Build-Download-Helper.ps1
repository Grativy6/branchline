param(
  [Parameter(Mandatory)][string]$InstallerReceipt,
  [Parameter(Mandatory)][string]$Compiler,
  [Parameter(Mandatory)][string]$OutputFolder,
  [string]$FixtureBaseUrl
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskOutput = [IO.Path]::GetFullPath($OutputFolder)
if (Test-Path -LiteralPath $taskOutput) { throw 'Choose a new helper output folder.' }
$taskSignature = Get-AuthenticodeSignature -LiteralPath $Compiler
if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'Pyrsys B.V.') { throw 'Use the verified Inno compiler.' }
$taskReceipt = Get-Content -LiteralPath $InstallerReceipt -Raw | ConvertFrom-Json
$taskVersion = [string]$taskReceipt.version
if ($taskVersion -notmatch '^(\d+)\.(\d+)\.(\d+)-preview\.(\d+)$') { throw 'Invalid release version.' }
$taskParts = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], [int]$Matches[4])
if (@($taskParts | Where-Object { $_ -gt 65535 }).Count) { throw 'Invalid Windows version.' }
New-Item -ItemType Directory -Path $taskOutput | Out-Null
$taskBuild = Join-Path $taskOutput 'build-inputs'
$taskNodeArgs = @((Join-Path $PSScriptRoot 'download-release.mjs'), [IO.Path]::GetFullPath($InstallerReceipt), $taskBuild)
if ($FixtureBaseUrl) { $taskNodeArgs += $FixtureBaseUrl }
& node @taskNodeArgs
if ($LASTEXITCODE -ne 0) { throw 'The helper payload did not verify. Partial output retained.' }
$taskCompilerArgs = @('/Qp', ('/DDownloadManifest=' + (Join-Path $taskBuild 'DownloadManifest.iss')),
  ('/DBranchlineVersion=' + $taskVersion), ('/DBranchlineFileVersion=' + ($taskParts -join '.')),
  ('/DOutputFolder=' + $taskOutput), ('/DIconFile=' + (Join-Path $taskRoot 'public/assets/branchline.ico')))
if ($FixtureBaseUrl) { $taskCompilerArgs += '/DQualification' }
$taskCompilerArgs += (Join-Path $taskRoot 'installer/Download-Branchline.iss')
& $Compiler @taskCompilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Download helper did not compile. Evidence retained.' }
$taskExecutable = Get-Item -LiteralPath (Join-Path $taskOutput 'Install-Branchline.exe')
$taskResult = @{
  profile = 'branchline.download-helper-build/1'; version = $taskVersion
  fixture = [bool]$FixtureBaseUrl; status = 'BUILT_PENDING_CHECKS'; signed = $false
  file = $taskExecutable.Name; bytes = $taskExecutable.Length
  sha256 = (Get-FileHash -LiteralPath $taskExecutable.FullName).Hash.ToLowerInvariant()
  manifestSha256 = (Get-FileHash -LiteralPath (Join-Path $taskBuild 'download-release.json')).Hash.ToLowerInvariant()
  compilerSha256 = (Get-FileHash -LiteralPath $Compiler).Hash.ToLowerInvariant()
}
$taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskOutput 'helper-build.json') -Encoding utf8
Write-Output 'Pinned download helper built; runtime checks remain.'
