/** Installer checks run before allowing launch; failures stay visible. */
module.exports = () =>
  String.raw`
var
  InstallationReady: Boolean;
  ExistingInstall: Boolean;

function CoreHostPath(const Directory: String): String;
begin
  Result := AddBackslash(Directory) + 'Groby''s Deck.exe';
  if not FileExists(Result) then Result := AddBackslash(Directory) + 'RaveLink-Core.exe';
  if not FileExists(Result) then Result := '';
end;

function IsCoreDirectory(const Directory: String): Boolean;
begin
  Result := (Directory <> '') and (CoreHostPath(Directory) <> '') and
    (FileExists(AddBackslash(Directory) + 'RELEASE_BUILD.json') or
     FileExists(AddBackslash(Directory) + 'package.json'));
end;

function RegisteredCoreDirectory(const RootKey: Integer): String;
var Directory: String;
begin
  Result := '';
  if RegQueryStringValue(RootKey,
    'Software\Microsoft\Windows\CurrentVersion\Uninstall\{CF817F37-5F04-4C18-A2B0-8A1EAA2674C5}_is1',
    'Inno Setup: App Path', Directory) and IsCoreDirectory(Directory) then Result := Directory;
end;

function RunningCoreDirectory(const MatchDirectory: String; var Scanned: Boolean): String;
var Locator, Services, Processes, Item, Executable: Variant; Directory: String; I: Integer;
begin
  Result := '';
  Scanned := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('.', 'root\cimv2');
    Processes := Services.ExecQuery('SELECT ExecutablePath FROM Win32_Process WHERE Name = "Groby''s Deck.exe" OR Name = "RaveLink-Core.exe"');
    for I := 0 to Processes.Count - 1 do begin
      Item := Processes.ItemIndex(I);
      Executable := Item.ExecutablePath;
      if not VarIsNull(Executable) then begin
        Directory := RemoveBackslashUnlessRoot(ExtractFileDir(String(Executable)));
        if IsCoreDirectory(Directory) and
           ((MatchDirectory = '') or (CompareText(Directory, MatchDirectory) = 0)) then begin
          Result := Directory;
          Break;
        end;
      end;
    end;
    Scanned := True;
  except
    Log('Could not query running Groby''s Deck installations.');
  end;
end;

function DefaultCoreDirectory(Param: String): String;
var Remembered: String; Scanned: Boolean;
begin
  Result := RegisteredCoreDirectory(HKCU);
  if (Result = '') and IsWin64 then Result := RegisteredCoreDirectory(HKLM64);
  if Result = '' then Result := RegisteredCoreDirectory(HKLM32);
  if Result = '' then Result := RunningCoreDirectory('', Scanned);
  if (Result = '') and
     RegQueryStringValue(HKCU, 'Software\GrobyDeck', 'LastInstallDirectory', Remembered) and
     IsCoreDirectory(Remembered) then Result := Remembered;
  if Result = '' then Result := ExpandConstant('{localappdata}\Programs\Groby’s Deck');
end;

function FreshSetup: Boolean;
begin
  Result := not IsCoreDirectory(WizardDirValue);
end;

function InstallAudioHelper: Boolean;
var Version: TWindowsVersion;
begin
  if not ExistingInstall then begin
    Result := WizardIsTaskSelected('music_to_light');
    Exit;
  end;
  GetWindowsVersionEx(Version);
  Result := (Version.Build >= 20348) and
    not FileExists(ExpandConstant('{app}\config\music-to-light.disabled'));
end;

function StopExistingCore: String;
var Directory, HostPath, Running: String; Attempts, ExitCode: Integer; Scanned: Boolean;
begin
  Result := '';
  Directory := RemoveBackslashUnlessRoot(ExpandConstant('{app}'));
  Running := RunningCoreDirectory(Directory, Scanned);
  if Scanned and (Running = '') then Exit;
  HostPath := CoreHostPath(Directory);
  if HostPath = '' then Exit;
  if not Exec(HostPath, '--stop', Directory, SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
    Result := 'Close Groby’s Deck from the system tray, then retry Setup.';
    Exit;
  end;
  if not Scanned then begin
    Sleep(1000);
    Exit;
  end;
  for Attempts := 1 to 40 do begin
    Running := RunningCoreDirectory(Directory, Scanned);
    if Scanned and (Running = '') then Exit;
    Sleep(250);
  end;
  Result := 'Groby’s Deck is still closing. Close it from the system tray, then retry Setup.';
end;

function LegacyFolderProblem: String;
var Contents: AnsiString;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\RaveLink-Bridge.exe')) or
     FileExists(ExpandConstant('{app}\RaveLink-Bridge-Start.bat')) then
    Result := 'This folder contains an older Groby’s Deck Bridge installation. Choose a new folder for Groby’s Deck. Your old files and settings will not be deleted.';
  if (Result = '') and LoadStringFromFile(ExpandConstant('{app}\package.json'), Contents) then
    if (Pos('"name": "ravelink-bridge"', LowerCase(String(Contents))) > 0) or
       (Pos('"name":"ravelink-bridge"', LowerCase(String(Contents))) > 0) then
      Result := 'This folder contains Groby’s Deck Bridge. Choose a new folder for Groby’s Deck; existing Bridge data will stay untouched.';
end;

function CanLaunchCore: Boolean;
begin
  Result := InstallationReady;
end;

function GetCustomSetupExitCode: Integer;
begin
  if InstallationReady then Result := 0 else Result := 20;
end;

function ConfigureFeature(const FeatureId: String; Selected: Boolean): Boolean;
var ResultCode: Integer; Arguments: String;
begin
  Arguments := '"' + ExpandConstant('{app}\scripts\install-official-features.js') + '" --offline ';
  if not Selected then Arguments := Arguments + '--skip ';
  Result := Exec(ExpandConstant('{app}\runtime\Grobys-Deck-Node.exe'),
    Arguments + FeatureId,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := Result and (ResultCode = 0);
  if not Result then
    SuppressibleMsgBox('Could not apply your setup selection for ' + FeatureId + '. See runtime\logs\feature-setup.log for details.', mbError, MB_OK, IDOK);
end;

procedure CompleteFirstRunSetup;
var ResultCode: Integer; Arguments, FlagPath: String;
begin
  InstallationReady := False;
  if not ForceDirectories(ExpandConstant('{app}\config')) then begin
    SuppressibleMsgBox('Setup cannot save configuration in this folder. Use the default per-user installation folder.', mbError, MB_OK, IDOK);
    Exit;
  end;
  FlagPath := ExpandConstant('{app}\config\music-to-light.disabled');
  Arguments := '"' + ExpandConstant('{app}\scripts\check-installation.js') + '"';
  if ExistingInstall then begin
    if not InstallAudioHelper then Arguments := Arguments + ' --no-music';
  end
  else if WizardIsTaskSelected('music_to_light') then begin
    if FileExists(FlagPath) and not DeleteFile(FlagPath) then begin
      SuppressibleMsgBox('Setup cannot enable Music-to-Light in this folder. Check folder permissions and retry.', mbError, MB_OK, IDOK);
      Exit;
    end;
  end
  else begin
    if not SaveStringToFile(FlagPath, 'Disabled during setup', False) then begin
      SuppressibleMsgBox('Setup cannot save the Music-to-Light choice. Check folder permissions and retry.', mbError, MB_OK, IDOK);
      Exit;
    end;
    Arguments := Arguments + ' --no-music';
  end;
  InstallationReady := Exec(ExpandConstant('{app}\runtime\Grobys-Deck-Node.exe'), Arguments,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  InstallationReady := InstallationReady and (ResultCode = 0);
  if not InstallationReady then begin
    SuppressibleMsgBox('First-time setup checks failed. Open runtime\logs\setup-check.log in your installation folder for the missing prerequisite. Repair the installation before launch. Use the default per-user folder if the selected folder is not writable.', mbError, MB_OK, IDOK);
    Exit;
  end;
  if not ExistingInstall then begin
    InstallationReady := ConfigureFeature('twitch-integration', WizardIsTaskSelected('feature_twitch_integration_bundled')) and InstallationReady;
    InstallationReady := ConfigureFeature('song-request', WizardIsTaskSelected('feature_song_request_bundled')) and InstallationReady;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Problem: String; Version: TWindowsVersion;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    Problem := LegacyFolderProblem;
    if Problem <> '' then begin SuppressibleMsgBox(Problem, mbError, MB_OK, IDOK); Result := False; end;
  end;
  if (CurPageID = wpSelectTasks) and WizardIsTaskSelected('music_to_light') then begin
    GetWindowsVersionEx(Version);
    if Version.Build < 20348 then begin
      SuppressibleMsgBox('Music-to-Light application capture requires Windows build 20348 or later (Windows 11 recommended). Uncheck Music-to-Light to install other features on this PC.', mbInformation, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;
`
    .trim()
    .split("\n");
