// Code d'accès au mode « Coins » (demande utilisateur du 25/10/2026) : un simple verrou côté navigateur, retenu
// sur le téléphone une fois le bon code saisi. Ce n'est PAS une vraie protection (les données restent
// publiques, et un curieux peut contourner le verrou) : ça évite juste que n'importe qui tombe sur les coins.
// Le dépôt étant public, seule l'empreinte SHA-256 du code est écrite ici, jamais le code lui-même.
const CODE_SHA256 = '11bec72dc466196d94e2a84d10af5680c8ba0cc75ff7137b9f06fd06020b1593'
const KEY = 'mc-coins-unlocked'

export function coinsUnlocked(): boolean {
  try {
    return localStorage.getItem(KEY) === CODE_SHA256
  } catch {
    return false
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Vrai si le code est bon ; il est alors retenu sur l'appareil.
export async function tryUnlockCoins(code: string): Promise<boolean> {
  const ok = (await sha256(code.trim())) === CODE_SHA256
  if (ok) {
    try {
      localStorage.setItem(KEY, CODE_SHA256)
    } catch {
      // stockage indisponible (navigation privée) : accès accordé pour cette session seulement
    }
  }
  return ok
}
