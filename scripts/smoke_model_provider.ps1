param(
  [string]$ApiUrl = "http://127.0.0.1:8000",
  [string]$ConnectionId = "provider-smoke",
  [string]$Name = "Provider Smoke",
  [ValidateSet("openai_compatible", "openai", "compatible")]
  [string]$Provider = "openai_compatible",
  [string]$BaseUrl,
  [string]$DefaultModel,
  [string]$SecretRef,
  [string]$ApiKeyEnv,
  [string]$Prompt = "请用一句话回复：AegisQA provider smoke ok。",
  [int]$MaxTokens = 32,
  [int]$TimeoutSeconds = 60,
  [switch]$LiveCall
)

$ErrorActionPreference = "Stop"

function Invoke-AegisApi {
  param(
    [ValidateSet("GET", "POST", "PUT", "DELETE")]
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

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw $Message
  }
}

function Get-EnvSecret {
  param([string]$Name)
  if (-not $Name) {
    return $null
  }
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "环境变量 $Name 未配置，无法执行真实 provider 调用。"
  }
  return $value
}

if (-not $BaseUrl) {
  throw "必须提供 -BaseUrl，例如 https://example.com/v1。"
}
if (-not $DefaultModel) {
  throw "必须提供 -DefaultModel，例如 qwen-plus。"
}
if (-not $SecretRef -and -not $ApiKeyEnv) {
  throw "必须提供 -SecretRef 或 -ApiKeyEnv。SecretRef 会保存为引用；ApiKeyEnv 只用于本次测试请求，不会持久化。"
}
$temporaryApiKey = Get-EnvSecret -Name $ApiKeyEnv

$health = Invoke-AegisApi -Method GET -Path "/health"
Assert-True ($health.status -eq "ok") "API health 异常：$($health | ConvertTo-Json -Depth 8)"

$connectionBody = @{
  connection_id = $ConnectionId
  name = $Name
  provider = $Provider
  base_url = $BaseUrl
  secret_ref = $SecretRef
  default_model = $DefaultModel
  timeout_seconds = $TimeoutSeconds
  enabled = $true
  role = "Admin"
  actor = "provider-smoke"
}
$saved = Invoke-AegisApi -Method POST -Path "/model-gateway/connections" -Body $connectionBody

Assert-True ($saved.connection_id -eq $ConnectionId) "连接别名保存失败。"
Assert-True ($saved.provider -eq $Provider) "Provider 不一致：$($saved.provider)"
Assert-True ($saved.base_url -eq $BaseUrl) "Base URL 不一致。"
Assert-True (-not ($saved.PSObject.Properties.Name -contains "api_key")) "API 响应不应包含明文 api_key。"
if ($temporaryApiKey) {
  Assert-True (-not ($saved | ConvertTo-Json -Depth 16).Contains($temporaryApiKey)) "API 响应泄漏了临时密钥。"
}

$connections = Invoke-AegisApi -Method GET -Path "/model-gateway/connections"
$matched = $connections | Where-Object { $_.connection_id -eq $ConnectionId } | Select-Object -First 1
Assert-True ($null -ne $matched) "连接列表中未找到 $ConnectionId。"
Assert-True (-not ($matched.PSObject.Properties.Name -contains "api_key")) "连接列表不应返回明文 api_key。"

if (-not $LiveCall) {
  Write-Output "Model provider smoke configured"
  Write-Output "Connection: $ConnectionId"
  Write-Output "Live call: skipped"
  Write-Output "Secret persisted: $([bool]$SecretRef)"
  exit 0
}

$testBody = @{
  model_connection_id = $ConnectionId
  prompt = $Prompt
  model = $DefaultModel
  max_tokens = $MaxTokens
  role = "Admin"
  actor = "provider-smoke"
}
if ($temporaryApiKey) {
  $testBody.api_key = $temporaryApiKey
}
if ($SecretRef) {
  $testBody.secret_ref = $SecretRef
}

$probe = Invoke-AegisApi -Method POST -Path "/model-gateway/test" -Body $testBody
Assert-True ($probe.ok -eq $true) "模型连接测试失败。"
Assert-True ([string]::IsNullOrWhiteSpace($probe.response.text) -eq $false) "模型返回为空。"
Assert-True ($probe.response.provider -eq $Provider) "模型响应 provider 不一致：$($probe.response.provider)"

$probeJson = $probe | ConvertTo-Json -Depth 16
if ($temporaryApiKey) {
  Assert-True (-not $probeJson.Contains($temporaryApiKey)) "模型测试响应泄漏了临时密钥。"
}

Write-Output "Model provider smoke passed"
Write-Output "Connection: $ConnectionId"
Write-Output "Model: $($probe.response.model)"
Write-Output "Usage source: provider response"
