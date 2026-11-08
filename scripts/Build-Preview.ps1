param(
  [string]$OutputName = 'Branchline-v0.10.0-Windows-x64',
  [Parameter(Mandatory)][string]$RuntimeFolder,
  [switch]$WithModel
)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
if($OutputName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$'){throw 'Choose a plain output folder name.'}
$taskOutput=Join-Path (Join-Path $taskRoot 'releases') $OutputName
if(Test-Path -LiteralPath $taskOutput){throw 'Use a new release output; existing files are preserved.'}
$taskNode=(Get-Command node.exe -ErrorAction Stop).Source
$taskArgs=@((Join-Path $PSScriptRoot 'Prepare-Public-Package.mjs'),$taskOutput,('--runtime-dir='+[IO.Path]::GetFullPath($RuntimeFolder)))
if($WithModel){$taskArgs+='--with-model'}
& $taskNode (Join-Path $PSScriptRoot 'Prepare-License-Assets.mjs') --check --runtime
if($LASTEXITCODE -ne 0){throw 'Review licence inputs.'}
& $taskNode @taskArgs --preflight
if($LASTEXITCODE -ne 0){throw 'Review package inputs.'}
& dotnet publish (Join-Path $taskRoot 'desktop\Branchline.Preview.csproj') --configuration Release --output $taskOutput --configfile (Join-Path $taskRoot 'desktop\NuGet.Config') -p:NuGetAudit=false -p:RestoreLockedMode=true -p:DebugType=None -p:DebugSymbols=false -p:IncludeSourceRevisionInInformationalVersion=false "-p:PathMap=$taskRoot=/src/Branchline"
if($LASTEXITCODE -ne 0){throw 'Native build failed; partial output retained.'}
& $taskNode @taskArgs
if($LASTEXITCODE -ne 0){throw 'Package copy failed; partial output retained.'}
& $taskNode @taskArgs --manifest
if($LASTEXITCODE -ne 0){throw 'Package verification failed; partial output retained.'}
Write-Output $taskOutput
