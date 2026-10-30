// Pluie jour par jour d'une station (fiche Météo-France, Infoclimat, Netatmo) : le graphique en barres habituel, avec
// la valeur écrite sur chaque barre de pluie, et une frise qu'on fait glisser du doigt (ou à la souris) d'un jour à
// l'autre : le jour touché passe en bleu foncé, avec sa pluie et le cumul depuis le premier jour juste au-dessus.
import { useRef, useState } from 'react'
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import './DayRainFrise.css'

export type FriseDay = {
  date: string // yyyy-mm-dd (jour calendaire de Paris)
  mm: number | null // null = aucune mesure ce jour-là
  partial?: boolean // mesures incomplètes : le cumul est un minimum
}

const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })
const fr = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const at = (date: string) => new Date(`${date}T12:00:00Z`) // midi UTC : pas de glissement de jour selon le fuseau
// Marges du graphique : servent aussi à convertir la position du doigt en numéro de jour.
const MARGIN = { top: 14, right: 4, left: 0, bottom: 0 }
const Y_AXIS_WIDTH = 28

export function DayRainFrise({ days }: { days: FriseDay[] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const dragging = useRef(false)
  const box = useRef<HTMLDivElement>(null)

  if (days.length === 0) return null
  const i = picked !== null && picked < days.length ? picked : days.length - 1
  const day = days[i]
  const cumul = days.slice(0, i + 1).reduce((s, d) => s + (d.mm ?? 0), 0)
  const incomplete = days.slice(0, i + 1).some((d) => d.mm === null || d.partial)
  const data = days.map((d) => ({ ...d, label: SHORT.format(at(d.date)), rain: d.mm ?? 0 }))

  // Position horizontale du doigt -> jour (zone de tracé = largeur - axe de gauche - marge de droite).
  const indexAt = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return i
    const plot = rect.width - Y_AXIS_WIDTH - MARGIN.right
    const ratio = (clientX - rect.left - Y_AXIS_WIDTH) / plot
    return Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length)))
  }

  return (
    <div className="frise">
      <div className="frise__readout">
        <b style={{ textTransform: 'capitalize' }}>{LONG.format(at(day.date))}</b> :{' '}
        {day.mm === null ? 'pas de mesure' : `${day.partial ? '≥ ' : ''}${fr(day.mm)} mm`}
        <span className="frise__cumul">
          {' '}
          · cumul depuis le {SHORT.format(at(days[0].date))} : {incomplete ? '≥ ' : ''}
          {fr(Math.round(cumul * 10) / 10)} mm
        </span>
      </div>
      <div
        ref={box}
        className="frise__chart"
        // pan-y : le défilement vertical de la fiche reste possible, le glissement horizontal sert à parcourir les jours.
        style={{ touchAction: 'pan-y', cursor: 'ew-resize', userSelect: 'none' }}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          setPicked(indexAt(e.clientX))
        }}
        onPointerMove={(e) => dragging.current && setPicked(indexAt(e.clientX))}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {/* Bande derrière le jour choisi : visible même quand ce jour n'a pas de pluie (pas de barre à foncer). */}
        <div
          className="frise__band"
          style={{
            left: `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH + MARGIN.right}px) * ${i / days.length})`,
            width: `calc((100% - ${Y_AXIS_WIDTH + MARGIN.right}px) / ${days.length})`,
          }}
        />
        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={data} margin={MARGIN}>
            <XAxis dataKey="label" fontSize={10} interval={data.length > 8 ? 1 : 0} tickLine={false} />
            <YAxis fontSize={10} width={Y_AXIS_WIDTH} />
            <Bar dataKey="rain" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {data.map((d, k) => (
                <Cell key={d.date} fill={k === i ? '#1e3a8a' : d.partial ? '#bfdbfe' : '#2563eb'} />
              ))}
              <LabelList
                dataKey="rain"
                position="top"
                fontSize={9}
                fill="#1e3a8a"
                formatter={(v: unknown) => (typeof v === 'number' && v > 0 ? (v < 10 ? fr(v) : String(Math.round(v))) : '')}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="frise__hint">Faites glisser le doigt sur les barres pour parcourir les jours.</div>
    </div>
  )
}
