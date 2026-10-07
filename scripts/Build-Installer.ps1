param(
  [Parameter(Mandatory)][string]$PackageFolder,
  [Parameter(Mandatory)][string]$InputFolder,
  [Parameter(Mandatory)][string]$Compiler,
  [Parameter(Mandatory)][string]$OutputFolder,
  [switch]$Qualification
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = [IO.Path]::GetFullPath($PackageFolder)
$taskInput = [IO.Path]::GetFullPath($InputFolder)
$taskOutput = [IO.Path]::GetFullPath($OutputFolder)
$taskReleases = [IO.Path]::GetFullPath((Join-Path $taskRoot 'releases'))
if ([IO.Path]::GetDirectoryName($taskPackage) -ne $taskReleases) { throw 'Choose a direct release folder.' }
if (Test-Path -LiteralPath $taskOutput) { throw 'Installer output already exists; choose a new candidate folder.' }
$taskLock = Get-Content -LiteralPath (Join-Path $taskRoot 'provenance\installer-inputs.json') -Raw | ConvertFrom-Json
$taskManifest = Get-Content -LiteralPath (Join-Path $taskPackage 'build-manifest.json') -Raw | ConvertFrom-Json
$taskVersion = [string]$taskManifest.version
if ($taskVersion -notmatch '^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$') { throw 'Unsupported installer version.' }
$taskVersionParts = @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], [int]$Matches[4])
if (@($taskVersionParts | Where-Object { $_ -gt 65535 }).Count) { throw 'Installer version exceeds Windows limits.' }
$taskFileVersion = $taskVersionParts -join '.'
$taskSetupBase = "Branchline-v$taskVersion-Setup"
$taskModel = Get-Content -LiteralPath (Join-Path $taskPackage 'bundled-model\manifest.json') -Raw | ConvertFrom-Json
foreach ($taskName in @('webview','vcredist')) {
  $taskEntry = $taskLock.$taskName
  $taskFile = Join-Path $taskInput $taskEntry.file
  if ((Get-Item -LiteralPath $taskFile).Length -ne $taskEntry.bytes -or (Get-FileHash -LiteralPath $taskFile).Hash.ToLowerInvariant() -ne $taskEntry.sha256) { throw "Prerequisite bytes changed: $taskName" }
  $taskSignature = Get-AuthenticodeSignature -LiteralPath $taskFile
  if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(?:,|$)') { throw "Prerequisite publisher invalid: $taskName" }
}
if (-not (Test-Path -LiteralPath $Compiler -PathType Leaf)) { throw 'Choose the verified Inno Setup compiler.' }
$taskCompilerSignature = Get-AuthenticodeSignature -LiteralPath $Compiler
if ($taskCompilerSignature.Status -ne 'Valid' -or $taskCompilerSignature.SignerCertificate.Subject -notmatch 'Pyrsys B.V.') { throw 'Inno compiler publisher is not valid.' }
$taskFiles = @($taskManifest.files)
foreach ($taskEntry in $taskFiles) {
  $taskRelative = $taskEntry.path
  if ([IO.Path]::IsPathRooted($taskRelative) -or $taskRelative -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Unsafe package path.' }
  $taskFile = Join-Path $taskPackage $taskRelative
  if ((Get-Item -LiteralPath $taskFile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No package links.' }
  if ((Get-Item -LiteralPath $taskFile).Length -ne $taskEntry.bytes -or (Get-FileHash -LiteralPath $taskFile).Hash.ToLowerInvariant() -ne $taskEntry.sha256) { throw "Package input changed: $taskRelative" }
}
New-Item -ItemType Directory -Path $taskOutput | Out-Null
$taskBuild = Join-Path $taskOutput 'build-inputs'
New-Item -ItemType Directory -Path $taskBuild | Out-Null
$taskCoreBytes = 0L; $taskModelBytes = 0L; $taskConditionalModelBytes = 0L
$taskFileLines = foreach ($taskEntry in $taskFiles) {
  $taskRelative = $taskEntry.path.Replace('/','\')
  $taskIsModel = $taskRelative.StartsWith('bundled-model\')
  if ($taskIsModel) { $taskComponent = 'model'; $taskModelBytes += $taskEntry.bytes } else { $taskComponent = 'core'; $taskCoreBytes += $taskEntry.bytes }
  $taskSource = Join-Path $taskPackage $taskRelative
  $taskDestination = '{app}'
  if ([IO.Path]::GetDirectoryName($taskRelative)) { $taskDestination += '\' + [IO.Path]::GetDirectoryName($taskRelative) }
  $taskLine = 'Source: "' + $taskSource + '"; DestDir: "' + $taskDestination + '"; Flags: ignoreversion; Components: ' + $taskComponent
  if ($taskRelative -match '^bundled-model\\[^\\]+\.gguf$') {
    # Inno omits entries with Check from both component and total size labels.
    # Account for these bytes once through the model component, keeping the
    # hash-based reuse check that avoids copying unchanged multi-GB files.
    $taskConditionalModelBytes += $taskEntry.bytes
    $taskLine = $taskLine.Replace('Flags: ignoreversion;', 'Flags: ignoreversion nocompression;')
    $taskLine += '; Check: ModelCopyNeeded(''' + [IO.Path]::GetFileName($taskRelative) + ''', ''' + $taskEntry.sha256 + ''')'
  }
  $taskLine
}
$taskCoreManifest = $taskManifest | ConvertTo-Json -Depth 30 | ConvertFrom-Json
$taskCoreManifest.files = @($taskFiles | Where-Object { -not $_.path.StartsWith('bundled-model/') })
$taskCoreManifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $taskBuild 'app-only-manifest.json') -Encoding utf8
$taskFileLines += 'Source: "' + (Join-Path $taskPackage 'build-manifest.json') + '"; DestDir: "{app}"; Flags: ignoreversion; Check: WithModel'
$taskFileLines += 'Source: "' + (Join-Path $taskBuild 'app-only-manifest.json') + '"; DestDir: "{app}"; DestName: "build-manifest.json"; Flags: ignoreversion; Check: WithoutModel'
$taskLicense = Join-Path $taskBuild 'Installation-Licenses.txt'
$taskTerms = 'Branchline is Apache-2.0 software. Included Microsoft prerequisites retain their own terms below. Accepting this installation includes accepting the applicable Microsoft terms for the components installed. Those terms do not relicense Branchline or Qwen. WebView2 may check for updates and collect diagnostic data under Microsoft terms; see https://aka.ms/privacy. Local Qwen replies do not require an account or a network model service.' + "`r`n`r`n"
foreach ($taskNotice in @('LICENSE','licenses\WebView2-Runtime-LICENSE.txt','licenses\VC-Runtime-LICENSE.txt')) { $taskTerms += (Get-Content -LiteralPath (Join-Path $taskPackage $taskNotice) -Raw) + "`r`n`r`n" }
[IO.File]::WriteAllText($taskLicense, $taskTerms, [Text.UTF8Encoding]::new($false))
$taskPayload = Join-Path $taskBuild 'PayloadFiles.iss'
$taskFileLines | Set-Content -LiteralPath $taskPayload -Encoding utf8
$taskSlices = Join-Path $taskBuild 'SliceChecks.iss'
'function CheckSlices: String; begin Result := ''''; end;' | Set-Content -LiteralPath $taskSlices
$taskArguments = @('/Qp',('/DBranchlineVersion=' + $taskVersion),('/DBranchlineFileVersion=' + $taskFileVersion),('/DPayloadInclude=' + $taskPayload),('/DSliceChecks=' + $taskSlices),('/DOutputFolder=' + $taskOutput),('/DIconFile=' + (Join-Path $taskPackage 'public\assets\branchline.ico')),('/DLicenseFile=' + $taskLicense),('/DWebViewInstaller=' + (Join-Path $taskInput $taskLock.webview.file)),('/DVcInstaller=' + (Join-Path $taskInput $taskLock.vcredist.file)),('/DCoreBytes=' + $taskCoreBytes),('/DModelBytes=' + $taskModelBytes),(Join-Path $taskRoot 'installer\Branchline.iss'))
$taskArguments = @('/DConditionalModelBytes=' + $taskConditionalModelBytes) + $taskArguments
if ($Qualification) { $taskArguments = @('/DQualification') + $taskArguments }
& $Compiler @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'First installer compilation failed; evidence retained.' }
$taskCurrentParts = @(Get-ChildItem -LiteralPath $taskOutput -Filter ($taskSetupBase + '-*.bin') | Sort-Object Name | ForEach-Object {
  if ($_.Length -ge 2000000000) { throw 'An installer part exceeds the release asset limit.' }
  [pscustomobject]@{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
})
if ($taskCurrentParts.Count -eq 0) { throw 'Expected installer data slices.' }
$taskParts = $taskCurrentParts
$taskStable = $false
$taskPass = 1
# The Setup header can shift a slice boundary. Rebind after that shift, with a
# bounded number of attempts; never distribute unverified self-references.
for ($taskAttempt = 0; $taskAttempt -lt 3; $taskAttempt++) {
$taskChecks = @('function CheckSlices: String;', 'var FileName: String;', 'begin', '  Result := '''';')
foreach ($taskPart in $taskParts) {
  $taskChecks += '  FileName := ExpandConstant(''{src}\' + $taskPart.file + ''');'
  $taskChecks += '  if not FileExists(FileName) then begin Result := ''A download part is missing: ' + $taskPart.file + '. Put all Setup parts in the same folder.''; Exit; end;'
  $taskChecks += '  try if CompareText(GetSHA256OfFile(FileName), ''' + $taskPart.sha256 + ''') <> 0 then begin Result := ''A download part is damaged or belongs to a different version: ' + $taskPart.file + '. Download that part again.''; Exit; end;'
  $taskChecks += '  except Result := ''Setup could not read ' + $taskPart.file + '. Check the drive and try again.''; Exit; end;'
}
$taskChecks += 'end;'
$taskChecks | Set-Content -LiteralPath $taskSlices
& $Compiler @taskArguments
$taskPass++
if ($LASTEXITCODE -ne 0) { throw 'Installer recompilation failed; evidence retained.' }
$taskCurrentParts = @(Get-ChildItem -LiteralPath $taskOutput -Filter ($taskSetupBase + '-*.bin') | Sort-Object Name | ForEach-Object {
  if ($_.Length -ge 2000000000) { throw 'An installer part exceeds the release asset limit.' }
  [pscustomobject]@{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant()}
})
if ($taskCurrentParts.Count -eq 0) { throw 'Expected installer data slices.' }
  $taskStable = ($taskCurrentParts.Count -eq $taskParts.Count)
  for ($taskIndex=0; $taskStable -and $taskIndex -lt $taskParts.Count; $taskIndex++) {
    $taskStable = $taskCurrentParts[$taskIndex].file -eq $taskParts[$taskIndex].file -and $taskCurrentParts[$taskIndex].sha256 -eq $taskParts[$taskIndex].sha256
  }
  if ($taskStable) { break }
  $taskParts = $taskCurrentParts
}
if (-not $taskStable) { throw 'Slice hashes did not stabilize. Candidate retained; do not distribute.' }
$taskSetup = Get-Item -LiteralPath (Join-Path $taskOutput ($taskSetupBase + '.exe'))
if ($taskSetup.Length -ge 2000000000) { throw 'Setup exceeds the asset limit.' }
$taskReceipt = @{status='BUILT_PENDING_INSTALL_TESTS';qualificationVariant=[bool]$Qualification;signed=$false;compilerPasses=$taskPass;compilerSha256=(Get-FileHash -LiteralPath $Compiler).Hash.ToLowerInvariant();version=$taskManifest.version;parts=$taskParts;setup=@{file=$taskSetup.Name;bytes=$taskSetup.Length;sha256=(Get-FileHash -LiteralPath $taskSetup.FullName).Hash.ToLowerInvariant()};coreBytes=$taskCoreBytes;modelBytes=$taskModelBytes;inputLockSha256=(Get-FileHash -LiteralPath (Join-Path $taskRoot 'provenance\installer-inputs.json')).Hash.ToLowerInvariant()}
$taskReceipt.conditionalModelBytes = $taskConditionalModelBytes
$taskReceipt.setupArchitecture = 'x64'
$taskReceipt | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $taskOutput 'installer-build.json') -Encoding utf8
Write-Output 'Installer and all data parts built. Keep build-inputs private; only reviewed deliverables are for sharing.'
