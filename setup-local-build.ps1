# setup-local-build.ps1
# One-time setup for local Android (Expo) debug builds on Windows.
# Idempotent: safe to re-run. Detects existing JDK 17 / Android SDK and wires
# up the persistent user environment variables Expo + Gradle need.
#
# Usage:
#   Normal shell : sets JAVA_HOME / ANDROID_HOME / PATH (per-user, no admin).
#   Elevated     : ALSO enables Win32 long-path support (HKLM, needs admin).
#
# After running, open a NEW shell so the updated env vars load.

$ErrorActionPreference = 'Stop'

function Set-UserEnv($name, $value) {
    [Environment]::SetEnvironmentVariable($name, $value, 'User')
    Set-Item -Path "Env:$name" -Value $value   # also apply to current session
    Write-Host "  $name = $value" -ForegroundColor Gray
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "== TWOFER local Android build setup ==" -ForegroundColor Cyan

# --- 1. Locate a JDK 17 -------------------------------------------------------
Write-Host "`n[1/4] Locating JDK 17..." -ForegroundColor Yellow
$jdk = $null
$candidates = @(
    $env:JAVA_HOME,
    "$env:USERPROFILE\.gradle\jdks\eclipse_adoptium-17-amd64-windows.2",
    "$env:ProgramFiles\Eclipse Adoptium\jdk-17*",
    "$env:ProgramFiles\Microsoft\jdk-17*",
    "$env:ProgramFiles\Android\Android Studio\jbr"
)
foreach ($c in $candidates) {
    if (-not $c) { continue }
    $resolved = Get-Item $c -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($resolved -and (Test-Path "$($resolved.FullName)\bin\java.exe")) {
        # java -version prints to stderr; capture without tripping -ErrorAction Stop
        $ver = (cmd /c "`"$($resolved.FullName)\bin\java.exe`" -version 2>&1") | Out-String
        if ($ver -match 'version "17') { $jdk = $resolved.FullName; break }
    }
}
if (-not $jdk) {
    Write-Host "  No JDK 17 found. Install Temurin 17:" -ForegroundColor Red
    Write-Host "    winget install EclipseAdoptium.Temurin.17.JDK" -ForegroundColor Red
    throw "JDK 17 not found."
}
Write-Host "  Found JDK 17: $jdk" -ForegroundColor Green
Set-UserEnv 'JAVA_HOME' $jdk

# --- 2. Locate the Android SDK -----------------------------------------------
Write-Host "`n[2/4] Locating Android SDK..." -ForegroundColor Yellow
$sdk = $null
foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
                 "$env:LOCALAPPDATA\Android\Sdk")) {
    if ($c -and (Test-Path "$c\platform-tools\adb.exe")) { $sdk = $c; break }
}
if (-not $sdk) {
    Write-Host "  No Android SDK found. Install Android Studio or the" -ForegroundColor Red
    Write-Host "  command-line tools, then re-run this script." -ForegroundColor Red
    throw "Android SDK not found."
}
Write-Host "  Found Android SDK: $sdk" -ForegroundColor Green
Set-UserEnv 'ANDROID_HOME' $sdk
Set-UserEnv 'ANDROID_SDK_ROOT' $sdk

# --- 3. Ensure SDK tools are on the user PATH --------------------------------
Write-Host "`n[3/4] Updating user PATH..." -ForegroundColor Yellow
$wanted = @(
    "$jdk\bin",
    "$sdk\platform-tools",
    "$sdk\emulator",
    "$sdk\cmdline-tools\latest\bin"
) | Where-Object { Test-Path $_ }

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = ($userPath -split ';') | Where-Object { $_ -ne '' }
foreach ($p in $wanted) {
    if ($parts -notcontains $p) { $parts += $p; Write-Host "  + $p" -ForegroundColor Gray }
}
$newPath = ($parts -join ';')
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
$env:Path = "$newPath;$([Environment]::GetEnvironmentVariable('Path','Machine'))"

# --- 4. Enable Win32 long paths (needs admin) --------------------------------
Write-Host "`n[4/4] Enabling long-path support..." -ForegroundColor Yellow
$reg = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
$cur = (Get-ItemProperty $reg -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled
if ($cur -eq 1) {
    Write-Host "  Already enabled." -ForegroundColor Green
} elseif (Test-Admin) {
    Set-ItemProperty $reg -Name LongPathsEnabled -Value 1 -Type DWord
    Write-Host "  Enabled LongPathsEnabled = 1 (reboot recommended)." -ForegroundColor Green
} else {
    Write-Host "  NOT elevated - cannot write HKLM. Run this in an ADMIN shell:" -ForegroundColor Red
    Write-Host '    Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -Type DWord' -ForegroundColor Red
}

Write-Host "`nDone. Open a NEW shell, then:  java -version  &&  adb version" -ForegroundColor Cyan
