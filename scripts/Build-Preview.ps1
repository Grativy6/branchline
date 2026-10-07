param([string]$OutputName = 'Branchline-v0.8.12-preview.5-Windows-x64', [string]$BundledInputFolder)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if ($OutputName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Use a plain release folder name.' }
$taskOutput = Join-Path (Join-Path $taskRoot 'releases') $OutputName
if (Test-Path -LiteralPath $taskOutput) { throw 'That release already exists. Choose another OutputName; existing builds are preserved.' }
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
& $taskNode (Join-Path $PSScriptRoot 'Prepare-License-Assets.mjs') --check --runtime
if ($LASTEXITCODE -ne 0) { throw 'The licence or runtime inputs need review.' }
& $taskNode (Join-Path $PSScriptRoot 'Prepare-Public-Package.mjs') $taskOutput --preflight
if ($LASTEXITCODE -ne 0) { throw 'The public package inputs are incomplete. See the reported input; fetch only if needed.' }
New-Item -ItemType Directory -Path $taskOutput | Out-Null
# A relative PublishDir keeps apostrophes in a chosen parent folder out of the
# SDK's quoted MSBuild item transform. The destination is still the checked one.
& dotnet publish (Join-Path $taskRoot 'desktop\Branchline.Preview.csproj') --configuration Release "-p:PublishDir=..\releases\$OutputName\" --configfile (Join-Path $taskRoot 'desktop\NuGet.Config') -p:NuGetAudit=false -p:RestoreLockedMode=true -p:DebugType=None -p:DebugSymbols=false "-p:PathMap=$taskRoot=/src/Branchline"
if ($LASTEXITCODE -ne 0) { throw 'Native build failed. Partial output is retained.' }
& $taskNode (Join-Path $PSScriptRoot 'Prepare-Public-Package.mjs') $taskOutput
if ($LASTEXITCODE -ne 0) { throw 'Public payload preparation failed. Partial output is retained.' }
& $taskNode (Join-Path $PSScriptRoot 'Copy-Calculation-Runtime.mjs') $taskOutput
if ($LASTEXITCODE -ne 0) { throw 'Dependency packaging failed. Partial output is retained.' }
if ($BundledInputFolder) {
    & $taskNode (Join-Path $PSScriptRoot 'Bundle-Local-Model.mjs') $BundledInputFolder $taskOutput
    if ($LASTEXITCODE -ne 0) { throw 'Included-model packaging failed. Partial output is retained.' }
}
& $taskNode (Join-Path $PSScriptRoot 'Prepare-Public-Package.mjs') $taskOutput --manifest
if ($LASTEXITCODE -ne 0) { throw 'Final payload verification failed. This build is not ready.' }
Write-Output $taskOutput
