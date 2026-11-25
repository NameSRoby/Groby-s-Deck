/** Installer checks run before allowing launch; failures stay visible. */
module.exports = () =>
  String.raw`
var
  InstallationReady: Boolean;

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
  if WizardIsTaskSelected('music_to_light') then begin
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
  InstallationReady := ConfigureFeature('twitch-integration', WizardIsTaskSelected('feature_twitch_integration_bundled')) and InstallationReady;
  InstallationReady := ConfigureFeature('song-request', WizardIsTaskSelected('feature_song_request_bundled')) and InstallationReady;
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
