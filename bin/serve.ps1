# Suixin Community v4 - local development launcher
# Requires PHP 8.1+ on PATH and MariaDB/MySQL matching config.php
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$public = Join-Path $root "public"
$router = Join-Path $public "router.php"
$php = Get-Command php -ErrorAction SilentlyContinue
if (-not $php) {
    Write-Host "PHP 8.1+ not found on PATH. Install PHP and reopen the terminal." -ForegroundColor Yellow
    exit 1
}
Write-Host "Suixin Community v4.0.0 -> http://127.0.0.1:8081" -ForegroundColor Cyan
Write-Host "Installer: php bin/install.php   |   Smoke test: php bin/smoke.php" -ForegroundColor Gray
& $php.Source -S 127.0.0.1:8081 -t $public $router
