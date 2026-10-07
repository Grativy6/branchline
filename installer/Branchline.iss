; Compile through scripts/Build-Installer.ps1. Inputs are verified before ISCC.
#ifndef PayloadInclude
  #error Use Build-Installer.ps1 to supply the verified payload.
#endif

[Setup]
#ifdef Qualification
AppId={{A45F59C1-80E7-4A14-B248-C22CBA4D7584}
AppName=Branchline isolated qualification
UsePreviousAppDir=no
UsePreviousTasks=no
#else
AppId={{C74908CD-7E4E-4FE3-A626-9C70EF869A55}
AppName=Branchline
#endif
AppVersion={#BranchlineVersion}
AppVerName=Branchline {#BranchlineVersion}
AppPublisher=Christopher Daniel Pang
VersionInfoVersion={#BranchlineFileVersion}
DefaultDirName={localappdata}\Programs\Branchline
DefaultGroupName=Branchline
DisableProgramGroupPage=yes
DisableDirPage=no
DisableWelcomePage=no
PrivilegesRequired=lowest
SetupArchitecture=x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputFolder}
OutputBaseFilename=Branchline-v{#BranchlineVersion}-Setup
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\Branchline.Preview.exe
LicenseFile={#LicenseFile}
WizardStyle=modern
Compression=lzma2/fast
SolidCompression=no
DiskSpanning=yes
DiskSliceSize=1900000000
DiskClusterSize=32768
SlicesPerDisk=1
CloseApplications=no
RestartApplications=no
AlwaysRestart=no
SetupLogging=yes
Uninstallable=yes
ChangesAssociations=no

[Types]
Name: "full"; Description: "Branchline with Qwen (recommended)"
Name: "apponly"; Description: "App only (advanced: bring your own model)"
Name: "custom"; Description: "Custom"; Flags: iscustom

[Components]
Name: "core"; Description: "Branchline application"; Types: full apponly custom; Flags: fixed
Name: "model"; Description: "Qwen3.5-4B, pictures, and offline CPU / graphics runtimes"; Types: full; ExtraDiskSpaceRequired: {#ConditionalModelBytes}

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Files]
#include PayloadInclude
Source: "{#WebViewInstaller}"; DestName: "WebView2Setup.exe"; Flags: dontcopy
Source: "{#VcInstaller}"; DestName: "VCRuntimeSetup.exe"; Flags: dontcopy

#ifndef Qualification
[Icons]
Name: "{group}\Branchline"; Filename: "{app}\Branchline.Preview.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Branchline"; Filename: "{app}\Branchline.Preview.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Branchline.Preview.exe"; Description: "Open Branchline"; Flags: nowait postinstall skipifsilent

#endif

[Code]
#include SliceChecks
#include "RuntimeChecks.iss"

function WebViewInstalled: Boolean;
var Version: String;
begin
  Result := (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function ModelCopyNeeded(Name, Expected: String): Boolean;
var Target: String;
begin
  Target := ExpandConstant('{app}\bundled-model\') + Name;
  Result := True;
  if FileExists(Target) then begin
    try Result := CompareText(GetSHA256OfFile(Target), Expected) <> 0;
    except Result := True; end;
  end;
end;

function WithModel: Boolean;
begin
  Result := WizardIsComponentSelected('model');
end;

function WithoutModel: Boolean;
begin
  Result := not WizardIsComponentSelected('model');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer; FreeBytes, TotalBytes, Required: Int64; FileName, SpacePath: String; Existing: TFileStream;
  Started, Available: Boolean;
begin
  Log('Branchline prerequisite checks: process64=' + IntToStr(Ord(IsCurrentProcess64Bit)) +
    '; install64=' + IntToStr(Ord(Is64BitInstallMode)));
  Log('Branchline selected components: ' + WizardSelectedComponents(False));
  Log('Branchline component-page size: ' + WizardForm.ComponentsDiskSpaceLabel.Caption);
  Result := CheckSlices;
  if Result <> '' then Exit;
  FileName := ExpandConstant('{app}\Branchline.Preview.exe');
  if FileExists(FileName) then begin
    try Existing := TFileStream.Create(FileName, fmOpenReadWrite or fmShareExclusive); Existing.Free;
    except Result := 'Branchline is still open or the installation is not writable. Close it, then run Setup again. No files have been replaced.'; Exit; end;
  end;
  Required := {#CoreBytes} + 600000000;
  if WithModel then Required := Required + {#ModelBytes};
  if FileExists(ExpandConstant('{app}\Branchline.Preview.exe')) then Required := Required * 2;
  SpacePath := ExpandConstant('{app}');
  while not DirExists(SpacePath) and (ExtractFileDir(SpacePath) <> SpacePath) do SpacePath := ExtractFileDir(SpacePath);
  if not GetSpaceOnDisk64(SpacePath, FreeBytes, TotalBytes) then begin
    Result := 'Setup could not check free space at this location. Choose another folder or check the drive.'; Exit;
  end;
  if FreeBytes < Required then begin
    Result := 'There is not enough free space to install safely and retain recovery space. Free some space or choose another drive.'; Exit;
  end;
#ifdef Qualification
  if not WebViewInstalled or (WithModel and not VcInstalled) then begin
    Result := 'Qualification requires existing prerequisites. It never installs shared runtimes.'; Exit;
  end;
#else
  if not WebViewInstalled then begin
    ExtractTemporaryFile('WebView2Setup.exe'); FileName := ExpandConstant('{tmp}\WebView2Setup.exe');
    if not Exec(FileName, '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code) then begin Result := 'WebView2 could not start. Your Branchline installation has not been replaced.'; Exit; end;
    if (Code = 3010) or (Code = 1641) then begin NeedsRestart := True; Result := 'WebView2 needs a Windows restart. Restart when convenient, then run Setup again.'; Exit; end;
    if (Code <> 0) or not WebViewInstalled then begin Result := 'WebView2 could not be installed. Check its installer result, then run Setup again.'; Exit; end;
  end;
  if WithModel and not VcInstalled then begin
    ExtractTemporaryFile('VCRuntimeSetup.exe'); FileName := ExpandConstant('{tmp}\VCRuntimeSetup.exe');
    Started := Exec(FileName, '/install /passive /norestart', '', SW_SHOW, ewWaitUntilTerminated, Code);
    Available := VcInstalled;
    Result := VcInstallResult(Started, Code, Available, NeedsRestart);
    if Result <> '' then Exit;
  end;
#endif
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := 'Install Branchline with a stock local Qwen model, or choose the advanced app-only option.' + #13#10#13#10 +
    'Keep Setup and all its data parts together. No model download or account is needed for the included local conversation.' + #13#10#13#10 +
    'Existing conversations and model choices are preserved. Microsoft prerequisites may show their own permission prompt. Setup does not restart Windows automatically.';
end;

// No UninstallDelete or registry-based data purge. Conversations, user models
// and shared prerequisites remain.
