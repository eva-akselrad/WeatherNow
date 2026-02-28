# build.ps1 - Copies assets to www and syncs Capacitor
$AppDir = $PSScriptRoot
$ProjectRoot = Split-Path -Parent $AppDir
$WwwDir = Join-Path $AppDir "www"

# Create the www directory if it doesn't exist
if (!(Test-Path -Path $WwwDir)) {
    New-Item -ItemType Directory -Path $WwwDir | Out-Null
}

# Directories and files to copy
$DirsToCopy = @("assets", "css", "js", "functions")
$FilesToCopy = @("index.html", "manifest.json", "package.json")

# Copy the items
foreach ($dir in $DirsToCopy) {
    if (Test-Path "$ProjectRoot\$dir") {
        Copy-Item -Path "$ProjectRoot\$dir" -Destination "$WwwDir\" -Recurse -Force
    }
}

foreach ($file in $FilesToCopy) {
    if (Test-Path "$ProjectRoot\$file") {
        Copy-Item -Path "$ProjectRoot\$file" -Destination "$WwwDir\" -Force
    }
}

Write-Output "Assets copied to www successfully."

# Sync Capacitor
Set-Location $AppDir
npx cap sync android
Write-Output "Capacitor sync complete."
