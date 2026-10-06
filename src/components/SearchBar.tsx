// Barre de recherche d'adresse/ville avec autocomplétion (repris d'Unmask).
import { useEffect, useRef, useState } from 'react'
import { searchAddress, type GeocodeResult } from '../lib/geocoding'
import { REGION_BOUNDS } from '../lib/regionOutline'
import './SearchBar.css'

// La carte est bloquée sur la région (maxBounds dans MapView) : un résultat au-delà (Paris, Lyon…) la
// faisait sauter au bord de la zone sans rien afficher d'utile. Même marge que maxBounds.
const SEARCH_AREA = REGION_BOUNDS.pad(0.25)

interface SearchBarProps {
  onSelect: (result: GeocodeResult) => void
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  // Libellé du résultat qu'on vient de choisir : le champ est rempli avec,
  // ce qui relançait une recherche dont la réponse rouvrait la liste juste
  // après la sélection. Une requête égale à ce libellé n'est donc pas cherchée.
  const selectedLabelRef = useRef<string | null>(null)
  // Numéro de la dernière recherche lancée : une réponse plus lente d'une
  // recherche précédente ne doit pas écraser les résultats de la saisie
  // actuelle.
  const searchSeqRef = useRef(0)

  // Filet de sécurité en plus du onBlur de l'input : un clic sur la carte ne
  // fait pas toujours perdre le focus de l'input de façon fiable (selon le
  // navigateur), ce qui pouvait laisser la liste ouverte par-dessus les
  // panneaux affichés sous la barre de recherche.
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isOpen])

  useEffect(() => {
    window.clearTimeout(debounceRef.current)
    // Toute saisie invalide les recherches déjà parties.
    const seq = ++searchSeqRef.current

    // Pas de setState ici pour les saisies trop courtes ou déjà choisies :
    // l'affichage est dérivé de `query` plus bas (visibleResults).
    if (query.trim().length < 3 || query === selectedLabelRef.current) return

    debounceRef.current = window.setTimeout(async () => {
      try {
        const all = await searchAddress(query)
        if (seq !== searchSeqRef.current) return
        const found = all.filter((r) => SEARCH_AREA.contains([r.lat, r.lon]))
        setResults(found)
        setError(all.length > 0 && found.length === 0 ? 'Aucun résultat dans la région (Midi-Pyrénées et alentours).' : null)
        setIsOpen(true)
      } catch {
        if (seq !== searchSeqRef.current) return
        setError('Recherche indisponible, réessaie dans un instant.')
        setResults([])
      }
    }, 300)

    return () => window.clearTimeout(debounceRef.current)
  }, [query])

  const searchable = query.trim().length >= 3
  const visibleResults = searchable ? results : []
  const visibleError = searchable ? error : null

  const handleSelect = (result: GeocodeResult) => {
    selectedLabelRef.current = result.label
    setQuery(result.label)
    setIsOpen(false)
    onSelect(result)
  }

  return (
    <div className="search-bar" ref={containerRef}>
      <input
        type="text"
        placeholder="Rechercher une ville ou une adresse…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => visibleResults.length > 0 && query !== selectedLabelRef.current && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
      />
      {visibleError && <div className="search-bar__error">{visibleError}</div>}
      {isOpen && visibleResults.length > 0 && (
        <ul className="search-bar__results">
          {visibleResults.map((result, i) => (
            <li key={i}>
              <button type="button" onMouseDown={() => handleSelect(result)}>
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
