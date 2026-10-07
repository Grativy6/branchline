; A small, version-bound downloader. It neither installs a service nor updates apps.
#ifndef DownloadManifest
  #error Use scripts/Build-Download-Helper.ps1 to verify and bind the payload.
#endif
[Setup]
#ifdef Qualification
AppName=Branchline Download TEST FIXTURE
#else
AppName=Branchline Download
#endif
AppVersion={#BranchlineVersion}
AppPublisher=Christopher Daniel Pang
VersionInfoVersion={#BranchlineFileVersion}
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
MinVersion=10.0.19041
DisableWelcomePage=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
OutputDir={#OutputFolder}
OutputBaseFilename=Install-Branchline
SetupIconFile={#IconFile}
WizardStyle=modern
CloseApplications=no
RestartApplications=no
AlwaysRestart=no
SetupLogging=yes
UsePreviousAppDir=no
UsePreviousTasks=no
#ifdef Qualification
AppVerName=Branchline download TEST FIXTURE - {#BranchlineVersion}
#else
AppVerName=Branchline download - {#BranchlineVersion}
#endif

[Run]
Filename: "{code:SetupPath}"; Description: "Open Branchline Setup"; Flags: postinstall nowait skipifsilent; Check: VerifyForLaunch

[Code]
var
  CachePage: TInputDirWizardPage;
  Downloads: TDownloadWizardPage;
  Cache: String;
  ReadyToLaunch: Boolean;
  FileNames, FileUrls, FileHashes: array[0..20] of String;
  FileBytes: array[0..20] of Int64;

#include DownloadManifest

function GetFileAttributesW(Name: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

procedure CheckPath(Name: String);
var Current, Parent: String; Attributes: LongWord;
begin
  Current := RemoveBackslashUnlessRoot(Name);
  if (Length(Current) < 3) or (Copy(Current, 2, 2) <> ':\') then
    RaiseException('Choose a folder on a local drive.');
  repeat
    Attributes := GetFileAttributesW(Current);
    if (Attributes <> $FFFFFFFF) and ((Attributes and $400) <> 0) then
      RaiseException('Choose a folder without links or redirected directories.');
    Parent := ExtractFileDir(Current);
    if (Parent = '') or (Parent = Current) then Break;
    Current := Parent;
  until False;
end;

function MatchesFile(const Name: String; Index: Integer): Boolean;
var Size: Int64;
begin
  Result := False;
  CheckPath(Name);
  if not FileExists(Name) then Exit;
  if not FileSize64(Name, Size) then Exit;
  if Size <> FileBytes[Index] then Exit;
  Result := CompareText(GetSHA256OfFile(Name), FileHashes[Index]) = 0;
end;

function SetupPath(Param: String): String;
begin
  Result := AddBackslash(Cache) + FileNames[0];
end;

function VerifyForLaunch: Boolean;
var Index: Integer;
begin
  Result := False;
  if not ReadyToLaunch then Exit;
  try
    for Index := 0 to FileCount - 1 do
      if not MatchesFile(AddBackslash(Cache) + FileNames[Index], Index) then
        RaiseException('An installation file changed. Reopen this downloader to check it again.');
    Result := True;
  except
    SuppressibleMsgBox(GetExceptionMessage, mbError, MB_OK, IDOK);
  end;
end;

function Progress(const Url, FileName: String; const Current, Maximum: Int64): Boolean;
var Index: Integer;
begin
  Result := True;
  for Index := 0 to FileCount - 1 do
    if ExtractFileName(FileName) = FileNames[Index] then begin
      if (Current > FileBytes[Index]) or ((Maximum > 0) and (Maximum <> FileBytes[Index])) then
        RaiseException('The download size differs from this release. Nothing will be launched.');
      Exit;
    end;
end;

procedure CheckSpace;
var Index: Integer; Needed, Largest, FreeBytes, Total, TempFree: Int64; Existing: String;
begin
  Needed := 0; Largest := 0;
  for Index := 0 to FileCount - 1 do
    if not MatchesFile(AddBackslash(Cache) + FileNames[Index], Index) then begin
      Needed := Needed + FileBytes[Index];
      if FileBytes[Index] > Largest then Largest := FileBytes[Index];
    end;
  Existing := Cache;
  while not DirExists(Existing) do begin
    if ExtractFileDir(Existing) = Existing then RaiseException('The download drive is unavailable.');
    Existing := ExtractFileDir(Existing);
  end;
  if not GetSpaceOnDisk64(Existing, FreeBytes, Total) then RaiseException('Could not check download space.');
  if not GetSpaceOnDisk64(ExpandConstant('{tmp}'), TempFree, Total) then RaiseException('Could not check temporary space.');
#ifdef Qualification
  if ExpandConstant('{param:TESTNOSPACE|0}') = '1' then FreeBytes := 0;
#endif
  if CompareText(ExtractFileDrive(Cache), ExtractFileDrive(ExpandConstant('{tmp}'))) = 0 then
    Needed := Needed + Largest;
  if (FreeBytes < Needed + 268435456) or (TempFree < Largest + 268435456) then
    RaiseException('There is not enough space for the download and its temporary copy. Free space or choose another drive. Setup will check installation space separately.');
end;

procedure InitializeWizard;
begin
  BindFiles;
  ReadyToLaunch := False;
  WizardForm.WelcomeLabel2.Caption :=
    'Download Branchline ' + ReleaseVersion + ' with its included local Qwen model.' + #13#10#13#10 +
    'Files come from the Grativy6/branchline GitHub release. This helper checks them before opening the ordinary Setup window. No account is needed.' + #13#10#13#10 +
    'This preview is unsigned. A matching download hash does not establish an unknown publisher''s identity.';
#ifdef Qualification
  WizardForm.WelcomeLabel2.Caption := 'LOCAL DOWNLOAD TEST FIXTURE. Not a public installer.';
#endif
  CachePage := CreateInputDirPage(wpWelcome, 'Keep the installation files',
    'Choose where to keep the verified files for retry or an offline installation.',
    'A versioned Branchline folder will be created here. Existing conversations are not changed.', False, '');
  CachePage.Add('Download folder:');
  CachePage.Values[0] := ExpandConstant('{localappdata}\Branchline Downloads');
#ifdef Qualification
  CachePage.Values[0] := ExpandConstant('{param:TESTCACHE|{tmp}\test-cache}');
#endif
  Downloads := CreateDownloadPage('Downloading Branchline', 'You can cancel and retry. Completed, verified files are kept.', @Progress);
  Downloads.ShowBaseNameInsteadOfUrl := True;
  WizardForm.FinishedLabel.Caption := 'Branchline''s installation files have been downloaded and checked. Open Setup to choose the installation location and desktop shortcut.';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Index: Integer; Target, TempFile, Partial: String;
begin
  Result := True;
  if CurPageID = CachePage.ID then begin
    try
      Cache := AddBackslash(CachePage.Values[0]) + 'Branchline-v' + ReleaseVersion;
      CheckPath(Cache);
      CheckSpace;
      WizardForm.ReadyMemo.Lines.Text := 'Release: ' + ReleaseVersion + #13#10 +
        'Download: ' + IntToStr(StrToInt64(DownloadBytes) div 1000000) + ' MB' + #13#10 +
        'Keep files at: ' + Cache + #13#10#13#10 + 'The normal installer opens after the downloads have been checked.';
    except
      SuppressibleMsgBox(GetExceptionMessage, mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
  if CurPageID <> wpReady then Exit;
  Cache := AddBackslash(CachePage.Values[0]) + 'Branchline-v' + ReleaseVersion;
  ReadyToLaunch := False;
  Downloads.Show;
  try
    try
      CheckPath(Cache); CheckSpace;
      if not ForceDirectories(Cache) then RaiseException('Could not create the download folder.');
      for Index := 0 to FileCount - 1 do begin
        Target := AddBackslash(Cache) + FileNames[Index];
        if MatchesFile(Target, Index) then begin
          Log('Reused verified file: ' + FileNames[Index]);
        end else begin
          Downloads.Clear;
          Downloads.Add(FileUrls[Index], FileNames[Index], FileHashes[Index]);
          Downloads.Download;
          TempFile := ExpandConstant('{tmp}\') + FileNames[Index];
          if not MatchesFile(TempFile, Index) then RaiseException('Downloaded file failed verification.');
          Partial := Target + '.partial';
          CheckPath(Partial); CheckPath(Target);
          if not FileCopy(TempFile, Partial, False) then RaiseException('Could not save the verified download. Check space and permissions.');
          if not MatchesFile(Partial, Index) then RaiseException('Saved download failed verification.');
          if FileExists(Target) and not DeleteFile(Target) then RaiseException('Could not replace a mismatched download. Close other installers and retry.');
          if not RenameFile(Partial, Target) then RaiseException('Could not finish saving the download.');
          DeleteFile(TempFile);
          Log('Saved verified file: ' + FileNames[Index]);
        end;
      end;
      ReadyToLaunch := True;
      if not VerifyForLaunch then RaiseException('The saved installation files could not be verified.');
    except
      Result := False;
      ReadyToLaunch := False;
      if Downloads.AbortedByUser then Log('Download cancelled. Verified completed files retained.')
      else SuppressibleMsgBox(GetExceptionMessage, mbError, MB_OK, IDOK);
    end;
  finally
    Downloads.Hide;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpReady then WizardForm.NextButton.Caption := 'Download';
end;
