// Page « Champignons » : liste de fiches d'identification (photo, critères,
// confusions dangereuses) — données dans src/data/champignons.ts.
//
// Plein écran par-dessus la carte, comme StationFullscreen, mais branchée
// sur l'historique du navigateur : le bouton retour du téléphone ramène de
// la fiche à la liste puis à la carte, au lieu de quitter l'appli (une page
// qu'on parcourt longuement en forêt, contrairement au détail station).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ANSES_URL,
  EDIBILITY_LABEL,
  LOOKALIKES,
  SPECIES,
  photoOf,
  type Confusion,
  type Edibility,
  type Lookalike,
  type Species,
} from '../data/champignons'
import type { PhotoId } from '../data/champignonPhotos'
import './MushroomGuide.css'
import type { GuideView } from '../lib/useMushroomGuide'

type Props = {
  view: Exclude<GuideView, null>
  onOpenSpecies: (id: string) => void
  onBack: () => void
}

export function MushroomGuide({ view, onOpenSpecies, onBack }: Props) {
  const species = view === 'list' ? undefined : SPECIES.find((s) => s.id === view)

  return createPortal(
    <div className="guide">
      <div className="guide__header">
        <button type="button" className="guide__back" onClick={onBack} aria-label="Retour">
          ‹
        </button>
        <div className="guide__title">{species ? species.name : 'Champignons'}</div>
      </div>
      {/* La liste reste montée sous la fiche : on retrouve sa position de
          défilement en revenant. */}
      <div className="guide__body" hidden={!!species}>
        <SpeciesList onOpen={onOpenSpecies} />
      </div>
      {species && (
        <div className="guide__body" key={species.id}>
          <SpeciesSheet species={species} />
        </div>
      )}
    </div>,
    document.body,
  )
}

function photoUrl(id: PhotoId) {
  return import.meta.env.BASE_URL + photoOf(id).src
}

function EdibilityTag({ edibility }: { edibility: Edibility }) {
  return (
    <span className={`guide-tag guide-tag--${edibility}`}>
      {edibility === 'mortel' && '☠ '}
      {EDIBILITY_LABEL[edibility]}
    </span>
  )
}

function SafetyBanner() {
  return (
    <div className="guide-banner">
      <strong>Pour reconnaître, pas pour décider de manger.</strong> Au moindre doute, montrez votre cueillette à un
      pharmacien ou à une société mycologique. Ne vous fiez jamais à une photo ni à une appli.
    </div>
  )
}

function Emergency() {
  return (
    <div className="guide-emergency">
      <strong>Symptômes après un repas de champignons ?</strong> (vomissements, diarrhée, vertiges, troubles de la vue…)
      <ul>
        <li>
          Urgence vitale : <a href="tel:15">15</a> ou <a href="tel:112">112</a>
        </li>
        <li>
          Centre antipoison de Toulouse : <a href="tel:+33561777447">05 61 77 74 47</a>
        </li>
      </ul>
      Gardez les restes ou une photo des champignons, et signalez que vous en avez mangé.
    </div>
  )
}

function Rules() {
  return (
    <details className="guide-rules">
      <summary>Les règles avant de cueillir et de manger</summary>
      <ul>
        <li>Ne cueillir que les champignons que l’on connaît parfaitement ; au moindre doute, faire vérifier.</li>
        <li>Cueillir des champignons entiers (pied compris, déterré) : la base du pied sert à les identifier.</li>
        <li>Laisser les très jeunes (« œufs ») et les vieux abîmés.</li>
        <li>Panier, cagette ou carton, jamais de sac plastique ; séparer les espèces.</li>
        <li>Loin des routes, zones industrielles et décharges.</li>
        <li>Prendre une photo de la récolte avant de cuisiner.</li>
        <li>Conserver au frais (4 °C au plus) et consommer dans les 2 jours.</li>
        <li>Toujours bien cuire : 20 à 30 min à la poêle ou 15 min à l’eau bouillante.</li>
        <li>Quantités raisonnables : 150 à 200 g par adulte et par semaine.</li>
        <li>Jamais aux jeunes enfants.</li>
      </ul>
      <a href={ANSES_URL} target="_blank" rel="noreferrer">
        Recommandations de l’Anses
      </a>
    </details>
  )
}

function SpeciesList({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="guide__content">
      <SafetyBanner />
      <Rules />
      <ul className="guide-list">
        {SPECIES.map((s) => (
          <li key={s.id}>
            <button type="button" className="guide-card" onClick={() => onOpen(s.id)}>
              <img className="guide-card__photo" src={photoUrl(s.photos[0].id)} alt="" loading="lazy" />
              <span className="guide-card__text">
                <span className="guide-card__name">{s.name}</span>
                <span className="guide-card__latin">{s.latin}</span>
                <EdibilityTag edibility={s.edibility} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Emergency />
      <p className="guide-footnote">
        Photos : Wikimedia Commons (auteur et licence sous chaque photo). Textes recoupés sur les fiches Wikipédia
        de chaque espèce et les recommandations de l’Anses.
      </p>
    </div>
  )
}

function PhotoCredit({ id }: { id: PhotoId }) {
  const p = photoOf(id)
  return (
    <div className="guide-credit">
      Photo :{' '}
      <a href={p.sourceUrl} target="_blank" rel="noreferrer">
        {p.author}
      </a>
      ,{' '}
      {p.licenseUrl ? (
        <a href={p.licenseUrl} target="_blank" rel="noreferrer">
          {p.license}
        </a>
      ) : (
        p.license
      )}
    </div>
  )
}

function Gallery({ species: s }: { species: Species }) {
  const [index, setIndex] = useState(0)
  const current = s.photos[index] ?? s.photos[0]
  return (
    <div className="guide-gallery">
      <img className="guide-gallery__main" src={photoUrl(current.id)} alt={`${s.name} : ${current.label}`} />
      <PhotoCredit id={current.id} />
      {s.photos.length > 1 && (
        <div className="guide-gallery__thumbs">
          {s.photos.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={i === index ? 'guide-thumb guide-thumb--active' : 'guide-thumb'}
              onClick={() => setIndex(i)}
            >
              <img src={photoUrl(p.id)} alt="" loading="lazy" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfusionCard({ species: s, confusion }: { species: Species; confusion: Confusion }) {
  const l: Lookalike = LOOKALIKES[confusion.with]
  const [zoomed, setZoomed] = useState(false)
  return (
    <div className={`guide-confusion guide-confusion--${l.edibility}`}>
      <div className="guide-confusion__head">
        {l.photo && (
          <button
            type="button"
            className={zoomed ? 'guide-confusion__photo guide-confusion__photo--zoomed' : 'guide-confusion__photo'}
            onClick={() => setZoomed((z) => !z)}
            aria-label={zoomed ? 'Réduire la photo' : 'Agrandir la photo'}
          >
            <img src={photoUrl(l.photo)} alt={l.name} loading="lazy" />
          </button>
        )}
        <div className="guide-confusion__title">
          <div className="guide-confusion__name">{l.name}</div>
          <div className="guide-sheet__latin">{l.latin}</div>
          <EdibilityTag edibility={l.edibility} />
        </div>
      </div>
      {l.photo && zoomed && <PhotoCredit id={l.photo} />}
      <p className="guide-confusion__danger">{l.danger}</p>
      <table className="guide-compare">
        <thead>
          <tr>
            <th />
            <th className="guide-compare__mine">{s.short}</th>
            <th className="guide-compare__other">{l.short}</th>
          </tr>
        </thead>
        <tbody>
          {confusion.rows.map(([part, mine, other]) => (
            <tr key={part}>
              <th scope="row">{part}</th>
              <td>{mine}</td>
              <td className="guide-compare__other">{other}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {confusion.note && <p className="guide-confusion__note">{confusion.note}</p>}
    </div>
  )
}

function SpeciesSheet({ species: s }: { species: Species }) {
  const sources = [
    { label: `Wikipédia : ${s.latin}`, url: s.wiki },
    ...s.confusions.flatMap(({ with: key }) => {
      const l: Lookalike = LOOKALIKES[key]
      return l.wiki ? [{ label: `Wikipédia : ${l.latin}`, url: l.wiki }] : []
    }),
    { label: 'Anses : intoxications liées à la cueillette', url: ANSES_URL },
  ]

  return (
    <div className="guide__content">
      <Gallery species={s} />

      <div className="guide-sheet__head">
        <div>
          <h1>{s.name}</h1>
          <div className="guide-sheet__latin">{s.latin}</div>
        </div>
        <EdibilityTag edibility={s.edibility} />
      </div>

      <div className="guide-key">
        <span className="guide-key__label">🔑 Critère clé</span> {s.key}
      </div>
      {s.warning && <div className="guide-warning">⚠ {s.warning}</div>}

      <table className="guide-traits">
        <tbody>
          {s.traits.map(([part, value]) => (
            <tr key={part}>
              <th scope="row">{part}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Ne pas confondre avec</h2>
      {s.noDangerousLookalike && <p className="guide-safe">Pas de sosie dangereux connu : vérifiez quand même chaque exemplaire.</p>}
      {s.confusions.map((c) => (
        <ConfusionCard key={c.with} species={s} confusion={c} />
      ))}

      <details className="guide-more">
        <summary>Plus de détails et sources</summary>
        {s.details.length > 0 && (
          <ul>
            {s.details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <ul className="guide-sources">
          {sources.map((src) => (
            <li key={src.url}>
              <a href={src.url} target="_blank" rel="noreferrer">
                {src.label}
              </a>
            </li>
          ))}
        </ul>
      </details>

      <Emergency />
    </div>
  )
}
