<#
  Emret Agency — Windows kurulum betiği.

  Kullanım (depo klasöründe):
    powershell -ExecutionPolicy Bypass -File scripts\kurulum.ps1            # uygulama
    powershell -ExecutionPolicy Bypass -File scripts\kurulum.ps1 -Yerel     # + yerel model (emrettc-genel)
    powershell -ExecutionPolicy Bypass -File scripts\kurulum.ps1 -Yerel -TumModeller

  Ne yapar:
    1. Node.js, npm, git, Python ve C++ derleme araçlarını denetler; eksikse nasıl
       kurulacağını söyler (kendisi sistem programı kurmaz).
    2. Paketleri kurar ve yerel modülleri (node-pty, better-sqlite3) Electron için derler.
    3. -Yerel ile: Ollama'yı denetler, emrettc-genel modelini indirip oluşturur.
       -TumModeller ile kod/analiz/hafif modelleri de (toplam ~40 GB).
#>
param(
  [switch]$Yerel,
  [switch]$TumModeller
)

$ErrorActionPreference = 'Stop'
$Kok = Split-Path -Parent $PSScriptRoot
Set-Location $Kok

function Baslik($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Tamam($t) { Write-Host "  [tamam] $t" -ForegroundColor Green }
function Uyari($t) { Write-Host "  [eksik] $t" -ForegroundColor Yellow }
function Var($komut) { [bool](Get-Command $komut -ErrorAction SilentlyContinue) }

Baslik 'Gereksinimler'
$eksik = $false

if (Var 'node') {
  $surum = (node -v).TrimStart('v')
  if ([int]($surum.Split('.')[0]) -lt 20) { Uyari "Node.js $surum eski; 20 ya da üstü gerekli.  winget install OpenJS.NodeJS.LTS"; $eksik = $true }
  else { Tamam "Node.js $surum" }
} else { Uyari 'Node.js yok.  winget install OpenJS.NodeJS.LTS'; $eksik = $true }

if (Var 'git') { Tamam 'git' } else { Uyari 'git yok.  winget install Git.Git'; $eksik = $true }

$py = Get-Command python -ErrorAction SilentlyContinue
if ($py -and ((python --version 2>&1) -match '3\.(1[0-3])')) { Tamam (python --version 2>&1) }
else { Uyari 'Python 3.10–3.13 bulunamadı (node-pty derlemesi için).  winget install Python.Python.3.12'; $eksik = $true }

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vc = $null
if (Test-Path $vswhere) { $vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath }
if ($vc) { Tamam "C++ derleme araçları ($vc)" }
else {
  Uyari 'Visual Studio C++ derleme araçları yok. Kurun ve "C++ ile masaüstü geliştirme" iş yükünü + "MSVC Spectre korumalı kitaplıklar" bileşenini seçin:'
  Write-Host '         winget install Microsoft.VisualStudio.2022.BuildTools'
  $eksik = $true
}

if ($eksik) {
  Write-Host ''
  Write-Host 'Eksikleri kurup yeni bir PowerShell penceresinde betiği tekrar çalıştırın.' -ForegroundColor Yellow
  exit 1
}

Baslik 'Paketler'
# node-pty'nin winpty adımı bu değişken tanımlıyken GetCommitHash.bat'ı bulamaz.
Remove-Item Env:NoDefaultCurrentDirectoryInExePath -ErrorAction SilentlyContinue
if ($py) { $env:npm_config_python = $py.Source }

# Paketlerin kendi derlemesi atlanır (better-sqlite3 sistem Node'u için derlenmeye
# çalışıp düşer); yerel modüller aşağıda Electron için derlenir.
npm ci --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'npm ci başarısız oldu.' }
node node_modules/electron/install.js
npm run postinstall
if ($LASTEXITCODE -ne 0) { throw 'Yerel modüller derlenemedi (C++ derleme araçlarını denetleyin).' }
Tamam 'Uygulama kuruldu.'

if ($Yerel) {
  Baslik 'Yerel model (Ollama)'
  if (-not (Var 'ollama')) {
    Uyari 'Ollama yok.  winget install Ollama.Ollama  — kurduktan sonra betiği -Yerel ile tekrar çalıştırın.'
    exit 1
  }
  $modeller = @('emrettc-genel')
  if ($TumModeller) { $modeller += 'emrettc-kod', 'emrettc-analiz', 'emrettc-hafif' }
  foreach ($m in $modeller) {
    $dosya = Join-Path $Kok "resources\ollama\$m.Modelfile"
    $taban = (Select-String -Path $dosya -Pattern '^FROM\s+(\S+)').Matches[0].Groups[1].Value
    Write-Host "  $m ← $taban indiriliyor (ilk seferde birkaç GB)…"
    ollama pull $taban
    ollama create $m -f $dosya
    Tamam $m
  }
  # Tek ekran kartında hızlı ve kararlı düzen (docs/KURULUM.md › Yerel motoru hızlandırma).
  [Environment]::SetEnvironmentVariable('OLLAMA_NUM_PARALLEL', '1', 'User')
  [Environment]::SetEnvironmentVariable('OLLAMA_MAX_LOADED_MODELS', '1', 'User')
  [Environment]::SetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', '1', 'User')
  [Environment]::SetEnvironmentVariable('OLLAMA_KEEP_ALIVE', '-1', 'User')
  Tamam 'Ollama ayarları yazıldı (etkin olması için Ollama''yı yeniden başlatın).'
}

Baslik 'Hazır'
Write-Host '  Başlatmak için: baslat.cmd   (ya da: npm run dev)'
Write-Host '  Ayrıntılar:     docs\KURULUM.md'
