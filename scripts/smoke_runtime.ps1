param(
  [string]$ApiUrl = "http://127.0.0.1:8000",
  [string]$StoreRoot = ".runtime-smoke/store",
  [ValidateSet("json", "sqlite")]
  [string]$StorageBackend = "json",
  [switch]$KeepApi
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$resolvedStoreRoot = Join-Path $repoRoot $StoreRoot
$logRoot = Join-Path $repoRoot ".runtime-smoke/logs"
$apiProcess = $null

function Invoke-AegisApi {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Path,
    [object]$Body = $null
  )

  $uri = "$ApiUrl$Path"
  if ($Body -eq $null) {
    return Invoke-RestMethod -Method $Method -Uri $uri
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 32)
}

function Test-AegisHealth {
  try {
    $health = Invoke-AegisApi -Method GET -Path "/health"
    return $health.status -eq "ok"
  } catch {
    return $false
  }
}

function Wait-AegisHealth {
  param([int]$TimeoutSeconds = 30)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-AegisHealth) {
      return $true
    }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Test-ApiPortOccupied {
  param([Uri]$Uri)
  $connections = Get-NetTCPConnection -LocalPort $Uri.Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$connections
}

function Find-FreeApiUrl {
  param([Uri]$OriginalUri)
  foreach ($port in 8020..8035) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
      return "$($OriginalUri.Scheme)://$($OriginalUri.Host):$port"
    }
  }
  throw "没有找到可用 smoke 端口。请关闭占用 8000/8020-8035 的旧服务后重试。"
}

function Start-AegisApi {
  $apiUri = [Uri]$ApiUrl
  New-Item -ItemType Directory -Force -Path $resolvedStoreRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
  $stdoutLog = Join-Path $logRoot "api-$($apiUri.Port).out.log"
  $stderrLog = Join-Path $logRoot "api-$($apiUri.Port).err.log"
  $env:PYTHONPATH = [string]$repoRoot
  $env:AEGISQA_STORE_ROOT = [string]$resolvedStoreRoot
  $env:AEGISQA_STORAGE_BACKEND = $StorageBackend
  $env:AEGISQA_MODEL_PROVIDER = "mock"
  return Start-Process -FilePath "python" -ArgumentList @("-m", "uvicorn", "aegisqa.api.app:app", "--host", $apiUri.Host, "--port", [string]$apiUri.Port) -WorkingDirectory $repoRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
}

function Show-ApiLogs {
  $apiUri = [Uri]$ApiUrl
  $stdoutLog = Join-Path $logRoot "api-$($apiUri.Port).out.log"
  $stderrLog = Join-Path $logRoot "api-$($apiUri.Port).err.log"
  if (Test-Path $stdoutLog) {
    Write-Output "--- uvicorn stdout ---"
    Get-Content -Path $stdoutLog -Tail 40
  }
  if (Test-Path $stderrLog) {
    Write-Output "--- uvicorn stderr ---"
    Get-Content -Path $stderrLog -Tail 80
  }
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

try {
  if (-not (Test-AegisHealth)) {
    $requestedUri = [Uri]$ApiUrl
    if (Test-ApiPortOccupied -Uri $requestedUri) {
      $nextUrl = Find-FreeApiUrl -OriginalUri $requestedUri
      Write-Output "$ApiUrl 被非 AegisQA 服务占用，改用备用端口：$nextUrl"
      $ApiUrl = $nextUrl
    }
    Write-Output "FastAPI 未响应，启动本地 smoke 后端：$ApiUrl"
    $apiProcess = Start-AegisApi
    if (-not (Wait-AegisHealth -TimeoutSeconds 45)) {
      Show-ApiLogs
      throw "FastAPI 在 45 秒内没有通过 /health。"
    }
  } else {
    Write-Output "复用已启动的 FastAPI：$ApiUrl"
  }

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $datasetName = "smoke_dataset_$stamp"
  $workflowName = "Smoke Workflow $stamp"
  $taskName = "Smoke Task $stamp"

  $dataset = Invoke-AegisApi -Method POST -Path "/datasets/source-materialize" -Body @{
    name = $datasetName
    golden = $true
    label_field = "expected_label"
    rows = @(
      @{ question = "AegisQA 如何保障质量?"; reference = "AegisQA"; expected_label = "pass"; scene = "smoke" },
      @{ question = "这个样本应该形成坏例"; reference = "Badcase"; expected_label = "fail"; scene = "smoke" }
    )
  }

  $workflow = Invoke-AegisApi -Method POST -Path "/workflow-graphs/publish" -Body @{
    graph = @{
      name = $workflowName
      nodes = @(
        @{
          node_id = "answer"
          node_type = "skill"
          label = "生成回答"
          skill_ref = "llm.call@0.1.0"
          input_mapping = @{ prompt = "row.question" }
          output_mapping = @{ answer = "context.answer"; tokens = "metrics.tokens" }
          config = @{ model = "mock"; temperature = 0 }
          cacheable = $true
        },
        @{
          node_id = "judge"
          node_type = "skill"
          label = "裁判"
          skill_ref = "llm.judge@0.1.0"
          input_mapping = @{ question = "row.question"; answer = "context.answer"; reference = "row.reference" }
          output_mapping = @{ score = "metrics.judge_score"; label = "context.judge_label" }
          config = @{ threshold = 0.6 }
        },
        @{ node_id = "report"; node_type = "output"; label = "报告" }
      )
      edges = @(
        @{ source = "answer"; target = "judge" },
        @{ source = "judge"; target = "report" }
      )
    }
  }

  $preflight = Invoke-AegisApi -Method POST -Path "/tasks/preflight" -Body @{
    dataset_id = $dataset.dataset_id
    dataset_version = $dataset.version
    workflow_version_id = $workflow.version_id
  }
  Assert-True ($preflight.status -ne "blocked") "Preflight 阻断：$($preflight.summary)"

  $task = Invoke-AegisApi -Method POST -Path "/tasks" -Body @{
    name = $taskName
    dataset_id = $dataset.dataset_id
    dataset_version = $dataset.version
    workflow_version_id = $workflow.version_id
    preflight_result = $preflight
  }
  $executedTask = Invoke-AegisApi -Method POST -Path "/tasks/$($task.task_id)/execute"
  Assert-True ($executedTask.status -eq "completed") "Task 未完成，当前状态：$($executedTask.status)"

  $traceFlow = Invoke-AegisApi -Method GET -Path "/tasks/$($task.task_id)/trace-flow"
  Assert-True (($traceFlow.items | Measure-Object).Count -gt 0) "Trace Flow 没有样本。"

  $report = Invoke-AegisApi -Method GET -Path "/tasks/$($task.task_id)/report"
  Assert-True ($report.report.total_items -eq 2) "Report 样本数异常：$($report.report.total_items)"
  Assert-True (($report.recommended_actions | Where-Object { $_.id -eq $_.action } | Measure-Object).Count -gt 0) "Report 动作缺少统一 id/action 契约。"

  $workbench = Invoke-AegisApi -Method GET -Path "/overview/workbench"
  Assert-True ($workbench.source -eq "real_store") "Overview Workbench 未返回真实 store 来源。"

  Write-Output "Runtime smoke passed"
  Write-Output "Task: $($task.task_id)"
  Write-Output "Run: $($executedTask.run_id)"
  Write-Output "Report: /reports?task_id=$($task.task_id)"
} finally {
  if ($apiProcess -and -not $KeepApi) {
    Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
