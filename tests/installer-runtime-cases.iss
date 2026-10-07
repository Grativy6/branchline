// Compiled by the same Inno Pascal interpreter used by the real installer.
procedure RequireRuntimeCase(Condition: Boolean; Name: String);
begin
  if not Condition then RaiseException('RUNTIME_CASE_FAILED: ' + Name);
  Log('RUNTIME_CASE_PASS: ' + Name);
end;

procedure CheckRuntimeResult(Started: Boolean; Code: Integer; Available, RestartExpected: Boolean; Expected: String);
var Restart: Boolean; Message: String;
begin
  Restart := False;
  Message := VcInstallResult(Started, Code, Available, Restart);
  RequireRuntimeCase(Restart = RestartExpected, 'restart state ' + IntToStr(Code));
  if Expected = '' then RequireRuntimeCase(Message = '', 'successful install is accepted')
  else begin
    RequireRuntimeCase(Pos(Expected, Message) > 0, 'specific failure ' + IntToStr(Code));
    RequireRuntimeCase(Pos('has not been replaced', Message) > 0, 'preservation message');
  end;
end;

procedure RunRuntimeCases;
begin
  RequireRuntimeCase(not VcVersionSufficient($000E0032, $FFFFFFFF), 'older minor rejected');
  RequireRuntimeCase(not VcVersionSufficient($000E0033, $8D960000), 'older build rejected');
  RequireRuntimeCase(VcVersionSufficient($000E0033, $8D970000), 'exact pinned version accepted');
  RequireRuntimeCase(VcVersionSufficient($000E0033, $8D970001), 'newer revision accepted');
  RequireRuntimeCase(VcVersionSufficient($000E0034, 0), 'newer minor accepted');
  RequireRuntimeCase(VcVersionSufficient($000F0000, 0), 'newer major accepted');
  RequireRuntimeCase(not VcLibraryInstalled('branchline-nonexistent-runtime-fixture.dll'), 'missing DLL rejected');
  CheckRuntimeResult(True, 0, True, False, '');
  CheckRuntimeResult(True, 0, False, False, 'Microsoft reported a successful');
  CheckRuntimeResult(False, 1223, False, False, 'could not start (Windows error 1223)');
  CheckRuntimeResult(True, 1603, False, False, 'returned error 1603');
  CheckRuntimeResult(True, 1603, True, False, 'returned error 1603');
  CheckRuntimeResult(True, 3010, True, True, 'needs a Windows restart');
  CheckRuntimeResult(True, 1641, False, True, 'needs a Windows restart');
  Log('ALL_RUNTIME_CASES_PASS');
end;
