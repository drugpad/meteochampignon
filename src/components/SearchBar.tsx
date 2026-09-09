// Barre de recherche d'adresse/ville avec autocomplétion (repris d'Unmask).
import { useEffect, useRef, useState } from 'react'
import { searchAddress, type GeocodeResult } from '../lib/geocoding'
import './SearchBar.css'

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

    if (query.trim().length < 3) {
      setResults([])
      setError(null)
      return
    }

    debounceRef.current = window.setTimeout(async () => {
      try {
        const found = await searchAddress(query)
        setResults(found)
        setError(null)
        setIsOpen(true)
      } catch {
        setError('Recherche indisponible, réessaie dans un instant.')
        setResults([])
      }
    }, 300)

    return () => window.clearTimeout(debounceRef.current)
  }, [query])

  const handleSelect = (result: GeocodeResult) => {
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
        onFocus={() => results.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
      />
      {error && <div className="search-bar__error">{error}</div>}
      {isOpen && results.length > 0 && (
        <ul className="search-bar__results">
          {results.map((result, i) => (
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
