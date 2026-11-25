/** Reuse installed Evergreen; otherwise verify and run the bundled offline runtime. */
const spec = require("../desktop/windows-host/prerequisites.json").webview2;
const installerPath = "{tmp}\\" + spec.file;
module.exports = () =>
  String.raw`
function WebViewRuntimeIn(const RootKey: Integer): Boolean;
var Version: String;
begin
  Result := False;
  if RegQueryStringValue(RootKey, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) then
    Result := StrToIntDef(Copy(Version, 1, Pos('.', Version) - 1), 0) >= ${spec.minimumMajor};
end;
function WebViewRuntimePresent: Boolean;
begin
  Result := WebViewRuntimeIn(HKLM32) or WebViewRuntimeIn(HKCU32);
end;
function EnsureWebViewRuntime(var NeedsRestart: Boolean): String;
var ResultCode: Integer; InstallerPath: String;
begin
  Result := '';
  if WebViewRuntimePresent then Exit;
  WizardForm.StatusLabel.Caption := 'Installing bundled Microsoft Edge WebView2 Runtime...';
  ExtractTemporaryFile('${spec.file}');
  InstallerPath := ExpandConstant('${installerPath}');
  if CompareText(GetSHA256OfFile(InstallerPath), '${spec.sha256}') <> 0 then begin
    Result := 'The bundled WebView2 installer failed its integrity check. Download a fresh installer.';
    Exit;
  end;
  if not Exec(InstallerPath, '/silent /install', ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    Result := 'Could not start the bundled WebView2 installer. Retry Setup.';
    Exit;
  end;
  Log(Format('Bundled WebView2 installer exit code: %d', [ResultCode]));
  if (ResultCode = 3010) or (ResultCode = 1641) then NeedsRestart := True;
  if not WebViewRuntimePresent then
    Result := 'Microsoft WebView2 could not finish installing (code ' + IntToStr(ResultCode) + '). Restart Windows if requested and run Setup again.';
end;
`
    .trim()
    .split("\n");
