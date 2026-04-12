$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$serverOrigin = if ([string]::IsNullOrWhiteSpace($env:SKILL_RUNNER_SERVER)) { 'http://127.0.0.1:8000' } else { $env:SKILL_RUNNER_SERVER.TrimEnd('/') }
$pollIntervalMs = 1500
$skillRunTimeoutMs = 5 * 60 * 1000
$logDir = Join-Path $projectRoot 'logs'
$logFile = Join-Path $logDir 'skill-runner.log'
$runnerConfigPath = Join-Path $projectRoot 'data\skill-runner-config.json'

try {
  Add-Type -AssemblyName System.Web.Extensions -ErrorAction Stop
} catch {}

if (-not (Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

function Write-RunnerLog {
  param([string]$Message)
  $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message)
  Add-Content -Path $logFile -Value $line
}

function Get-RunnerConfig {
  if (-not (Test-Path $runnerConfigPath)) {
    return @{}
  }
  try {
    $raw = Get-Content $runnerConfigPath -Raw | ConvertFrom-Json
    $result = @{}
    if ($raw) {
      $raw.PSObject.Properties | ForEach-Object {
        $result[$_.Name] = $_.Value
      }
    }
    return $result
  } catch {
    Write-RunnerLog "failed to read skill runner config: $($_.Exception.Message)"
    return @{}
  }
}

function ConvertTo-JsonString {
  param([object]$Value)

  try {
    $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
    $serializer.MaxJsonLength = 67108864
    return $serializer.Serialize($Value)
  } catch {
    return $Value | ConvertTo-Json -Depth 8 -Compress
  }
}

function Get-RelativePathCompat {
  param(
    [string]$BasePath,
    [string]$TargetPath
  )

  $baseFull = [System.IO.Path]::GetFullPath($BasePath)
  $targetFull = [System.IO.Path]::GetFullPath($TargetPath)

  if ($targetFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $targetFull.Substring($baseFull.Length).TrimStart('\', '/').Replace('\', '/')
  }

  return $targetFull.Replace('\', '/')
}

function Invoke-RunnerJson {
  param(
    [string]$Method,
    [string]$Url,
    [object]$Body = $null
  )

  $headers = @{
    'X-Skill-Runner-Version' = '2'
  }

  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers
  }

  $json = ConvertTo-JsonString $Body
  return Invoke-RestMethod -Method $Method -Uri $Url -Headers $headers -ContentType 'application/json' -Body $json
}

function Get-SkillEntryPath {
  param([string]$SkillName)

  $skillDir = Join-Path $projectRoot (Join-Path 'skills' $SkillName)
  foreach ($candidate in @('run-with-notify.js', 'run.js', 'index.js')) {
    $entryPath = Join-Path $skillDir $candidate
    if (Test-Path $entryPath) {
      return $entryPath
    }
  }
  throw "No supported skill entry script found"
}

function Detect-MissingRuntimeIssue {
  param([string]$Text)
  if ($Text -match "Cannot find module ['""]playwright['""]") {
    return 'missing-playwright-package'
  }
  if ($Text -match "Executable doesn't exist" -or $Text -match 'Please run the following command to download new browsers') {
    return 'missing-playwright-browser'
  }
  return ''
}

function Invoke-ExternalProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList,
    [string]$WorkingDirectory,
    [int]$TimeoutMs = 600000,
    [hashtable]$Environment = @{}
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FilePath
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  foreach ($key in $Environment.Keys) {
    $psi.Environment[$key] = [string]$Environment[$key]
  }
  $escapedArguments = @($ArgumentList | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + (($_ -replace '\\(?=")', '\\') -replace '"', '\"') + '"'
    } else {
      $_
    }
  })
  $psi.Arguments = [string]::Join(' ', $escapedArguments)

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi

  if (-not $process.Start()) {
    throw "Failed to start process: $FilePath"
  }

  if (-not $process.WaitForExit($TimeoutMs)) {
    try { $process.Kill() } catch {}
    throw "Command timed out: $FilePath"
  }

  $stdout = $process.StandardOutput.ReadToEnd().Trim()
  $stderr = $process.StandardError.ReadToEnd().Trim()

  if ($process.ExitCode -ne 0) {
    $message = if ($stderr) { $stderr } elseif ($stdout) { $stdout } else { "Command failed with code $($process.ExitCode)" }
    $error = New-Object System.Exception($message)
    $error | Add-Member -NotePropertyName stdout -NotePropertyValue $stdout
    $error | Add-Member -NotePropertyName stderr -NotePropertyValue $stderr
    $error | Add-Member -NotePropertyName exitCode -NotePropertyValue $process.ExitCode
    throw $error
  }

  return @{
    stdout = $stdout
    stderr = $stderr
    exitCode = $process.ExitCode
  }
}

function Get-CdpBrowserPath {
  $config = Get-RunnerConfig
  $configuredPath = ''
  if ($config.ContainsKey('browserPath')) {
    $configuredPath = [string]$config.browserPath
  }
  if ([string]::IsNullOrWhiteSpace($configuredPath)) {
    $configuredPath = [string]$env:SKILL_RUNNER_BROWSER_PATH
  }
  if (-not [string]::IsNullOrWhiteSpace($configuredPath) -and (Test-Path $configuredPath)) {
    return $configuredPath
  }

  $headlessShellPath = Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium_headless_shell-1217\chrome-headless-shell-win64\chrome-headless-shell.exe'
  $candidates = @(
    $headlessShellPath,
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates.Count -gt 0) {
    return $candidates[0]
  }
  throw 'No supported browser executable found for CDP fallback'
}

function Start-ExternalChromeCdp {
  param([bool]$Headless = $false)

  $chromePath = Get-CdpBrowserPath
  $port = Get-Random -Minimum 19222 -Maximum 19999
  $profilesRoot = Join-Path $projectRoot 'data\runner-browser-profiles'
  if (-not (Test-Path $profilesRoot)) {
    New-Item -ItemType Directory -Path $profilesRoot -Force | Out-Null
  }
  $userDataDir = Join-Path $profilesRoot ("ai-web-lxj-cdp-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $userDataDir -Force | Out-Null

  $args = New-Object System.Collections.Generic.List[string]
  [void]$args.Add("--remote-debugging-port=$port")
  [void]$args.Add("--user-data-dir=$userDataDir")
  [void]$args.Add('--no-first-run')
  [void]$args.Add('--no-default-browser-check')
  [void]$args.Add('--disable-popup-blocking')
  [void]$args.Add('--no-sandbox')
  [void]$args.Add('--disable-gpu')
  [void]$args.Add('--headless')
  [void]$args.Add('about:blank')

  $stderrPath = Join-Path $logDir ("cdp-browser-" + [guid]::NewGuid().ToString('N') + ".err.log")
  $process = Start-Process -FilePath $chromePath -ArgumentList $args.ToArray() -PassThru -RedirectStandardError $stderrPath -WindowStyle Hidden
  $versionUrl = "http://127.0.0.1:$port/json/version"
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    try {
      $json = Invoke-WebRequest -UseBasicParsing $versionUrl | Select-Object -ExpandProperty Content | ConvertFrom-Json
      if ($json.webSocketDebuggerUrl) {
        return @{
          process = $process
          userDataDir = $userDataDir
          cdpUrl = "http://127.0.0.1:$port"
          chromePath = $chromePath
          stderrPath = $stderrPath
        }
      }
    } catch {}
    Start-Sleep -Milliseconds 500
  }

  try { if (-not $process.HasExited) { $process.Kill() } } catch {}
  if (Test-Path $stderrPath) {
    Write-RunnerLog ("cdp browser stderr: " + ((Get-Content $stderrPath -Raw) -replace '\s+', ' ').Trim())
  }
  throw "Chrome CDP endpoint did not become ready: $versionUrl"
}

function Invoke-WorkspaceSkill {
  param([object]$Job)

  $payload = $Job.payload
  $skillName = [string]$payload.skillName
  $entryPath = Get-SkillEntryPath -SkillName $skillName
  $runtimePrepared = New-Object System.Collections.Generic.List[string]

  $nodePath = if ([string]::IsNullOrWhiteSpace($env:NVM_SYMLINK)) { 'node' } else { Join-Path $env:NVM_SYMLINK 'node.exe' }
  $relativeEntry = Get-RelativePathCompat -BasePath $projectRoot -TargetPath $entryPath
  $cliArgs = New-Object System.Collections.Generic.List[string]
  [void]$cliArgs.Add($relativeEntry)
  if (-not [string]::IsNullOrWhiteSpace([string]$payload.username)) { [void]$cliArgs.Add("--username=$($payload.username)") }
  if ($payload.headless -eq $true) { [void]$cliArgs.Add('--headless') }
  if ($payload.headless -eq $false) { [void]$cliArgs.Add('--no-headless') }
  if ($payload.notify -eq $false) { [void]$cliArgs.Add('--no-notify') }

  $nodeEnvironment = @{}
  $externalChrome = $null

  try {
    if ($skillName -eq 'lxj') {
      $externalChrome = Start-ExternalChromeCdp -Headless:([bool]$payload.headless)
      $nodeEnvironment['PLAYWRIGHT_CDP_URL'] = $externalChrome.cdpUrl
      [void]$runtimePrepared.Add('external browser cdp')
      Write-RunnerLog "skill $skillName using browser $($externalChrome.chromePath) via $($externalChrome.cdpUrl)"
    }

    $result = Invoke-ExternalProcess -FilePath $nodePath -ArgumentList $cliArgs.ToArray() -WorkingDirectory $projectRoot -TimeoutMs $skillRunTimeoutMs -Environment $nodeEnvironment
  } catch {
    $combinedText = @($_.Exception.Message, $_.Exception.stderr, $_.Exception.stdout) -join "`n"
    $runtimeIssue = Detect-MissingRuntimeIssue -Text $combinedText
    if (-not $runtimeIssue) {
      throw
    }

    if ($runtimeIssue -eq 'missing-playwright-package') {
      [void](Invoke-ExternalProcess -FilePath 'npm.cmd' -ArgumentList @('install', 'playwright') -WorkingDirectory $projectRoot)
      [void]$runtimePrepared.Add('playwright package')
    }
    if ($runtimeIssue -eq 'missing-playwright-package' -or $runtimeIssue -eq 'missing-playwright-browser') {
      [void](Invoke-ExternalProcess -FilePath 'npx.cmd' -ArgumentList @('playwright', 'install', 'chromium') -WorkingDirectory $projectRoot)
      [void]$runtimePrepared.Add('playwright chromium')
    }

    $result = Invoke-ExternalProcess -FilePath $nodePath -ArgumentList $cliArgs.ToArray() -WorkingDirectory $projectRoot -TimeoutMs $skillRunTimeoutMs -Environment $nodeEnvironment
  } finally {
    if ($externalChrome -and $externalChrome.process) {
      try {
        if (-not $externalChrome.process.HasExited) {
          $externalChrome.process.Kill()
        }
        $externalChrome.process.WaitForExit(5000) | Out-Null
      } catch {}
    }
    if ($externalChrome -and $externalChrome.userDataDir -and (Test-Path $externalChrome.userDataDir)) {
      try {
        Remove-Item -LiteralPath $externalChrome.userDataDir -Recurse -Force
      } catch {}
    }
  }

  return @{
    skillName = $skillName
    entry = $relativeEntry
    args = @($cliArgs | Select-Object -Skip 1)
    exitCode = $result.exitCode
    stdout = $result.stdout
    stderr = $result.stderr
    runtimePrepared = @($runtimePrepared)
  }
}

function Report-JobResult {
  param(
    [string]$JobId,
    [hashtable]$Payload
  )

  try {
    $json = ConvertTo-JsonString $Payload
    $preview = if ($json.Length -gt 400) { $json.Substring(0, 400) + '...' } else { $json }
    Write-RunnerLog "reporting job result job=$JobId payload=$preview"
  } catch {
    Write-RunnerLog ("failed to serialize payload preview for job=" + $JobId + " error=" + $_.Exception.Message)
  }
  [void](Invoke-RunnerJson -Method 'POST' -Url "$serverOrigin/skill-runner/jobs/$([Uri]::EscapeDataString($JobId))/result" -Body $Payload)
}

Write-RunnerLog "skill runner started: $serverOrigin"

while ($true) {
  try {
    $response = Invoke-RunnerJson -Method 'GET' -Url "$serverOrigin/skill-runner/jobs/next"
    $job = $response.job
    if ($null -eq $job) {
      Start-Sleep -Milliseconds $pollIntervalMs
      continue
    }

    Write-RunnerLog "picked job $($job.id) for skill $($job.payload.skillName)"

    try {
      $result = Invoke-WorkspaceSkill -Job $job
      Report-JobResult -JobId $job.id -Payload @{
        ok = $true
        result = $result
      }
      Write-RunnerLog "job $($job.id) completed"
    } catch {
      $stderr = if ($_.Exception.PSObject.Properties['stderr']) { [string]$_.Exception.stderr } else { '' }
      $stdout = if ($_.Exception.PSObject.Properties['stdout']) { [string]$_.Exception.stdout } else { '' }
      $exitCode = if ($_.Exception.PSObject.Properties['exitCode']) { $_.Exception.exitCode } else { $null }
      if ($stdout) {
        $stdoutPreview = if ($stdout.Length -gt 500) { $stdout.Substring(0, 500) + '...' } else { $stdout }
        Write-RunnerLog "job $($job.id) stdout: $stdoutPreview"
      }
      if ($stderr) {
        $stderrPreview = if ($stderr.Length -gt 500) { $stderr.Substring(0, 500) + '...' } else { $stderr }
        Write-RunnerLog "job $($job.id) stderr: $stderrPreview"
      }
      Report-JobResult -JobId $job.id -Payload @{
        ok = $false
        error = $_.Exception.Message
        result = @{
          stdout = $stdout
          stderr = $stderr
          exitCode = $exitCode
        }
      }
      Write-RunnerLog "job $($job.id) failed: $($_.Exception.Message)"
    }
  } catch {
    Write-RunnerLog "runner idle/retry: $($_.Exception.Message)"
    Start-Sleep -Milliseconds $pollIntervalMs
  }
}
