param(
  [string]$PostId = "",
  [string]$TitleContains = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")
$postsPath = Join-Path $root "public\data\posts.json"

if (-not (Test-Path $postsPath)) {
  throw "posts.json not found at $postsPath"
}

function Write-MediaDetails {
  param(
    [string]$Field,
    [string]$Value
  )

  if (-not $Value) { return }

  $driveId = $null
  if ($Value -match "[?&]id=([^&#]+)") {
    $driveId = $Matches[1]
  } elseif ($Value -match "/file/d/([^/]+)") {
    $driveId = $Matches[1]
  }

  Write-Output "${Field}: $Value"
  if ($driveId) {
    Write-Output "${Field} driveId: $driveId"
    Write-Output "${Field} direct: https://drive.google.com/uc?export=download&id=$driveId"
    Write-Output "${Field} preview: https://drive.google.com/file/d/$driveId/preview"
  }
}

try {
  $posts = Get-Content -Raw -Path $postsPath | ConvertFrom-Json

  if ($PostId) {
    $matches = $posts | Where-Object { "$($_.id)" -eq "$PostId" }
  } elseif ($TitleContains) {
    $matches = $posts | Where-Object { $_.title -like "*$TitleContains*" }
  } else {
    $matches = $posts | Select-Object -First 10
  }

  if (-not $matches) {
    Write-Output "No matching posts."
    exit 1
  }

  foreach ($post in $matches) {
    Write-Output "id: $($post.id)"
    Write-Output "title: $($post.title)"
    Write-Output "type: $($post.type)"
    Write-Output "category: $($post.category)"
    Write-Output "fileName: $($post.fileName)"
    Write-MediaDetails -Field "url" -Value $post.url
    Write-MediaDetails -Field "audioUrl" -Value $post.audioUrl
    Write-Output "---"
  }
} catch {
  Write-Output "JSON parse failed; falling back to text scan."

  $lines = Get-Content -Path $postsPath
  if ($PostId) {
    $hit = Select-String -Path $postsPath -Pattern "`"id`":\s*$PostId\b" | Select-Object -First 1
  } elseif ($TitleContains) {
    $hit = Select-String -Path $postsPath -Pattern ([regex]::Escape($TitleContains)) | Select-Object -First 1
  } else {
    $hit = $null
  }

  if (-not $hit) {
    Write-Output "No matching post found by text scan."
    exit 1
  }

  $start = [Math]::Max(0, $hit.LineNumber - 2)
  $end = [Math]::Min($lines.Count - 1, $hit.LineNumber + 16)
  $block = ($lines[$start..$end] -join "`n")

  foreach ($name in @("id", "title", "type", "category", "fileName")) {
    if ($block -match "`"$name`"\s*:\s*`"?(.*?)(`",|,|`r|`n)") {
      Write-Output "${name}: $($Matches[1])"
    }
  }

  foreach ($field in @("url", "audioUrl")) {
    if ($block -match "`"$field`"\s*:\s*`"([^`"]+)`"") {
      Write-MediaDetails -Field $field -Value $Matches[1]
    }
  }

  Write-Output "---"
}
