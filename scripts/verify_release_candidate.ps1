param(
  [ValidateSet("docs", "targeted", "release")]
  [string]$Scope = "targeted",
  [switch]$IncludeRuntimeSmoke
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..")

function Invoke-CheckedCommand {
  param(
    [string]$Name,
    [scriptblock]$Command,
    [string]$WorkingDirectory = $repoRoot
  )

  Write-Output ""
  Write-Output "==> $Name"
  Push-Location $WorkingDirectory
  try {
    & $Command
    if ($LASTEXITCODE -ne 0) {
      throw "$Name 失败，退出码：$LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Assert-RequiredFile {
  param([string]$Path)
  $fullPath = Join-Path $repoRoot $Path
  if (-not (Test-Path $fullPath)) {
    throw "缺少必需文件：$Path"
  }
}

function Test-RequiredArtifacts {
  $requiredFiles = @(
    "docs/PROJECT_STATUS.md",
    "docs/RELEASE_READINESS.md",
    "docs/RUNTIME_SMOKE.md",
    "docs/audit/feature_truth_audit.md",
    "docs/audit/rebuild_completion_audit.md",
    "docker-compose.yml",
    "scripts/smoke_runtime.ps1",
    "scripts/smoke_production_like.ps1"
  )
  foreach ($file in $requiredFiles) {
    Assert-RequiredFile $file
  }
}

function Test-IgnoredRuntimeArtifacts {
  $status = git -C $repoRoot status --short --untracked-files=all
  $runtimeArtifacts = $status | Where-Object {
    $_ -match "\.runtime-smoke/" -or
    $_ -match "\.e2e-artifacts/" -or
    $_ -match "tmp-report-"
  }
  if ($runtimeArtifacts) {
    throw "运行产物或历史调试目录仍出现在 git status 中：`n$($runtimeArtifacts -join "`n")"
  }
}

Test-RequiredArtifacts
Invoke-CheckedCommand -Name "Git 空白检查" -Command { git diff --check }
Test-IgnoredRuntimeArtifacts

if ($Scope -eq "docs") {
  Write-Output ""
  Write-Output "Docs verification passed"
  exit 0
}

Invoke-CheckedCommand -Name "后端契约定向测试" -Command {
  python -m pytest tests/test_api_frontend_contract.py tests/test_experience_efficiency.py -q
}

Invoke-CheckedCommand -Name "前端类型检查" -WorkingDirectory (Join-Path $repoRoot "frontend") -Command {
  npm run typecheck
}

if ($IncludeRuntimeSmoke) {
  Invoke-CheckedCommand -Name "本地 Runtime Smoke" -Command {
    .\scripts\smoke_runtime.ps1
  }
}

if ($Scope -eq "targeted") {
  Write-Output ""
  Write-Output "Targeted verification passed"
  exit 0
}

Invoke-CheckedCommand -Name "后端全量测试" -Command {
  python -m pytest -q
}

Invoke-CheckedCommand -Name "前端全量单测" -WorkingDirectory (Join-Path $repoRoot "frontend") -Command {
  npm test
}

Invoke-CheckedCommand -Name "前端生产构建" -WorkingDirectory (Join-Path $repoRoot "frontend") -Command {
  npm run build
}

Invoke-CheckedCommand -Name "前端 E2E" -WorkingDirectory (Join-Path $repoRoot "frontend") -Command {
  npm run e2e
}

Invoke-CheckedCommand -Name "本地 Runtime Smoke" -Command {
  .\scripts\smoke_runtime.ps1
}

Write-Output ""
Write-Output "Release candidate verification passed"
