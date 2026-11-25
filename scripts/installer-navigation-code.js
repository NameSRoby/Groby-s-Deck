module.exports = () =>
  String.raw`
var
  NavigationPage: TWizardPage;
  NavigationChoices: array[0..8] of TNewComboBox;
  NavigationApply: TNewCheckBox;

procedure InitializeWizard;
var
  I: Integer;
  Names: array[0..8] of String;
  RowLabel: TNewStaticText;
begin
  NavigationPage := CreateCustomPage(wpSelectTasks, 'Choose your tabs', 'Choose Main, More, or Hidden. Change these later from the settings gear.');
  Names[0] := 'Dashboard'; Names[1] := 'Lights'; Names[2] := 'Fixtures'; Names[3] := 'Widget';
  Names[4] := 'Song Request'; Names[5] := 'Twitch Integration';
  Names[6] := 'Updates'; Names[7] := 'Packages'; Names[8] := 'Community mods';
  for I := 0 to 8 do begin
    RowLabel := TNewStaticText.Create(NavigationPage);
    RowLabel.Parent := NavigationPage.Surface; RowLabel.Caption := Names[I];
    RowLabel.Top := I * (NavigationPage.SurfaceHeight div 12) + ScaleY(3);
    NavigationChoices[I] := TNewComboBox.Create(NavigationPage);
    NavigationChoices[I].Parent := NavigationPage.Surface;
    NavigationChoices[I].Top := I * (NavigationPage.SurfaceHeight div 12);
    NavigationChoices[I].Left := NavigationPage.SurfaceWidth div 2;
    NavigationChoices[I].Width := NavigationPage.SurfaceWidth div 2;
    NavigationChoices[I].Style := csDropDownList;
    NavigationChoices[I].Items.Add('Main tabs'); NavigationChoices[I].Items.Add('More menu'); NavigationChoices[I].Items.Add('Hidden');
    if I < 6 then NavigationChoices[I].ItemIndex := 0 else NavigationChoices[I].ItemIndex := 1;
  end;
  NavigationApply := TNewCheckBox.Create(NavigationPage);
  NavigationApply.Parent := NavigationPage.Surface;
  NavigationApply.Top := 9 * (NavigationPage.SurfaceHeight div 12) + ScaleY(5);
  NavigationApply.Width := NavigationPage.SurfaceWidth;
  NavigationApply.Caption := 'Apply this layout (unchecked keeps your existing layout)';
  NavigationApply.Checked := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = NavigationPage.ID then
    NavigationApply.Checked := not FileExists(ExpandConstant('{app}\runtime\system\navigation.json'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  I: Integer;
  Keys: array[0..8] of String;
  Modes: array[0..2] of String;
  Contents: String;
begin
  if CurStep <> ssPostInstall then Exit;
  CompleteFirstRunSetup;
  if not InstallationReady or not NavigationApply.Checked then Exit;
  if WizardSilent and FileExists(ExpandConstant('{app}\runtime\system\navigation.json')) then Exit;
  Keys[0] := 'dashboard'; Keys[1] := 'lights'; Keys[2] := 'fixtures'; Keys[3] := 'widget';
  Keys[4] := 'feature:song-request'; Keys[5] := 'feature:twitch-integration';
  Keys[6] := 'updates'; Keys[7] := 'features'; Keys[8] := 'mods';
  Modes[0] := 'main'; Modes[1] := 'more'; Modes[2] := 'hidden';
  Contents := '{"version":1,"tabs":{';
  for I := 0 to 8 do begin
    if I > 0 then Contents := Contents + ',';
    Contents := Contents + '"' + Keys[I] + '":"' + Modes[NavigationChoices[I].ItemIndex] + '"';
  end;
  Contents := Contents + '}}';
  ForceDirectories(ExpandConstant('{app}\runtime\system'));
  if not SaveStringToFile(ExpandConstant('{app}\runtime\system\navigation.json'), Contents, False) then
    SuppressibleMsgBox('Could not save the tab layout. You can choose tabs from the settings gear after launch.', mbInformation, MB_OK, IDOK);
end;
`
    .trim()
    .split("\n");
