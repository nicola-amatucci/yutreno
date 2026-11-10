/**
 * Compatibility with the Italian formats of YuTreno 0.x.
 *
 * Until version 0.1 every format of YuTreno had Italian names: scenarios, lines and trains, controller observations
 * and commands, and the protocols towards external dynamics models, onboard units (EVC) and trackside components.
 * Names taken from a standard (Subset-026, Subset-130, EULYNX) were already those of the standard and do not change.
 *
 * The engine now works with English names. This module keeps the old formats usable:
 *  - `toEnglish()` translates any input (scenario, line, train, command, campaign configuration, response of an
 *    external program) from the Italian names to the English ones; English input passes through unchanged;
 *  - `toLegacy()` turns an English output (observation, request to an external program) into the Italian format of a
 *    given kind, with the keys in the same order, for controllers and external programs written for version 0.x.
 *
 * The glossary is also the reference for the translation of the documentation.
 */

/** Italian key → English key, for every format that crosses the boundary of the engine */
export const KEYS_IT_EN: Record<string, string> = {
  a_m: 'to_m',
  abile: 'able',
  accelerazione_ms2: 'acceleration_ms2',
  accoppiatore: 'coupler',
  aderenza: 'adhesion',
  aderenza_mu: 'adhesion_mu',
  allarme_vigilanza: 'vigilance_alarm',
  annullamento_s: 'cancel_at_s',
  annunciato: 'announced',
  arrivo_max_s: 'arrival_max_s',
  arrivo_s: 'arrival_s',
  aspetto: 'aspect',
  attivo: 'active',
  automatico: 'automatic',
  avanti: 'ahead',
  avvisi: 'warnings',
  bersaglio: 'target',
  binario: 'track',
  bloccata: 'locked',
  bloccato: 'locked',
  boe: 'balises',
  bordo: 'onboard',
  bordo_periodo_s: 'onboard_period_s',
  campo: 'field',
  cdb: 'track_circuits',
  comandata: 'commanded',
  comandi: 'commands',
  comando: 'command',
  completare: 'complete',
  composizione: 'consist',
  configurazione: 'configuration',
  coperti: 'covered',
  criteri: 'criteria',
  curve: 'curves',
  da_m: 'from_m',
  dati_treno: 'train_data',
  decel_servizio_ms2: 'decel_service_ms2',
  decel_urgenza_ms2: 'decel_emergency_ms2',
  denominazione: 'designation',
  descrizione: 'description',
  destinatario: 'receiver',
  destra: 'right',
  deviatoi: 'points',
  dietro: 'behind',
  distanza_m: 'distance_m',
  durata_s: 'duration_s',
  elementi: 'elements',
  energia_max_kWh: 'energy_max_kWh',
  energia_netta_kWh: 'net_energy_kWh',
  energia_recuperata_kWh: 'regenerated_energy_kWh',
  energia_trazione_kWh: 'traction_energy_kWh',
  ente: 'element',
  enti: 'elements',
  errore_fermata_max_m: 'stop_error_max_m',
  esito: 'outcome',
  esterno: 'external',
  eventi: 'events',
  fattore: 'factor',
  fattore_freno: 'brake_factor',
  fattore_trazione: 'traction_factor',
  fermate: 'stops',
  fermate_mancate: 'missed_stops',
  fermate_mancate_max: 'missed_stops_max',
  fine_m: 'end_m',
  finita: 'finished',
  forza_compressione_max_kN: 'compression_force_max_kN',
  forza_max_N: 'max_force_N',
  forza_trazione_max_kN: 'tension_force_max_kN',
  forze_accoppiatori_kN: 'coupler_forces_kN',
  forze_kN: 'forces_kN',
  frenatura_servizio: 'service_brake',
  freno: 'brake',
  freno_elettrico: 'electric_brake',
  gallerie: 'tunnels',
  gioco: 'slack',
  guasti: 'faults',
  guasto: 'fault',
  impianto: 'site',
  incompatibili: 'incompatible',
  inconciliabili: 'conflicting',
  indicazione: 'indication',
  indirizzo: 'address',
  iniziale: 'initial',
  inizio: 'start',
  inizio_m: 'start_m',
  integro: 'intact',
  interfaccia: 'interface',
  interventi: 'interventions',
  interventi_max: 'interventions_max',
  itinerari: 'routes',
  itinerario: 'route',
  liberazione: 'release_mode',
  limitazioni_temporanee: 'speed_restrictions',
  limiti: 'limits',
  linea: 'line',
  lunghezza_m: 'length_m',
  manipolatore: 'lever',
  manovrabile: 'able_to_move',
  massa_equivalente_kg: 'equivalent_mass_kg',
  massa_kg: 'mass_kg',
  max_compressione_accoppiatori_kN: 'max_coupler_compression_kN',
  max_compressione_kN: 'max_compression_kN',
  max_oltre_limite_kmh: 'max_over_limit_kmh',
  max_trazione_accoppiatori_kN: 'max_coupler_tension_kN',
  max_trazione_kN: 'max_tension_kN',
  messaggio: 'message',
  meteo: 'weather',
  casi: 'cases',
  pendenza_permille: 'gradient_permille',
  scenari: 'scenarios',
  bordi: 'onboards',
  determinismo: 'determinism',
  bordo_esterno: 'external_onboard',
  modello_frenatura: 'braking_model',
  frenoEP: 'epBrake',
  kGalleria: 'kTunnel',
  messaggio3: 'message3',
  mittente: 'sender',
  modello: 'model',
  modo: 'mode',
  motivo: 'reason',
  motivo_urgenza: 'emergency_reason',
  motore: 'motored',
  nascosto: 'hidden',
  nessuna: 'none',
  nome: 'name',
  non_applicabile: 'not_applicable',
  non_degradata: 'not_degraded',
  non_manovrabile: 'unable_to_move',
  non_voluta: 'unintended',
  normale: 'normal',
  nota: 'note',
  numero: 'number',
  obiettivo: 'target',
  odo_errore_fisso_m: 'odo_error_fixed_m',
  odo_errore_relativo: 'odo_error_relative',
  odometria: 'odometry',
  odometro_m: 'odometer_m',
  oltre_limite_max_kmh: 'over_limit_max_kmh',
  orario: 'timetable',
  orizzonte_m: 'horizon_m',
  pacchetti: 'packets',
  parametri: 'parameters',
  partenza: 'departure',
  partenza_s: 'departure_s',
  passaggio: 'passage',
  passo: 'step',
  pendenza: 'gradient',
  pendenza_attuale_permille: 'current_gradient_permille',
  pendenze: 'gradients',
  periodo: 'period',
  periodo_s: 'period_s',
  porte_aperte: 'doors_open',
  posizione: 'position',
  posizione_memorizzata: 'stored_position',
  potenza_W: 'power_W',
  precedente: 'leader',
  profilo_pendenze: 'gradient_profile',
  profilo_velocita: 'speed_profile',
  progressiva_m: 'chainage_m',
  prossima_fermata: 'next_stop',
  quadro: 'panel',
  quando: 'when',
  rallentamenti: 'speed_restrictions',
  rami: 'branches',
  ramo: 'branch',
  ramo_fine: 'branch_end',
  ramo_inizio: 'branch_start',
  ramo_rovescio: 'reverse_branch',
  resistenza: 'resistance',
  rilascio_kmh: 'release_kmh',
  rinnovo_ma_s: 'ma_renewal_s',
  riporto_normale: 'return_to_normal',
  ritardo_annullamento_s: 'cancel_delay_s',
  ritardo_arrivo_s: 'arrival_delay_s',
  ritardo_max_s: 'delay_max_s',
  rovescio_verso: 'reverse_to',
  segnalamento: 'signalling',
  segnale: 'signal',
  segnali: 'signals',
  sezioni: 'sections',
  sinistra: 'left',
  slittamento: 'slip',
  stato: 'state',
  stazione: 'station',
  superamenti: 'overruns',
  superamenti_max: 'overruns_max',
  supervisione: 'supervision',
  tabelle: 'markers',
  taglio_trazione: 'traction_cut_off',
  tallonato: 'trailed',
  telegramma: 'telegram',
  tempo_manovra_s: 'move_time_s',
  tempo_s: 'time_s',
  tempo_slittamento_s: 'slip_time_s',
  terra: 'trackside',
  terra_periodo_s: 'trackside_period_s',
  testo: 'text',
  tipo: 'type',
  trazione: 'traction',
  treni: 'trains',
  treno: 'train',
  urgenza: 'emergency',
  urgenza_applicata: 'emergency_applied',
  urgenze: 'emergencies',
  uscita: 'overlap_path',
  uscite: 'outputs',
  v_avviso_ms: 'v_warning_ms',
  v_bersaglio_kmh: 'v_target_kmh',
  v_consentita_ms: 'v_permitted_ms',
  v_intervento_ms: 'v_intervention_ms',
  v_rilascio_ms: 'v_release_ms',
  valori_nazionali: 'national_values',
  velocita: 'speeds',
  velocita_coda_ms: 'tail_speed_ms',
  velocita_deviata_kmh: 'diverging_speed_kmh',
  velocita_kmh: 'speed_kmh',
  velocita_ms: 'speed_ms',
  versione: 'version',
  vigilanza: 'vigilance',
  vigilanza_mancata: 'missed_vigilance',
  vigilanza_mancata_max: 'missed_vigilance_max',
};

/** Italian value → English value, by English key; the first entry wins when translating back */
export const VALUES_IT_EN: Record<string, Record<string, string>> = {
  type: {
    dinamica: 'dynamics', bordo: 'onboard', terra: 'trackside',
    radio_perso: 'radio_loss', rallentamento: 'speed_restriction', aderenza: 'low_adhesion', freno_degradato: 'brake_degraded',
    trazione_ridotta: 'traction_reduced', precedente_fermo: 'leader_stopped', arresto_rbc: 'rbc_emergency_stop', messaggio: 'message',
    deviatoio_guasto: 'point_failure', cdb_guasto: 'tvps_failure', comando_posto: 'operator_command',
    itinerario: 'set_route', annulla: 'cancel_route', revoca_rallentamento: 'revoke_speed_restriction', arresto: 'emergency_stop', revoca_arresto: 'revoke_emergency_stop',
    partenza: 'departure', ingresso: 'entry', arrivo: 'arrival', blocco: 'block', divergente: 'diverging', convergente: 'converging',
    URG: 'EMG', STAZ: 'STOP', SEG: 'SIG', GUASTO: 'FAULT',
    interno: 'internal', riferimento: 'reference', esterno: 'external',
  },
  onboard: { interno: 'internal', riferimento: 'reference', esterno: 'external' },
  onboards: { interno: 'internal', riferimento: 'reference', esterno: 'external' },
  trackside: { semplice: 'simple', acc: 'interlocking', esterna: 'external' },
  model: { multimassa: 'multimass', punto: 'point', esterno: 'external' },
  tod: { giorno: 'day', tramonto: 'dusk', notte: 'night' },
  met: { sereno: 'clear', pioggia: 'rain', nebbia: 'fog' },
  weather: { sereno: 'clear', pioggia: 'rain', nebbia: 'fog' },
  adh: { secco: 'dry', umido: 'wet', foglie: 'leaves' },
  adhesion: { secco: 'dry', umido: 'wet', foglie: 'leaves' },
  train: { regionale: 'regional', av: 'high_speed', merci: 'freight' },
  state: { libero: 'free', in_formazione: 'setting', formato: 'set', occupato: 'occupied', in_annullamento: 'cancelling', libera: 'vacant', occupata: 'occupied', disturbata: 'disturbed' },
  position: { manovra: 'moving', fuori_controllo: 'no_end_position' },
  normal: { destra: 'right', sinistra: 'left', destro: 'right', sinistro: 'left' },
  mode: { bloccato: 'blocked', senza_controllo: 'no_detection', nessuno: 'none' },
  aspect: { V: 'green', G: 'yellow', R: 'red' },
  release_mode: { elastica: 'sectional', 'a fine corsa': 'whole_route' },
  emergency_reason: { intervento: 'intervention', scatto: 'trip', arresto: 'emergency_stop' },
  outcome: { superato: 'passed', fallito: 'failed' },
  target: { velocita: 'speed' },
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function mapValue(key: string, v: unknown, table: Record<string, Record<string, string>>): unknown {
  const m = table[key];
  if (!m) return v;
  const one = (x: unknown) => typeof x === 'string' && Object.prototype.hasOwnProperty.call(m, x) ? m[x] : x;
  return Array.isArray(v) ? v.map(one) : one(v);
}

/**
 * Translates the Italian keys and values of an input into English; English input is returned unchanged (as a copy).
 * It runs at every cycle of the onboard and the trackside, so it walks the input without the arrays of pairs and
 * the closures of a generic version, with the same order of the keys and the same result.
 */
export function toEnglish<T = unknown>(x: unknown): T {
  return walkEnglish(x) as T;
}

const KEY_EN = new Map<string, string>(Object.entries(KEYS_IT_EN));
const VALUE_EN = new Map<string, Map<string, string>>(Object.entries(VALUES_IT_EN).map(([k, m]) => [k, new Map(Object.entries(m))]));
const hasOwn = Object.prototype.hasOwnProperty;

function walkEnglish(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walkEnglish);
  if (!isObj(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k in v) {
    if (!hasOwn.call(v, k)) continue;
    const en = KEY_EN.get(k) ?? k;
    const val = walkEnglish(v[k]), m = VALUE_EN.get(en);
    if (!m) { out[en] = val; continue; }
    if (Array.isArray(val)) out[en] = val.map(y => typeof y === 'string' ? m.get(y) ?? y : y);
    else out[en] = typeof val === 'string' ? m.get(val) ?? val : val;
  }
  return out;
}

/** True if the object uses the Italian names of version 0.x (at least one known Italian key at the top level) */
export const isItalian = (x: unknown): boolean => isObj(x) && Object.keys(x).some(k => Object.prototype.hasOwnProperty.call(KEYS_IT_EN, k) && !Object.prototype.hasOwnProperty.call(x, KEYS_IT_EN[k]));

/**
 * Italian keys of each legacy output format: only these are translated back, so the reverse mapping is unambiguous.
 * `parent>key` restricts a key to the objects held by `parent` (the vehicles of a consist had `nome`, the train `name`).
 */
export const LEGACY_KEYS: Record<'observation' | 'dynamics' | 'onboard' | 'trackside', string[]> = {
  observation: ['versione', 'manipolatore', 'trazione', 'freno', 'forze_kN', 'freno_elettrico', 'resistenza', 'pendenza', 'porte_aperte', 'urgenza',
    'allarme_vigilanza', 'aderenza_mu', 'slittamento', 'limitazioni_temporanee', 'modello', 'velocita_coda_ms', 'forze_accoppiatori_kN', 'bordo', 'tipo', 'modo',
    'segnalamento', 'supervisione', 'stato', 'v_consentita_ms', 'v_avviso_ms', 'v_intervento_ms', 'obiettivo', 'distanza_m', 'velocita_ms', 'v_rilascio_ms',
    'motivo', 'segnale', 'aspetto', 'profilo_velocita', 'profilo_pendenze', 'pendenza_attuale_permille', 'prossima_fermata', 'nome', 'arrivo_s', 'partenza_s',
    'linea', 'lunghezza_m', 'treno', 'massa_kg', 'massa_equivalente_kg', 'potenza_W', 'forza_max_N', 'decel_servizio_ms2', 'decel_urgenza_ms2', 'eventi', 'testo'],
  dynamics: ['tipo', 'versione', 'inizio', 'stato', 'comandi', 'trazione', 'freno', 'urgenza', 'porte_aperte', 'binario', 'da_m', 'a_m', 'aderenza_mu', 'pendenze',
    'curve', 'gallerie', 'guasti', 'fattore_freno', 'fattore_trazione', 'treno', 'modello', 'esterno', 'periodo_s', 'orizzonte_m', 'indirizzo', 'composizione', 'composizione>nome',
    'motore', 'accoppiatore', 'gioco', 'frenoEP', 'kGalleria'],
  onboard: ['tipo', 'versione', 'inizio', 'odometria', 'distanza_m', 'velocita_ms', 'accelerazione_ms2', 'boe', 'odometro_m', 'telegramma', 'pacchetti', 'elementi',
    'treno', 'porte_aperte', 'urgenza_applicata', 'trazione', 'freno', 'dati_treno', 'valori_nazionali', 'odo_errore_fisso_m', 'odo_errore_relativo', 'posizione_memorizzata'],
  trackside: ['tipo', 'versione', 'inizio', 'configurazione', 'linea', 'nome', 'lunghezza_m', 'limiti', 'pendenze', 'boe', 'deviatoi', 'normale', 'ramo_rovescio',
    'tempo_manovra_s', 'tabelle', 'ramo', 'da_m', 'a_m', 'itinerari', 'stazione', 'inizio_m', 'fine_m', 'ramo_inizio', 'ramo_fine', 'posizione', 'tvps_overlap', 'velocita',
    'incompatibili', 'automatico', 'orario', 'arrivo_s', 'partenza_s', 'parametri', 'ritardo_annullamento_s', 'rinnovo_ma_s', 'rilascio_kmh', 'riporto_normale',
    'campo', 'interfaccia', 'messaggio', 'mittente', 'destinatario', 'comandi', 'attivo', 'pacchetti', 'elementi'],
};

const reverse = (pairs: [string, string][]): Record<string, string> => {
  const r: Record<string, string> = {};
  for (const [it, en] of pairs) if (!Object.prototype.hasOwnProperty.call(r, en)) r[en] = it;
  return r;
};
const VALUES_EN_IT: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(VALUES_IT_EN).map(([k, m]) => [k, reverse(Object.entries(m))]));
const KEYS_EN_IT: Record<string, Record<string, string>> = Object.fromEntries(Object.entries(LEGACY_KEYS).map(([f, ks]) => [f, reverse(ks.map(k => {
  const [parent, key] = k.includes('>') ? k.split('>') : ['', k];
  return [k, (parent ? parent + '>' : '') + (KEYS_IT_EN[key] ?? key)] as [string, string];
}))]));

/** Turns an English output into the Italian format of version 0.x for the given kind, keeping the order of the keys */
export function toLegacy<T = unknown>(x: unknown, kind: keyof typeof LEGACY_KEYS): T {
  const keys = KEYS_EN_IT[kind];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(keys, k);
  const name = (k: string, parent: string) => {
    const scoped = keys[parent + '>' + k];
    return scoped !== undefined ? scoped.split('>').pop() as string : has(k) ? keys[k] : k;
  };
  const walk = (v: unknown, parent: string): unknown => {
    if (Array.isArray(v)) return v.map(x => walk(x, parent));
    if (!isObj(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) { const it = name(k, parent); out[it] = mapValue(k, walk(val, it), VALUES_EN_IT); }
    return out;
  };
  return walk(x, '') as T;
}
