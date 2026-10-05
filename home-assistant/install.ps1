# Installe le paquet Home Assistant « Météochampignon » via le partage Samba.
#
# Usage (PowerShell, depuis le dossier du projet) :
#   .\home-assistant\install.ps1
#   .\home-assistant\install.ps1 -Ha '\\192.168.1.50\config'      # si le nom ne résout pas
#
# Ce que fait le script :
#   1. vérifie que le partage est joignable et ressemble à un dossier de config HA ;
#   2. copie le paquet dans <config>\packages\ et le tableau de bord dans <config>\dashboards\ ;
#   3. demande votre jeton GitHub (saisie masquée) et l'ajoute à secrets.yaml
#      (sauvegarde datée de secrets.yaml avant toute modification) ;
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
 Test : Paramètres > Automatisations > « Météochampignon - déclencher
 les traitements GitHub » > Exécuter, puis regardez l'onglet Actions du
 dépôt GitHub : un run « workflow_dispatch » doit apparaître.
==============================================================
"@ -ForegroundColor Green
