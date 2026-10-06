// Page « Champignons » : liste de fiches d'identification (photo, critères,
// confusions dangereuses) — données dans src/data/champignons.ts.
//
// Plein écran par-dessus la carte, comme StationFullscreen, mais branchée
// sur l'historique du navigateur : le bouton retour du téléphone ramène de
// la fiche à la liste puis à la carte, au lieu de quitter l'appli (une page
// qu'on parcourt longuement en forêt, contrairement au détail station).
import { createPortal } from 'react-dom'
import {
  ANSES_URL,
  EDIBILITY_LABEL,
  LOOKALIKES,
  SPECIES,
  photoOf,
  type Edibility,
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
              <img className="guide-card__photo" src={photoUrl(s.photo)} alt="" loading="lazy" />
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

function SpeciesSheet({ species: s }: { species: Species }) {
  const sources = [
    { label: `Wikipédia : ${s.latin}`, url: s.wiki },
    ...s.confusions.flatMap(({ with: key }) => {
      const l = LOOKALIKES[key]
      return 'wiki' in l ? [{ label: `Wikipédia : ${l.latin}`, url: l.wiki }] : []
    }),
    { label: 'Anses : intoxications liées à la cueillette', url: ANSES_URL },
  ]

  return (
    <div className="guide__content">
      <figure className="guide-hero">
        <img src={photoUrl(s.photo)} alt={s.name} />
        <PhotoCredit id={s.photo} />
      </figure>

      <div className="guide-sheet__head">
        <h1>{s.name}</h1>
        <div className="guide-sheet__latin">{s.latin}</div>
        <EdibilityTag edibility={s.edibility} />
      </div>

      {s.warning && <div className="guide-warning">⚠ {s.warning}</div>}

      <h2>Comment le reconnaître</h2>
      <ul>
        {s.identification.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <h2>Où et quand</h2>
      <p>
        <strong>Habitat : </strong>
        {s.habitat}
      </p>
      <p>
        <strong>Saison : </strong>
        {s.season}
      </p>

      {s.tips && (
        <>
          <h2>Bon à savoir</h2>
          <p>{s.tips}</p>
        </>
      )}

      <h2>Risques de confusion</h2>
      {s.noDangerousLookalike && (
        <p className="guide-safe">
          Pas de sosie dangereux connu. Vérifiez quand même chaque exemplaire : un champignon abîmé ou atypique
          peut tromper.
        </p>
      )}
      {s.confusions.map(({ with: key, howToTell }) => {
        const l = LOOKALIKES[key]
        return (
          <div key={key} className={`guide-confusion guide-confusion--${l.edibility}`}>
            {'photo' in l && (
              <figure className="guide-confusion__photo">
                <img src={photoUrl(l.photo)} alt={l.name} loading="lazy" />
                <PhotoCredit id={l.photo} />
              </figure>
            )}
            <div className="guide-confusion__head">
              <div className="guide-confusion__name">{l.name}</div>
              <div className="guide-sheet__latin">{l.latin}</div>
              <EdibilityTag edibility={l.edibility} />
            </div>
            <p className="guide-confusion__danger">{l.danger}</p>
            <div className="guide-confusion__label">Comment les distinguer</div>
            <ul>
              {howToTell.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )
      })}

      <SafetyBanner />
      <Emergency />

      <h2>Sources</h2>
      <ul className="guide-sources">
        {sources.map((src) => (
          <li key={src.url}>
            <a href={src.url} target="_blank" rel="noreferrer">
              {src.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
