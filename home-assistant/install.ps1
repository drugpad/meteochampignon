# Installe le paquet Home Assistant « Météochampignon » via le partage Samba.
#
# Usage (PowerShell, depuis le dossier du projet) :
#   .\home-assistant\install.ps1
#   .\home-assistant\install.ps1 -Ha '\\192.168.1.50\config'      # si le nom ne résout pas
#
# Ce que fait le script :
#   1. vérifie que le partage est joignable et ressemble à un dossier de config HA ;
#   2. copie le paquet dans <config>\packages\, le tableau de bord dans <config>\dashboards\
#      et les scripts Python (stations, cartes) dans <config>\meteochampignon\ ;
#   3. demande votre jeton GitHub (saisie masquée) et l'ajoute à secrets.yaml, avec la
#      clé Météo-France (lue dans .env.local, sans la redemander) — sauvegarde
#      datée de secrets.yaml avant toute modification ;
#   4. VÉRIFIE si configuration.yaml charge les « packages » et vous dit quoi
#      ajouter sinon — il ne modifie JAMAIS configuration.yaml lui-même.
# Il ne redémarre rien : la fin du script vous indique les deux dernières étapes.
param(
  [string]$Ha = '\\homeassistant\config'
)

$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '.'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text)   { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !!  $text" -ForegroundColor Yellow }

# --- 1) partage -------------------------------------------------------------
Step "Connexion au partage Samba : $Ha"
if (-not (Test-Path $Ha)) {
  throw "Partage introuvable : $Ha`nEssayez -Ha '\\<adresse-ip-de-HA>\config' (ou le nom exact de votre partage Samba)."
}
if (-not (Test-Path (Join-Path $Ha 'configuration.yaml'))) {
  throw "configuration.yaml absent de $Ha : ce n'est pas le dossier de configuration de Home Assistant.`nCherchez le partage qui contient configuration.yaml (souvent 'config')."
}
Ok "configuration.yaml trouvé"

# --- 2) fichiers ------------------------------------------------------------
Step "Copie des fichiers"
$packages   = Join-Path $Ha 'packages'
$dashboards = Join-Path $Ha 'dashboards'
New-Item -ItemType Directory -Force -Path $packages, $dashboards | Out-Null
Copy-Item (Join-Path $src 'meteochampignon.yaml') (Join-Path $packages 'meteochampignon.yaml') -Force
Copy-Item (Join-Path $src 'dashboard.yaml') (Join-Path $dashboards 'meteochampignon.yaml') -Force
Ok "packages\meteochampignon.yaml"
Ok "dashboards\meteochampignon.yaml"
$scriptsDir = Join-Path $Ha 'meteochampignon'
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
Copy-Item (Join-Path $src 'scripts\*.py') $scriptsDir -Force
Ok "meteochampignon\stations.py, maps.py, install_deps.py, check_env.py"
# Le générateur de cartes est le MÊME fichier que sur GitHub (une seule source de vérité) ;
# copié sous un nom importable (pas de tiret).
Copy-Item (Join-Path $PSScriptRoot '..\scripts\build-rain-maps.py') (Join-Path $scriptsDir 'build_rain_maps.py') -Force
Ok "meteochampignon\build_rain_maps.py (générateur des cartes)"

# --- 3) jeton GitHub --------------------------------------------------------
Step "Jeton GitHub (secrets.yaml)"
$secretsPath = Join-Path $Ha 'secrets.yaml'
$secretsText = if (Test-Path $secretsPath) { [System.IO.File]::ReadAllText($secretsPath) } else { '' }
if ($secretsText -match '(?m)^\s*github_dispatch_auth\s*:') {
  Warn "github_dispatch_auth existe déjà dans secrets.yaml : laissé tel quel (modifiez-le à la main pour changer de jeton)."
} else {
  Write-Host "    Collez votre jeton GitHub (fine-grained, 'github_pat_...'). La saisie est masquée."
  $secure = Read-Host -Prompt '    Jeton' -AsSecureString
  $token  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ([string]::IsNullOrWhiteSpace($token)) { throw "Jeton vide : abandon (rien n'a été modifié dans secrets.yaml)." }
  $token = $token.Trim()
  if ($token -notmatch '^(github_pat_|ghp_)') { Warn "Ce jeton ne commence pas par github_pat_ ni ghp_ : vérifiez que c'est le bon." }
  if (Test-Path $secretsPath) {
    $backup = "$secretsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $secretsPath $backup
    Ok "sauvegarde : $(Split-Path $backup -Leaf)"
  }
  $prefix = if ($secretsText.Length -gt 0 -and -not $secretsText.EndsWith("`n")) { "`n" } else { '' }
  [System.IO.File]::AppendAllText($secretsPath, "$prefix# Météochampignon : jeton GitHub (Actions : lecture/écriture, dépôt drugpad/meteochampignon)`ngithub_dispatch_auth: `"Bearer $token`"`n", $utf8NoBom)
  $token = $null
  Ok "github_dispatch_auth ajouté à secrets.yaml"
}

# --- 3 bis) clé Météo-France ---------------------------------------------
Step "Clé Météo-France (collecte des stations par Home Assistant)"
$secretsText = if (Test-Path $secretsPath) { [System.IO.File]::ReadAllText($secretsPath) } else { '' }
if ($secretsText -match '(?m)^\s*meteochampignon_mf_token\s*:') {
  Warn "meteochampignon_mf_token existe déjà dans secrets.yaml : laissé tel quel."
} else {
  $mf = $null
  $envFile = Join-Path $PSScriptRoot '..\.env.local'
  if (Test-Path $envFile) {
    $line = Select-String -Path $envFile -Pattern '^VITE_METEOFRANCE_API_TOKEN=(.+)$' | Select-Object -First 1
    if ($line) { $mf = $line.Matches[0].Groups[1].Value.Trim(); Ok "clé trouvée dans .env.local (utilisée automatiquement)" }
  }
  if (-not $mf) {
    Write-Host "    Collez votre clé API Météo-France (saisie masquée)."
    $secure2 = Read-Host -Prompt '    Clé' -AsSecureString
    $mf = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure2)).Trim()
  }
  if ([string]::IsNullOrWhiteSpace($mf)) {
    Warn "Pas de clé Météo-France : la collecte par Home Assistant sera inactive (GitHub continue de collecter)."
  } else {
    if (Test-Path $secretsPath) { Copy-Item $secretsPath "$secretsPath.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
    $prefix = if ($secretsText.Length -gt 0 -and -not $secretsText.EndsWith("`n")) { "`n" } else { '' }
    [System.IO.File]::AppendAllText($secretsPath, "$prefix# Météochampignon : clé API Météo-France (collecte des stations)`nmeteochampignon_mf_token: `"$mf`"`n", $utf8NoBom)
    $mf = $null
    Ok "meteochampignon_mf_token ajouté à secrets.yaml"
  }
}

# --- 4) configuration.yaml --------------------------------------------------
Step "Vérification de configuration.yaml"
$cfg = [System.IO.File]::ReadAllText((Join-Path $Ha 'configuration.yaml'))
if ($cfg -match '(?m)^\s*packages\s*:') {
  Ok "'packages:' déjà présent dans configuration.yaml"
} else {
  Warn "configuration.yaml ne charge pas les packages. AJOUTEZ-LE à la main :"
  Write-Host @"

    homeassistant:
      packages: !include_dir_named packages

    (si vous avez déjà une section 'homeassistant:', ajoutez seulement la ligne 'packages:' dedans)
"@ -ForegroundColor Yellow
}
if ($cfg -match '(?m)^\s*lovelace\s*:') {
  Warn "configuration.yaml contient déjà 'lovelace:' : si HA signale un doublon sur 'dashboards', fusionnez à la main (voir docs/home-assistant.md)."
}

Write-Host @"

==============================================================
 Copie terminée. Il reste DEUX étapes dans Home Assistant :
   1. Outils de développement > YAML > « Vérifier la configuration »
      (doit afficher « La configuration ne contient pas d'erreur »)
   2. Redémarrer Home Assistant (le tableau de bord « Météochampignon »
      apparaît alors dans le menu latéral).
 IMPORTANT (une seule fois) : le jeton GitHub doit avoir la permission
 « Contents : Read and write » EN PLUS de « Actions » (voir docs/home-assistant.md),
 sinon la collecte directe des stations échoue (GitHub continue en secours).

 Test : Paramètres > Automatisations > « Météochampignon - déclencher
 les traitements GitHub » > Exécuter, puis regardez l'onglet Actions du
 dépôt GitHub : un run « workflow_dispatch » doit apparaître.
==============================================================
"@ -ForegroundColor Green
