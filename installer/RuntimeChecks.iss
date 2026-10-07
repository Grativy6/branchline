// Shared by Setup and the read-only diagnostic. Never install a runtime here.
function VcVersionSufficient(MS, LS: Cardinal): Boolean;
begin
  // The pinned offline Microsoft package supplies 14.51.36247.0.
  Result := (MS > $000E0033) or ((MS = $000E0033) and (LS >= $8D970000));
end;

function VcLibraryInstalled(Name: String): Boolean;
var FileName, Version: String; MS, LS: Cardinal; Found: Boolean;
begin
  // Install mode alone does not change every Windows file/version API's view.
  // Resolve a native system path for the process actually performing the read.
  FileName := ApplyPathRedirRulesForCurrentProcess(True, ExpandConstant('{sys}\') + Name);
  Found := GetVersionNumbers(FileName, MS, LS);
  Version := 'unavailable';
  Result := False;
  if Found then begin
    Version := Format('%d.%d.%d.%d', [MS shr 16, MS and $FFFF, LS shr 16, LS and $FFFF]);
    Result := VcVersionSufficient(MS, LS);
  end;
  Log('Branchline VC x64: path=' + FileName + '; version=' + Version +
    '; minimum=14.51.36247.0; accepted=' + IntToStr(Ord(Result)));
end;

function VcInstalled: Boolean;
var Runtime, Runtime1, StandardLibrary: Boolean;
begin
  // Evaluate separately: a failed first library must not hide the other results.
  Runtime := VcLibraryInstalled('vcruntime140.dll');
  Runtime1 := VcLibraryInstalled('vcruntime140_1.dll');
  StandardLibrary := VcLibraryInstalled('msvcp140.dll');
  Result := Runtime and Runtime1 and StandardLibrary;
  Log('Branchline VC x64: all required libraries accepted=' + IntToStr(Ord(Result)));
end;

function VcInstallResult(Started: Boolean; Code: Integer; Available: Boolean;
  var NeedsRestart: Boolean): String;
begin
  Result := '';
  Log('Branchline VC installer: started=' + IntToStr(Ord(Started)) +
    '; exit_or_launch_error=' + IntToStr(Code) + '; libraries_accepted=' + IntToStr(Ord(Available)));
  if not Started then
    Result := 'The Microsoft C++ installer could not start (Windows error ' + IntToStr(Code) +
      '). Allow its Windows permission prompt, then try again.'
  else if (Code = 3010) or (Code = 1641) then begin
    NeedsRestart := True;
    Result := 'The Microsoft C++ runtime needs a Windows restart. Restart when convenient, then run Setup again.';
  end
  else if Code <> 0 then
    Result := 'The Microsoft C++ installer returned error ' + IntToStr(Code) +
      '. Keep the Setup log and Microsoft runtime log for diagnosis, then try again.'
  else if not Available then
    Result := 'Microsoft reported a successful C++ installation, but Setup could not verify all required 64-bit libraries. ' +
      'Keep the Setup log: it records each library path and version. You can retry after a Windows restart or choose App only.';
  if Result <> '' then
    Result := Result + #13#10#13#10 + 'Your existing Branchline app has not been replaced.';
end;
