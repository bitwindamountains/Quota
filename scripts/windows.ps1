param([ValidateSet('Start','Stop','Shortcuts','EnableStartup','DisableStartup')][string]$Action = 'Start', [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcherPath = Join-Path $PSScriptRoot 'windows.ps1'
$serverPath = Join-Path $projectRoot 'dist\server\index.js'
$shortcutName = 'Quota - ' + (Split-Path $projectRoot -Leaf)
$startupPath = Join-Path ([Environment]::GetFolderPath('Startup')) ($shortcutName + '.lnk')
function Add-Shortcut([string]$target, [string]$operation, [bool]$background) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($target)
  $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcherPath + '" -Action ' + $operation
  if ($background) { $link.Arguments += ' -NoBrowser' }
  $link.WorkingDirectory = $projectRoot
  $link.Description = 'Quota local server (' + $projectRoot + ')'
  $link.Save()
}
if ($Action -eq 'EnableStartup') { Add-Shortcut $startupPath 'Start' $true; Write-Output 'Quota will start at sign-in for this Windows user.'; exit }
if ($Action -eq 'DisableStartup') { if (Test-Path -LiteralPath $startupPath) { Remove-Item -LiteralPath $startupPath }; Write-Output 'Quota start-at-login removed.'; exit }
if ($Action -eq 'Shortcuts') {
  $desktopPath = [Environment]::GetFolderPath('Desktop')
  Add-Shortcut (Join-Path $desktopPath ('Start ' + $shortcutName + '.lnk')) 'Start' $false
  Add-Shortcut (Join-Path $desktopPath ('Stop ' + $shortcutName + '.lnk')) 'Stop' $true
  Write-Output 'Start and Stop Quota shortcuts created on your desktop.'; exit
}
if (!(Test-Path -LiteralPath $serverPath)) { throw 'Build Quota first: npm.cmd ci, then npm.cmd run build.' }
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
Push-Location $projectRoot
try {
  # Node parses .env. Only non-secret runtime configuration is returned to this script.
  $configText = & $nodePath --env-file-if-exists=.env (Join-Path $PSScriptRoot 'local-config.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Unable to load Quota configuration.' }
  $config = $configText | ConvertFrom-Json
  if ($config.port -lt 1024 -or $config.port -gt 65535) { throw 'Invalid PORT setting.' }
  $lockPath = Join-Path $config.dir 'app.lock'
  $owned = $null
  if (Test-Path -LiteralPath $lockPath) {
    $ownerId = 0
    if ([int]::TryParse((Get-Content -LiteralPath $lockPath -Raw).Trim(), [ref]$ownerId) -and $ownerId -gt 0) {
      $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerId" -ErrorAction SilentlyContinue
      # Exact executable + absolute server argument. Never kill a PID solely because it is in a file.
      if ($candidate -and $candidate.ExecutablePath -eq $nodePath -and $candidate.CommandLine -like ('*"' + $serverPath + '"*')) { $owned = $candidate }
      elseif ($candidate) { throw 'Another process owns this data directory. If Quota was started in a terminal, stop it there with Ctrl+C.' }
    }
  }
  if ($Action -eq 'Stop') {
    if ($owned) { Stop-Process -Id $owned.ProcessId; Write-Output 'Quota stopped. Collection and email reminders are paused.' }
    else { Write-Output 'No launcher-owned Quota process is running.' }
    exit
  }
  $url = 'http://127.0.0.1:' + $config.port
  if (!$owned) {
    if (Get-NetTCPConnection -LocalPort $config.port -State Listen -ErrorAction SilentlyContinue) { throw 'The Quota port is occupied. Stop the existing server before using this launcher.' }
    $null = New-Item -ItemType Directory -Path $config.dir -Force
    $child = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env', ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $config.dir 'launcher.stdout.log') -RedirectStandardError (Join-Path $config.dir 'launcher.stderr.log') -PassThru
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { $health = Invoke-RestMethod -Uri ($url + '/api/health') -TimeoutSec 1; if ($health.ready -eq $true) { $ready = $true; break } } catch { }
    if ($child -and $child.HasExited) { break }
    Start-Sleep -Milliseconds 250
  }
  if (!$ready) { throw 'Quota did not become ready. Check launcher.stderr.log in the application data directory.' }
  if (!$NoBrowser) { Start-Process $url }
  Write-Output ('Quota is ready at ' + $url)
} finally { Pop-Location }
