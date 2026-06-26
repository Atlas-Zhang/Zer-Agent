param(
  [Parameter(Mandatory = $true)]
  [string]$Message,

  [Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)]
  [string[]]$Paths
)

if ($Paths.Count -eq 0) {
  Write-Error "Provide one or more explicit paths to stage."
  exit 1
}

$status = git status --porcelain
if (-not $status) {
  Write-Error "Nothing to commit."
  exit 1
}

git add -- $Paths
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$cached = git diff --cached --name-only
if (-not $cached) {
  Write-Error "No staged changes were produced."
  exit 1
}

git commit -m $Message
exit $LASTEXITCODE
