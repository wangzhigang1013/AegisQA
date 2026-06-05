param(
  [string]$ApiUrl = "http://127.0.0.1:8000",
  [string]$ComposeFile = "docker-compose.yml",
  [string]$ProjectName = "aegisqa-prod-smoke",
  [int]$TimeoutSeconds = 180,
  [switch]$StartCompose,
  [switch]$KeepCompose
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")
$resolvedComposeFile = Join-Path $repoRoot $ComposeFile

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

function Wait-AegisHealth {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-AegisApi -Method GET -Path "/health"
      if ($health.status -eq "ok") {
        return
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "API 在 $TimeoutSeconds 秒内没有通过 /health：$ApiUrl"
}

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Invoke-DockerCompose {
  param([string[]]$Arguments)
  & docker compose -f $resolvedComposeFile -p $ProjectName @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose $($Arguments -join ' ') 失败，退出码：$LASTEXITCODE"
  }
}

function Wait-TaskCompleted {
  param([string]$TaskId)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $task = Invoke-AegisApi -Method GET -Path "/tasks/$TaskId"
    if ($task.status -eq "completed") {
      return $task
    }
    if ($task.status -in @("failed", "cancelled", "timeout")) {
      throw "Task 进入失败状态：$($task.status)"
    }
    Start-Sleep -Seconds 2
  }
  throw "Task 在 $TimeoutSeconds 秒内没有完成：$TaskId"
}

if (-not (Test-Path $resolvedComposeFile)) {
  throw "缺少 Docker Compose 文件：$resolvedComposeFile"
}

try {
  if ($StartCompose) {
    Write-Output "启动 production-like 依赖：MySQL、Redis、API、Worker"
    Invoke-DockerCompose -Arguments @("up", "-d", "mysql", "redis", "api", "worker")
  } else {
    Write-Output "未传 -StartCompose，将复用已启动的 API：$ApiUrl"
  }

  Wait-AegisHealth
  $runtime = Invoke-AegisApi -Method GET -Path "/governance/runtime-status"

  Assert-True ($runtime.storage.backend -eq "mysql") "当前 API 未使用 MySQL：$($runtime.storage.backend)"
  Assert-True ($runtime.executor.backend -eq "celery") "当前 API 未使用 Celery：$($runtime.executor.backend)"
  Assert-True ($runtime.external_services.redis.status -eq "configured") "当前 API 未配置 Redis 限流：$($runtime.external_services.redis.status)"

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $dataset = Invoke-AegisApi -Method POST -Path "/datasets/source-materialize" -Body @{
    name = "prod_smoke_dataset_$stamp"
    golden = $true
    label_field = "expected_label"
    rows = @(
      @{ question = "AegisQA 生产类 smoke 样本"; reference = "AegisQA"; expected_label = "pass"; scene = "production_like" },
      @{ question = "生产类 smoke 坏例样本"; reference = "Badcase"; expected_label = "fail"; scene = "production_like" }
    )
  }

  $workflow = Invoke-AegisApi -Method POST -Path "/workflow-graphs/publish" -Body @{
    graph = @{
      name = "Production-like Smoke Workflow $stamp"
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
    name = "Production-like Smoke Task $stamp"
    dataset_id = $dataset.dataset_id
    dataset_version = $dataset.version
    workflow_version_id = $workflow.version_id
    preflight_result = $preflight
  }

  $submitted = Invoke-AegisApi -Method POST -Path "/tasks/$($task.task_id)/execute?background=true"
  Assert-True ($submitted.execution_state.executor_backend -eq "celery") "Task 没有提交到 Celery：$($submitted.execution_state.executor_backend)"

  $completedTask = Wait-TaskCompleted -TaskId $task.task_id
  $report = Invoke-AegisApi -Method GET -Path "/tasks/$($task.task_id)/report"
  Assert-True ($report.report.total_items -eq 2) "Report 样本数异常：$($report.report.total_items)"

  Write-Output "Production-like smoke passed"
  Write-Output "Task: $($task.task_id)"
  Write-Output "Run: $($completedTask.run_id)"
  Write-Output "Executor job: $($submitted.execution_state.executor_job_id)"
  Write-Output "Report: /reports?task_id=$($task.task_id)"
} finally {
  if ($StartCompose -and -not $KeepCompose) {
    Write-Output "停止 production-like compose 服务"
    try {
      Invoke-DockerCompose -Arguments @("down")
    } catch {
      Write-Warning $_
    }
  }
}
