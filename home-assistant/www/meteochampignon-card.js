/*
 * Carte Lovelace « Météochampignon » : suivi des traitements (cartes de pluie, stations).
 * Sans dépendance (ni Mushroom ni ApexCharts) : tout est dessiné ici.
 *
 *   type: custom:meteochampignon-card
 *   title: Météochampignon        # facultatif
 *
 * Lit les entités du paquet packages/meteochampignon.yaml.
 */
const MC_VERSION = "1.0.0";

const E = {
  probleme: "binary_sensor.meteochampignon_probleme",
  cartesRetard: "binary_sensor.meteochampignon_cartes_en_retard",
  stationsRetard: "binary_sensor.meteochampignon_stations_en_retard",
  echec: "binary_sensor.meteochampignon_traitement_en_echec",
  cartesAge: "sensor.meteochampignon_cartes_age",
  stationsAge: "sensor.meteochampignon_stations_age",
  cartesGeneration: "sensor.meteochampignon_cartes_generation",
  cartesSource: "sensor.meteochampignon_cartes_source",
  cartesJours: "sensor.meteochampignon_cartes_jours",
  cartesHeures: "sensor.meteochampignon_cartes_heures_24h",
  cartesTraitement: "sensor.meteochampignon_cartes_traitement",
  stationsTraitement: "sensor.meteochampignon_stations_traitement",
  stationsDonnees: "sensor.meteochampignon_stations_donnees",
};
const AUTOMATIONS = [
  ["meteochampignon_collecter_stations", "Collecte des stations", "mdi:thermometer", "à :15 et :45"],
  ["meteochampignon_generer_cartes", "Génération des cartes", "mdi:weather-pouring", "à :05 et :35"],
  ["meteochampignon_declencher_jobs", "Secours GitHub", "mdi:github", "si > 90 min sans données"],
  ["meteochampignon_alerte_probleme", "Alerte de problème", "mdi:bell-alert", "notification"],
];
const ACTIONS = [
  ["script.meteochampignon_lancer_maintenant", "Tout lancer", "mdi:rocket-launch", "ok", "Lancer maintenant la collecte et les cartes ?"],
  ["script.meteochampignon_cartes_maintenant", "Cartes ici", "mdi:weather-pouring", "ok", "Générer les cartes sur Home Assistant (3 à 5 min) ?"],
  ["script.meteochampignon_tester_collecte", "Tester la collecte", "mdi:flask-outline", "info", null],
  ["script.meteochampignon_diagnostic", "Diagnostic", "mdi:stethoscope", "info", null],
  ["script.meteochampignon_installer_dependances", "1. Installer les dépendances", "mdi:download", "warn", "Installer les paquets Python des cartes (1 à 3 min) ?"],
  ["script.meteochampignon_verifier_dependances", "2. Vérifier les dépendances", "mdi:check-decagram", "info", null],
];
const LINKS = [
  ["https://meteochampignon.vercel.app/", "Le site", "mdi:open-in-new"],
  ["https://github.com/drugpad/meteochampignon/actions", "Traitements GitHub", "mdi:github"],
];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const valid = (st) => st && !["unknown", "unavailable", ""].includes(st.state);

function fmtAge(min) {
  if (min === null || isNaN(min)) return "—";
  if (min < 1) return "à l'instant";
  if (min < 90) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (h < 48) return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
  return `${Math.round(h / 24)} j`;
}
function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
const ageLevel = (min) => (min === null ? "none" : min > 180 ? "bad" : min > 90 ? "warn" : "ok");
const RUN = {
  success: ["ok", "Réussi", "mdi:check-circle"],
  failure: ["bad", "Échec", "mdi:alert-circle"],
  in_progress: ["info", "En cours", "mdi:progress-clock"],
  queued: ["info", "En attente", "mdi:timer-sand"],
  cancelled: ["warn", "Annulé", "mdi:cancel"],
  inconnu: ["none", "Inconnu", "mdi:help-circle"],
};
const SOURCES = { "home-assistant": "Home Assistant", "github-actions": "GitHub" };

const STYLE = `
:host { display: block; }
* { box-sizing: border-box; }
.wrap { display: grid; gap: 14px; padding: 12px 12px 28px; max-width: 1100px; margin: 0 auto;
  --ok: var(--success-color, #2e9e5b); --warn: var(--warning-color, #e8920c);
  --bad: var(--error-color, #d64545); --info: var(--info-color, #2f80d1); --none: var(--disabled-text-color, #8a8f98); }
.card { background: var(--ha-card-background, var(--card-background-color, #fff)); border-radius: var(--ha-card-border-radius, 16px);
  box-shadow: var(--ha-card-box-shadow, 0 1px 3px rgba(0,0,0,.12)); padding: 16px 18px; color: var(--primary-text-color); }
h2 { margin: 0 0 12px; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 8px; letter-spacing: .01em; }
h2 ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
.sub { color: var(--secondary-text-color); font-size: 13px; }
.hero { display: flex; align-items: center; gap: 18px; color: #fff; border: 0; padding: 20px 22px;
  background: linear-gradient(135deg, var(--c1), var(--c2)); overflow: hidden; position: relative; }
.hero.ok { --c1: #1f8a52; --c2: #3fb87a; } .hero.bad { --c1: #b33030; --c2: #e0654f; } .hero.warn { --c1: #c77a06; --c2: #e8a93a; }
.hero .big { --mdc-icon-size: 56px; opacity: .95; flex: none; }
.hero .t { font-size: 22px; font-weight: 700; line-height: 1.2; } .hero .s { opacity: .9; font-size: 14px; margin-top: 4px; }
.hero .mush { position: absolute; right: -10px; bottom: -22px; --mdc-icon-size: 130px; opacity: .13; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 999px; font-size: 13px;
  background: var(--secondary-background-color, #f0f0f0); color: var(--primary-text-color); }
.chip ha-icon { --mdc-icon-size: 16px; }
.chip.ok ha-icon { color: var(--ok); } .chip.warn ha-icon { color: var(--warn); } .chip.bad ha-icon { color: var(--bad); }
.chip.info ha-icon { color: var(--info); }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); gap: 14px; }
.age { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
.age .v { font-size: 38px; font-weight: 700; line-height: 1; } .age .l { color: var(--secondary-text-color); font-size: 13px; }
.age.ok .v { color: var(--ok); } .age.warn .v { color: var(--warn); } .age.bad .v { color: var(--bad); } .age.none .v { color: var(--none); }
.bar { height: 6px; border-radius: 3px; background: var(--divider-color, #e0e0e0); margin: 10px 0 12px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; background: var(--ok); transition: width .4s; }
.bar.warn i { background: var(--warn); } .bar.bad i { background: var(--bad); } .bar.none i { background: var(--none); }
.rows { display: grid; gap: 8px; margin-top: 12px; }
.row { display: flex; justify-content: space-between; gap: 10px; font-size: 14px; align-items: center; }
.row .k { color: var(--secondary-text-color); display: flex; align-items: center; gap: 6px; }
.row .k ha-icon { --mdc-icon-size: 17px; }
.pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600;
  color: #fff; background: var(--none); text-decoration: none; }
.pill.ok { background: var(--ok); } .pill.bad { background: var(--bad); } .pill.warn { background: var(--warn); } .pill.info { background: var(--info); }
.pill ha-icon { --mdc-icon-size: 14px; }
svg.spark { width: 100%; height: 74px; display: block; }
.spark .none { font-size: 12px; fill: var(--secondary-text-color); }
.auto { display: grid; gap: 4px; }
.arow { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-radius: 10px; }
.arow + .arow { border-top: 1px solid var(--divider-color, #e6e6e6); }
.arow .ic { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center;
  background: var(--secondary-background-color, #f0f0f0); color: var(--secondary-text-color); }
.arow .ic.on { background: color-mix(in srgb, var(--ok) 18%, transparent); color: var(--ok); }
.arow .ic.off { background: color-mix(in srgb, var(--bad) 18%, transparent); color: var(--bad); }
.arow .tx { flex: 1; min-width: 0; } .arow .n { font-size: 14px; font-weight: 500; }
.arow .d { font-size: 12.5px; color: var(--secondary-text-color); }
.actions { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
button.act { all: unset; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
  padding: 14px 8px; border-radius: 14px; font-size: 13px; font-weight: 500; color: var(--primary-text-color);
  background: color-mix(in srgb, var(--c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  transition: transform .1s, background .15s; }
button.act:hover { background: color-mix(in srgb, var(--c) 22%, transparent); } button.act:active { transform: scale(.97); }
button.act ha-icon { --mdc-icon-size: 26px; color: var(--c); }
button.act.ok { --c: var(--ok); } button.act.info { --c: var(--info); } button.act.warn { --c: var(--warn); }
button.act.done { background: var(--ok); color: #fff; } button.act.done ha-icon { color: #fff; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
a.chip { text-decoration: none; }
.foot { text-align: center; font-size: 11.5px; color: var(--secondary-text-color); opacity: .7; }
`;

class MeteochampignonCard extends HTMLElement {
  setConfig(config) {
    this._config = { title: "Météochampignon", ...config };
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._sig = null;
    this._hist = {};
    this._histAt = 0;
    this._done = {};
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._signature();
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
    if (Date.now() - this._histAt > 5 * 60 * 1000) this._loadHistory();
  }

  getCardSize() { return 12; }
  static getStubConfig() { return {}; }

  _signature() {
    const h = this._hass;
    const parts = Object.values(E).map((id) => {
      const s = h.states[id];
      return s ? `${s.state}|${s.last_updated}` : "-";
    });
    for (const [id] of AUTOMATIONS) {
      const a = this._automation(id);
      parts.push(a ? `${a.state}|${a.attributes.last_triggered}` : "-");
    }
    parts.push(Object.keys(this._hist).length, this._histAt, JSON.stringify(this._done));
    return parts.join("~");
  }

  _automation(id) {
    for (const [eid, st] of Object.entries(this._hass.states)) {
      if (eid.startsWith("automation.") && st.attributes && st.attributes.id === id) return st;
    }
    return null;
  }

  async _loadHistory() {
    this._histAt = Date.now();
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [E.cartesAge, E.stationsAge],
        minimal_response: true,
        no_attributes: true,
      });
      const out = {};
      for (const id of [E.cartesAge, E.stationsAge]) {
        out[id] = (res[id] || []).map((p) => {
          const t = p.lu !== undefined ? p.lu * 1000 : p.lc !== undefined ? p.lc * 1000 : Date.parse(p.last_updated);
          return [t, parseFloat(p.s !== undefined ? p.s : p.state)];
        }).filter(([t, v]) => !isNaN(t) && !isNaN(v));
      }
      this._hist = out;
      this._hist._start = start.getTime();
      this._hist._end = end.getTime();
    } catch (e) {
      this._hist = {};
    }
    this._sig = null;
    if (this._hass) this.hass = this._hass;
  }

  _age(id) {
    const st = this._hass.states[id];
    if (!valid(st)) return null;
    const v = parseFloat(st.state);
    return isNaN(v) ? null : v;
  }

  _spark(id, level) {
    const pts = this._hist[id];
    const w = 400, h = 74, pad = 4;
    if (!pts || pts.length < 2) {
      return `<svg class="spark" viewBox="0 0 ${w} ${h}"><text class="none" x="${w / 2}" y="${h / 2}" text-anchor="middle">Historique en cours de collecte…</text></svg>`;
    }
    const t0 = this._hist._start, t1 = this._hist._end;
    const vmax = Math.max(200, ...pts.map((p) => p[1])) * 1.08;
    const X = (t) => pad + ((t - t0) / (t1 - t0)) * (w - 2 * pad);
    const Y = (v) => h - pad - (Math.min(v, vmax) / vmax) * (h - 2 * pad);
    let d = `M${X(Math.max(pts[0][0], t0)).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L${X(pts[i][0]).toFixed(1)},${Y(pts[i - 1][1]).toFixed(1)} L${X(pts[i][0]).toFixed(1)},${Y(pts[i][1]).toFixed(1)}`;
    }
    d += ` L${X(t1).toFixed(1)},${Y(pts[pts.length - 1][1]).toFixed(1)}`;
    const colour = `var(--${level === "none" ? "info" : level})`;
    const area = `${d} L${X(t1).toFixed(1)},${h - pad} L${X(Math.max(pts[0][0], t0)).toFixed(1)},${h - pad} Z`;
    const y180 = Y(180).toFixed(1);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <path d="${area}" fill="${colour}" opacity=".16"/>
      <path d="${d}" fill="none" stroke="${colour}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
      <line x1="${pad}" x2="${w - pad}" y1="${y180}" y2="${y180}" stroke="var(--bad)" stroke-width="1" stroke-dasharray="4 4" opacity=".7" vector-effect="non-scaling-stroke"/>
    </svg><div class="sub" style="display:flex;justify-content:space-between;margin-top:2px"><span>il y a 24 h</span><span style="color:var(--bad)">seuil d'alerte 3 h</span><span>maintenant</span></div>`;
  }

  _runRow(entityId) {
    const st = this._hass.states[entityId];
    const key = valid(st) ? st.state : "inconnu";
    const [lvl, label, icon] = RUN[key] || RUN.inconnu;
    const url = st && st.attributes && st.attributes.html_url;
    const num = st && st.attributes && st.attributes.run_number;
    const inner = `<ha-icon icon="${icon}"></ha-icon>${label}${num ? ` #${esc(num)}` : ""}`;
    return url
      ? `<a class="pill ${lvl}" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`
      : `<span class="pill ${lvl}">${inner}</span>`;
  }

  _panel(kind) {
    const c = kind === "cartes";
    const age = this._age(c ? E.cartesAge : E.stationsAge);
    const lvl = ageLevel(age);
    const when = this._hass.states[c ? E.cartesGeneration : E.stationsDonnees];
    const pct = age === null ? 0 : Math.max(4, Math.min(100, (age / 180) * 100));
    const title = c ? "Cartes de pluie" : "Stations";
    const icon = c ? "mdi:weather-pouring" : "mdi:thermometer";
    const id = c ? E.cartesAge : E.stationsAge;
    let extra = "";
    if (c) {
      const src = this._hass.states[E.cartesSource];
      const jours = this._hass.states[E.cartesJours];
      const heures = this._hass.states[E.cartesHeures];
      extra = `
        <div class="row"><span class="k"><ha-icon icon="mdi:cpu-64-bit"></ha-icon>Calculées par</span><b>${esc(valid(src) ? SOURCES[src.state] || src.state : "—")}</b></div>
        <div class="row"><span class="k"><ha-icon icon="mdi:calendar-range"></ha-icon>Prévision</span><b>${valid(jours) ? esc(jours.state) : "—"} jours</b></div>
        <div class="row"><span class="k"><ha-icon icon="mdi:history"></ha-icon>Cumul mesuré</span><b>${valid(heures) ? esc(heures.state) : "—"} h</b></div>`;
    } else {
      extra = `<div class="row"><span class="k"><ha-icon icon="mdi:database-clock"></ha-icon>Dernière donnée</span><b>${esc(fmtWhen(valid(when) ? when.state : null))}</b></div>`;
    }
    return `<div class="card">
      <h2><ha-icon icon="${icon}"></ha-icon>${title}</h2>
      <div class="age ${lvl}"><span class="v">${fmtAge(age)}</span><span class="l">depuis la dernière mise à jour</span></div>
      <div class="bar ${lvl}"><i style="width:${pct}%"></i></div>
      ${this._spark(id, lvl)}
      <div class="rows">
        ${c ? "" : ""}${extra}
        <div class="row"><span class="k"><ha-icon icon="mdi:github"></ha-icon>Dernier traitement GitHub</span>${this._runRow(c ? E.cartesTraitement : E.stationsTraitement)}</div>
      </div></div>`;
  }

  _render() {
    const h = this._hass;
    const probleme = valid(h.states[E.probleme]) && h.states[E.probleme].state === "on";
    const reasons = [];
    if (h.states[E.cartesRetard] && h.states[E.cartesRetard].state === "on") reasons.push("cartes en retard de plus de 3 h");
    if (h.states[E.stationsRetard] && h.states[E.stationsRetard].state === "on") reasons.push("stations en retard de plus de 3 h");
    if (h.states[E.echec] && h.states[E.echec].state === "on") reasons.push("un traitement GitHub a échoué");
    const ca = this._age(E.cartesAge), sa = this._age(E.stationsAge);
    const worst = Math.max(ca ?? 0, sa ?? 0);
    const heroLvl = probleme ? "bad" : worst > 90 ? "warn" : "ok";
    const heroTitle = probleme ? "Un traitement est en retard ou en échec" : worst > 90 ? "Mises à jour un peu tardives" : "Tout est à jour";
    const heroSub = probleme ? reasons.join(" · ") : worst > 90 ? "Home Assistant relancera GitHub si ça dépasse 90 min." : "Cartes et stations se mettent à jour normalement.";
    const heroIcon = probleme ? "mdi:alert-circle" : worst > 90 ? "mdi:clock-alert" : "mdi:check-circle";
    const src = h.states[E.cartesSource];

    const autos = AUTOMATIONS.map(([id, name, icon, detail]) => {
      const a = this._automation(id);
      const on = a && a.state === "on";
      const last = a && a.attributes.last_triggered;
      return `<div class="arow"><div class="ic ${a ? (on ? "on" : "off") : ""}"><ha-icon icon="${icon}"></ha-icon></div>
        <div class="tx"><div class="n">${esc(name)}</div><div class="d">${esc(detail)}</div></div>
        <div style="text-align:right"><span class="pill ${a ? (on ? "ok" : "bad") : ""}">${a ? (on ? "Actif" : "Désactivé") : "Introuvable"}</span>
        <div class="d" style="margin-top:3px">${last ? `passage ${esc(fmtWhen(last))}` : "jamais passé"}</div></div></div>`;
    }).join("");

    const actions = ACTIONS.map(([id, label, icon, tone], i) =>
      `<button class="act ${tone}${this._done[id] ? " done" : ""}" data-i="${i}"><ha-icon icon="${this._done[id] ? "mdi:check" : icon}"></ha-icon>${this._done[id] ? "Lancé" : esc(label)}</button>`).join("");
    const links = LINKS.map(([u, l, i]) => `<a class="chip" href="${u}" target="_blank" rel="noopener"><ha-icon icon="${i}"></ha-icon>${l}</a>`).join("");

    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="wrap">
      <div class="card hero ${heroLvl}"><ha-icon class="big" icon="${heroIcon}"></ha-icon>
        <div><div class="t">${heroTitle}</div><div class="s">${esc(heroSub)}</div></div>
        <ha-icon class="mush" icon="mdi:mushroom"></ha-icon></div>
      <div class="chips">
        <span class="chip ${ageLevel(ca)}"><ha-icon icon="mdi:weather-pouring"></ha-icon>Cartes ${fmtAge(ca)}</span>
        <span class="chip ${ageLevel(sa)}"><ha-icon icon="mdi:thermometer"></ha-icon>Stations ${fmtAge(sa)}</span>
        <span class="chip info"><ha-icon icon="mdi:cpu-64-bit"></ha-icon>Cartes par ${esc(valid(src) ? SOURCES[src.state] || src.state : "—")}</span>
      </div>
      <div class="cols">${this._panel("cartes")}${this._panel("stations")}</div>
      <div class="card"><h2><ha-icon icon="mdi:robot"></ha-icon>Automatisations</h2><div class="auto">${autos}</div></div>
      <div class="card"><h2><ha-icon icon="mdi:gesture-tap-button"></ha-icon>Actions</h2><div class="actions">${actions}</div><div class="links">${links}</div></div>
      <div class="foot">Météochampignon · carte v${MC_VERSION}</div></div>`;

    this.shadowRoot.querySelectorAll("button.act").forEach((b) => {
      b.addEventListener("click", () => this._run(ACTIONS[Number(b.dataset.i)]));
    });
  }

  _run([id, , , , confirmText]) {
    if (confirmText && !window.confirm(confirmText)) return;
    this._hass.callService("script", "turn_on", { entity_id: id });
    this._done[id] = true;
    this._sig = null;
    this.hass = this._hass;
    setTimeout(() => { delete this._done[id]; this._sig = null; if (this._hass) this.hass = this._hass; }, 4000);
  }
}

if (!customElements.get("meteochampignon-card")) customElements.define("meteochampignon-card", MeteochampignonCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "meteochampignon-card", name: "Météochampignon", description: "Suivi des cartes de pluie et des stations", preview: false });
