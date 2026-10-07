// Read-only probe: exits during initialization, before a wizard or installation.
#ifndef ProbeArchitecture
  #define ProbeArchitecture "x64"
#endif
[Setup]
AppId=BranchlineRuntimeReadOnlyDiagnostic
AppName=Branchline runtime read-only diagnostic
AppVersion=1
DefaultDirName={tmp}\unused-branchline-diagnostic
PrivilegesRequired=lowest
SetupArchitecture={#ProbeArchitecture}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CreateAppDir=no
Uninstallable=no
SetupLogging=yes
OutputDir={#ProbeOutput}
OutputBaseFilename=Branchline-Runtime-Check-{#ProbeArchitecture}

[Code]
#include "RuntimeChecks.iss"
#ifdef SelfTest
  #include "../tests/installer-runtime-cases.iss"
#endif

procedure InspectOriginalPath(Name: String);
var FileName, Version: String;
begin
  FileName := ExpandConstant('{sys}\') + Name;
  if not GetVersionNumbersString(FileName, Version) then Version := 'unavailable';
  Log('Original raw lookup: path=' + FileName + '; version=' + Version);
end;

function InitializeSetup: Boolean;
begin
  Log('READ_ONLY_DIAGNOSTIC_NO_INSTALL');
  Log('process64=' + IntToStr(Ord(IsCurrentProcess64Bit)) + '; install64=' + IntToStr(Ord(Is64BitInstallMode)));
#ifdef SelfTest
  RunRuntimeCases;
#endif
  InspectOriginalPath('vcruntime140.dll');
  InspectOriginalPath('vcruntime140_1.dll');
  InspectOriginalPath('msvcp140.dll');
  if VcInstalled then Log('RUNTIME_CHECK=PASS') else Log('RUNTIME_CHECK=MISSING_OR_OLD_LIBRARY');
  Log('READ_ONLY_DIAGNOSTIC_COMPLETE');
  Result := False;
end;
