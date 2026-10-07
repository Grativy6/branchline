param(
    [Parameter(Mandatory)][string]$SourceFolder,
    [Parameter(Mandatory)][string]$BinaryFolder,
    [string]$Version = '0.8.12-preview.5'
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.]+)?$') { throw 'Use a plain semantic version.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReleases = [IO.Path]::GetFullPath((Join-Path $taskRoot 'releases'))
$taskSource = [IO.Path]::GetFullPath($SourceFolder)
$taskBinary = [IO.Path]::GetFullPath($BinaryFolder)
foreach ($taskPath in @($taskSource, $taskBinary)) {
    if (-not $taskPath.StartsWith($taskReleases + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Use source and binary folders inside this checkout releases directory.' }
}
Add-Type -AssemblyName System.IO.Compression
function Get-CheckedFile([string]$Base, [string]$Relative, [string]$Hash) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Unsafe archive path.' }
    $taskFile = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not $taskFile.StartsWith($Base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive input escaped its folder.' }
    if ((Get-Item -LiteralPath $taskFile).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Archive inputs cannot be links.' }
    if ($Hash -and (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Archive input changed: $Relative" }
    return $taskFile
}
function Write-Archive([string]$Name, [object[]]$Entries) {
    $taskZip = Join-Path $taskReleases $Name
    $taskStream = [IO.File]::Open($taskZip, [IO.FileMode]::CreateNew)
    try {
        $taskArchive = [IO.Compression.ZipArchive]::new($taskStream, [IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($taskEntry in $Entries) {
                $taskFile = Get-CheckedFile $taskEntry.Base $taskEntry.Path $taskEntry.Hash
                $taskInside = $taskArchive.CreateEntry($taskEntry.Path.Replace('\','/'), [IO.Compression.CompressionLevel]::Optimal)
                $taskInput = [IO.File]::OpenRead($taskFile)
                $taskOutput = $taskInside.Open()
                try { $taskInput.CopyTo($taskOutput) } finally { $taskInput.Dispose(); $taskOutput.Dispose() }
            }
        } finally { $taskArchive.Dispose() }
    } finally { $taskStream.Dispose() }
    return $taskZip
}
$taskSourceManifest = Get-Content -LiteralPath (Join-Path $taskSource 'source-manifest.json') -Raw | ConvertFrom-Json
$taskBinaryManifest = Get-Content -LiteralPath (Join-Path $taskBinary 'build-manifest.json') -Raw | ConvertFrom-Json
if (@($taskBinaryManifest.files | Where-Object { $_.path.StartsWith('bundled-model/') }).Count) { throw 'Use the app-only folder for the portable ZIP; the full model ships in Setup parts.' }
$taskNative = Get-Content -LiteralPath (Join-Path $taskRoot 'provenance/licensing/native-sources.json') -Raw | ConvertFrom-Json
$taskSourceEntries = @($taskSourceManifest.files | ForEach-Object { @{ Base=$taskSource; Path=$_.path; Hash=$_.sha256 } }) + @(@{Base=$taskSource;Path='source-manifest.json';Hash=$null})
$taskBinaryEntries = @($taskBinaryManifest.files | ForEach-Object { @{ Base=$taskBinary; Path=$_.path; Hash=$_.sha256 } }) + @(@{Base=$taskBinary;Path='build-manifest.json';Hash=$null})
$taskNativeEntries = @($taskNative.archives | ForEach-Object { @{Base=(Join-Path $taskRoot '.local/runtime-cache/native-sources');Path=$_.file;Hash=$_.sha256} })
# Native source ZIP uses the manifest paths directly, so it can seed the download cache.
$taskNativeEntries += @(@{Base=(Join-Path $taskRoot 'provenance/licensing');Path='native-sources.json';Hash=$null},@{Base=(Join-Path $taskRoot 'docs/public');Path='NATIVE-SOURCES.md';Hash=$null})
$taskFiles = @(
    (Write-Archive ("Branchline-v$Version-Source.zip") $taskSourceEntries),
    (Write-Archive ("Branchline-v$Version-App-Only-Windows-x64.zip") $taskBinaryEntries),
    (Write-Archive ("Branchline-v$Version-Native-Sources.zip") $taskNativeEntries)
)
$taskSums = foreach ($taskFile in $taskFiles) { (Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($taskFile) }
$taskChecksumFile = Join-Path $taskReleases ("Branchline-v$Version-Archive-SHA256SUMS.txt")
$taskHandle = [IO.File]::Open($taskChecksumFile, [IO.FileMode]::CreateNew)
$taskWriter = [IO.StreamWriter]::new($taskHandle,[Text.UTF8Encoding]::new($false))
try { $taskWriter.WriteLine(($taskSums -join "`n")) } finally { $taskWriter.Dispose() }
$taskFiles | ForEach-Object { Get-Item -LiteralPath $_ | Select-Object Name,Length }
