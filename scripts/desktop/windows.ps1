param(
  [Parameter(Mandatory)][ValidateSet('install','snapshot','change-associations','associations','executables','run-script','open','uninstall','stop','probe')][string]$Action,
  [Parameter(Mandatory)][string]$Root,
  [string]$Installer,
  [string]$File,
  [string]$Class
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Requires a disposable GitHub-hosted runner.' }
$testRoot = [IO.Path]::GetFullPath($Root)
$tempRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (!$testRoot.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $testRoot -Leaf).StartsWith('va-desktop')) { throw 'Invalid test root.' }
$installPath = Join-Path $testRoot 'installed app'
$exe = Join-Path $installPath 'view-anything.exe'
$config = Get-Content -LiteralPath (Join-Path $testRoot 'config-0.0.1.json') -Raw | ConvertFrom-Json
$expectedPath = Join-Path $testRoot 'registry-expected.json'
$otherClass = 'com.rafaam11.viewanything.desktop-smoke.other'
$previousClass = 'com.rafaam11.viewanything.desktop-smoke.previous'
$legacyClass = 'com.rafaam11.viewanything.desktop-smoke.legacy'
# Office files are only offered under Open With; the handler seeded here must keep .docx.
$officeClass = 'com.rafaam11.viewanything.office'
$officeOwner = 'com.rafaam11.viewanything.desktop-smoke.office-owner'
# What the shell runs: never associated, repaired from what versions up to 0.16 wrote (file-associations.nsh).
$scripts = @('bat','cmd','ps1','js','py','sh','bash')
$executables = $scripts + @('vbs','vbe','jse','wsf','wsh','hta','reg','exe','com','msi','lnk','scr','pif','cpl')
$prefix = 'com.rafaam11.viewanything.'
$oldText = 'com.rafaam11.viewanything.text'
$fileExts = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts'
$verb = 'com.rafaam11.viewanything.view'
$executablesPath = Join-Path $testRoot 'executables-expected.json'
function Ours([string]$Value) { return $Value.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and $Value -notlike '*desktop-smoke*' }
function OurValues([string]$Key) {
  $item = Get-Item -LiteralPath $Key -ErrorAction SilentlyContinue
  if (!$item) { return @() }
  return @($item.GetValueNames() | Where-Object { Ours $_ })
}
function ExecutableState {
  $result = @{}
  foreach ($ext in $executables) { $result[$ext] = RegistryDefault "HKCU:\Software\Classes\.$ext" }
  $result['*'] = RegistryDefault 'HKCU:\Software\Classes\*'
  return $result
}
function RegistryDefault([string]$Key) {
  $item = Get-Item -LiteralPath $Key -ErrorAction SilentlyContinue
  if ($item) { return [string]$item.GetValue('','') }
  return ''
}
function Stop-TestApp {
  Get-Process view-anything -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
}
function AssociationState {
  $result = @{}
  foreach ($a in $config.bundle.fileAssociations) {
    foreach ($ext in $a.ext) { $result[$ext] = RegistryDefault "HKCU:\Software\Classes\.$ext" }
  }
  return $result
}
switch ($Action) {
  'snapshot' {
    $state = AssociationState
    $state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'registry-before.json') -Encoding UTF8
    # Seed a nonempty previous handler so restore is not just an empty-value check.
    New-Item -Path 'HKCU:\Software\Classes\.txt' -Force | Out-Null
    Set-Item -LiteralPath 'HKCU:\Software\Classes\.txt' -Value $previousClass
    $state.txt = $previousClass
    New-Item -Path 'HKCU:\Software\Classes\.docx' -Force | Out-Null
    Set-Item -LiteralPath 'HKCU:\Software\Classes\.docx' -Value $officeOwner
    $state.docx = $officeOwner
    $state | ConvertTo-Json | Set-Content -LiteralPath $expectedPath -Encoding UTF8
    # What 0.16 left on PCs: script defaults taken (with an empty or a real backup), Open With entries
    # in Classes and in Explorer's FileExts, and a value on "*". Install and update must undo all of it.
    $before = ExecutableState
    $before | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'executables-before.json') -Encoding UTF8
    $wanted = ExecutableState
    foreach ($ext in @('bat','cmd','ps1')) {
      New-Item -Path "HKCU:\Software\Classes\.$ext\OpenWithProgids" -Force | Out-Null
      Set-Item -LiteralPath "HKCU:\Software\Classes\.$ext" -Value $oldText
      New-ItemProperty -LiteralPath "HKCU:\Software\Classes\.$ext\OpenWithProgids" -Name $oldText -Value '' -PropertyType String -Force | Out-Null
      New-Item -Path "$fileExts\.$ext\OpenWithProgids" -Force | Out-Null
      New-ItemProperty -LiteralPath "$fileExts\.$ext\OpenWithProgids" -Name $oldText -Value ([byte[]]@()) -PropertyType None -Force | Out-Null
    }
    New-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.bat' -Name ($oldText + '_backup') -Value '' -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.ps1' -Name ($oldText + '_backup') -Value 'Microsoft.PowerShellScript.1' -PropertyType String -Force | Out-Null
    $wanted.ps1 = 'Microsoft.PowerShellScript.1'
    # .NET, not New-Item: a registry path of "*" must not be read as a wildcard.
    $all = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Classes\*')
    $all.SetValue('', $oldText); $all.Close()
    $wanted | ConvertTo-Json | Set-Content -LiteralPath $executablesPath -Encoding UTF8
  }
  'change-associations' {
    $expected = Get-Content -LiteralPath $expectedPath -Raw | ConvertFrom-Json
    # Another app selected after installation must survive update AND uninstall.
    Set-Item -LiteralPath 'HKCU:\Software\Classes\.log' -Value $otherClass
    $expected.log = $otherClass
    # Simulate an older generic class owned by the same executable and its backup.
    New-Item -Path "HKCU:\Software\Classes\$legacyClass\shell\open\command" -Force | Out-Null
    Set-Item -LiteralPath "HKCU:\Software\Classes\$legacyClass\shell\open\command" -Value "`"$exe`" `"%1`""
    Set-Item -LiteralPath 'HKCU:\Software\Classes\.md' -Value $legacyClass
    New-ItemProperty -LiteralPath 'HKCU:\Software\Classes\.md' -Name "${legacyClass}_backup" -Value ([string]$expected.md) -PropertyType String -Force | Out-Null
    $expected | ConvertTo-Json | Set-Content -LiteralPath $expectedPath -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $testRoot 'associations-changed') -Value 'true'
  }
  'install' {
    if (!(Test-Path -LiteralPath $Installer -PathType Leaf)) { throw 'Installer is missing.' }
    $process = Start-Process -FilePath $Installer -ArgumentList @('/S',"/D=$installPath") -PassThru -Wait -WindowStyle Hidden
    if ($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $exe)) { throw "Installation failed: $($process.ExitCode)" }
  }
  'associations' {
    $expected = Get-Content -LiteralPath $expectedPath -Raw | ConvertFrom-Json
    foreach ($a in $config.bundle.fileAssociations) {
      $command = RegistryDefault "HKCU:\Software\Classes\$($a.name)\shell\open\command"
      if ($command -ne "`"$exe`" `"%1`"") { throw "Unexpected association command for $($a.name): $command" }
      foreach ($ext in $a.ext) {
        $openWith = Get-Item -LiteralPath "HKCU:\Software\Classes\.$ext\OpenWithProgids" -ErrorAction SilentlyContinue
        if (!$openWith -or $openWith.GetValueNames() -notcontains $a.name) { throw "Open With is missing $($a.name) for .$ext" }
        # Open With only: every default stays as it was, except the two seeded update scenarios.
        $changed = Test-Path -LiteralPath (Join-Path $testRoot 'associations-changed')
        $wanted = if ($changed -and $ext -eq 'log') { $otherClass } elseif ($changed -and $ext -eq 'md') { $a.name } else { [string]$expected.$ext }
        if ((RegistryDefault "HKCU:\Software\Classes\.$ext") -ne $wanted) { throw "Unexpected .$ext registration" }
      }
    }
    Write-Output 'PASS registry extension classes, Open With entries, untouched defaults and quoted file-open commands'
  }
  'executables' {
    $wanted = Get-Content -LiteralPath $executablesPath -Raw | ConvertFrom-Json
    foreach ($ext in $executables) {
      $actual = RegistryDefault "HKCU:\Software\Classes\.$ext"
      if ($actual -ne [string]$wanted.$ext) { throw ".$ext default not repaired. Expected '$($wanted.$ext)', got '$actual'." }
      foreach ($key in @("HKCU:\Software\Classes\.$ext", "HKCU:\Software\Classes\.$ext\OpenWithProgids", "$fileExts\.$ext\OpenWithProgids")) {
        $left = OurValues $key
        if ($left.Count) { throw "Our values remain in $($key): $($left -join ', ')" }
      }
    }
    if ((RegistryDefault 'HKCU:\Software\Classes\*') -ne [string]$wanted.'*') { throw 'The value on * was not cleared.' }
    foreach ($ext in $scripts) {
      $key = "HKCU:\Software\Classes\SystemFileAssociations\.$ext\shell\$verb"
      $command = RegistryDefault "$key\command"
      if ($command -ne "`"$exe`" `"%1`"") { throw "Unexpected verb command for .$($ext): $command" }
      if ((Get-ItemProperty -LiteralPath $key -Name MUIVerb).MUIVerb -notlike 'View Anything*') { throw "Unexpected verb name for .$ext" }
    }
    Write-Output 'PASS script and executable types repaired (defaults, backups, Open With in Classes and FileExts, *) and offered only as a right-click verb'
  }
  'run-script' {
    # A double-click: ShellExecuteEx "open" with no class, as Explorer does. The script must run.
    $bat = Join-Path $testRoot 'files with spaces\run me.bat'
    $marker = Join-Path $testRoot 'files with spaces\ran.txt'
    Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $bat -Value '@echo ran> "%~dp0ran.txt"' -Encoding ASCII
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ShellRun {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Info {
    public int cbSize; public uint mask; public IntPtr hwnd;
    public string verb, file, parameters, directory; public int show;
    public IntPtr instance, idList; public string cls; public IntPtr key;
    public uint hotkey; public IntPtr icon, process;
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool ShellExecuteEx(ref Info info);
}
'@
    $info = New-Object ShellRun+Info
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $info.mask = 0x400; $info.verb = 'open'; $info.file = $bat; $info.show = 0
    if (![ShellRun]::ShellExecuteEx([ref]$info)) { throw "ShellExecuteEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
    $end = (Get-Date).AddSeconds(30)
    while (!(Test-Path -LiteralPath $marker) -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 250 }
    if (!(Test-Path -LiteralPath $marker)) { throw 'Opening the .bat did not run it (an app picker or another app took it).' }
    Remove-Item -LiteralPath $marker, $bat -Force
    Write-Output 'PASS a .bat opened like a double-click runs in cmd'
  }
  'open' {
    if (!$File.StartsWith($testRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Only synthetic test files may be opened.' }
    # ShellExecuteEx by registered class exercises the real Open With command without
    # changing Windows UserChoice hashes/default-app preferences.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ShellOpen {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Info {
    public int cbSize; public uint mask; public IntPtr hwnd;
    public string verb, file, parameters, directory; public int show;
    public IntPtr instance, idList; public string cls; public IntPtr key;
    public uint hotkey; public IntPtr icon, process;
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool ShellExecuteEx(ref Info info);
}
'@
    $info = New-Object ShellOpen+Info
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $info.mask = 1; $info.verb = 'open'; $info.file = $File; $info.cls = $Class; $info.show = 1
    if (![ShellOpen]::ShellExecuteEx([ref]$info)) { throw "ShellExecuteEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  }
  'stop' { Stop-TestApp }
  'probe' { @(Get-Process view-anything -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Select-Object -ExpandProperty Id) | ConvertTo-Json -Compress }
  'uninstall' {
    Stop-TestApp
    $uninstaller = Join-Path $installPath 'uninstall.exe'
    if (Test-Path -LiteralPath $uninstaller) {
      $process = Start-Process -FilePath $uninstaller -ArgumentList @('/S',"_?=$installPath") -Wait -PassThru -WindowStyle Hidden
      if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
    }
    if (Test-Path -LiteralPath $exe) { throw 'Installed binary remains after uninstall.' }
    $expected = Get-Content -LiteralPath $expectedPath -Raw | ConvertFrom-Json
    AssociationState | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'evidence/registry-after-uninstall.json') -Encoding UTF8
    foreach ($a in $config.bundle.fileAssociations) {
      foreach ($ext in $a.ext) {
        $actual = RegistryDefault "HKCU:\Software\Classes\.$ext"
        if ($actual -ne [string]$expected.$ext) { throw "Previous .$ext registration was not restored. Expected '$($expected.$ext)', got '$actual'." }
        $key = Get-Item -LiteralPath "HKCU:\Software\Classes\.$ext" -ErrorAction SilentlyContinue
        if ($key -and $key.GetValueNames() -contains "$($a.name)_backup") { throw "Association backup remains: .$ext" }
      }
      if (Test-Path -LiteralPath "HKCU:\Software\Classes\$($a.name)") { throw "Class remains after uninstall: $($a.name)" }
    }
    $wanted = Get-Content -LiteralPath $executablesPath -Raw | ConvertFrom-Json
    foreach ($ext in $executables) {
      $actual = RegistryDefault "HKCU:\Software\Classes\.$ext"
      if ($actual -ne [string]$wanted.$ext) { throw ".$ext default changed by uninstall. Expected '$($wanted.$ext)', got '$actual'." }
    }
    foreach ($ext in $scripts) {
      if (Test-Path -LiteralPath "HKCU:\Software\Classes\SystemFileAssociations\.$ext\shell\$verb") { throw "Verb remains after uninstall: .$ext" }
    }
    # Nothing of ours anywhere in the user's classes or Explorer's per-type records (test-only names aside).
    $traces = @()
    foreach ($root in @('HKCU:\Software\Classes', $fileExts)) {
      # "Local Settings" is Windows' own cache (MuiCache keeps names of every app that ran).
      foreach ($key in @(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '*\Local Settings*' })) {
        if ($key.Name -like '*desktop-smoke*') { continue } # this test's own classes, removed below
        if ((Ours $key.PSChildName)) { $traces += $key.Name; continue }
        foreach ($name in $key.GetValueNames()) {
          $data = [string]$key.GetValue($name, '', 'DoNotExpandEnvironmentNames')
          if ((Ours $name) -or (Ours $data) -or ($data -like "*$installPath*")) { $traces += "$($key.Name) [$name]" }
        }
      }
    }
    if ($traces.Count) { throw "Traces remain after uninstall: $(($traces | Select-Object -First 20) -join '; ')" }
    $executablesBefore = Get-Content -LiteralPath (Join-Path $testRoot 'executables-before.json') -Raw | ConvertFrom-Json
    foreach ($ext in @('bat','cmd','ps1','*')) {
      $key = if ($ext -eq '*') { 'HKCU:\Software\Classes\*' } else { "HKCU:\Software\Classes\.$ext" }
      if ([string]$executablesBefore.$ext) { Set-Item -LiteralPath $key -Value ([string]$executablesBefore.$ext) }
      else { Remove-ItemProperty -LiteralPath $key -Name '(default)' -ErrorAction SilentlyContinue }
    }
    $before = Get-Content -LiteralPath (Join-Path $testRoot 'registry-before.json') -Raw | ConvertFrom-Json
    foreach ($ext in @('txt','log','docx')) {
      if ([string]$before.$ext) { Set-Item -LiteralPath "HKCU:\Software\Classes\.$ext" -Value ([string]$before.$ext) }
      else { Remove-ItemProperty -LiteralPath "HKCU:\Software\Classes\.$ext" -Name '(default)' -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath "HKCU:\Software\Classes\$legacyClass" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output 'PASS uninstall removes binary/classes/verbs, leaves no traces and restores previous extension registration'
  }
}
