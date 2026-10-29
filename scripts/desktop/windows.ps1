param(
  [Parameter(Mandatory)][ValidateSet('install','snapshot','change-associations','associations','open','uninstall','stop','probe')][string]$Action,
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
    $state | ConvertTo-Json | Set-Content -LiteralPath $expectedPath -Encoding UTF8
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
    foreach ($a in $config.bundle.fileAssociations) {
      $command = RegistryDefault "HKCU:\Software\Classes\$($a.name)\shell\open\command"
      if ($command -ne "`"$exe`" `"%1`"") { throw "Unexpected association command for $($a.name): $command" }
      foreach ($ext in $a.ext) {
        $wanted = if ($ext -eq 'log' -and (Test-Path -LiteralPath (Join-Path $testRoot 'associations-changed'))) { $otherClass } else { $a.name }
        if ((RegistryDefault "HKCU:\Software\Classes\.$ext") -ne $wanted) { throw "Unexpected .$ext registration" }
      }
    }
    Write-Output 'PASS registry extension classes and quoted file-open commands'
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
    $before = Get-Content -LiteralPath (Join-Path $testRoot 'registry-before.json') -Raw | ConvertFrom-Json
    foreach ($ext in @('txt','log')) {
      if ([string]$before.$ext) { Set-Item -LiteralPath "HKCU:\Software\Classes\.$ext" -Value ([string]$before.$ext) }
      else { Remove-ItemProperty -LiteralPath "HKCU:\Software\Classes\.$ext" -Name '(default)' -ErrorAction SilentlyContinue }
    }
    Remove-Item -LiteralPath "HKCU:\Software\Classes\$legacyClass" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output 'PASS uninstall removes binary/classes and restores previous extension registration'
  }
}
