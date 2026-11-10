# Configurazione di scenario: scegliere la linea e il numero di treni

> Copia italiana di [SCENARIO_CONFIG.md](../SCENARIO_CONFIG.md). In caso di differenze fa fede il testo inglese.

Uno scenario (`docs/it/SCENARI.md`) descrive tutto di una corsa: linea, treno, eventi, criteri, l'orario di ogni servizio. Scrivere a mano le fermate di dieci treni è lungo. La configurazione di scenario è un JSON breve che dice solo **quale linea** e **quanti treni**; YuTreno la trasforma nello scenario completo.

```json
{
 "name": "Valle Lauro: four trains in both directions",
 "line": "valle-lauro",
 "signalling": "ETCS",
 "trains": { "count": 4, "headway_s": 900, "directions": "both" }
}
```

Si esegue direttamente, come ogni scenario:

```
npm run headless -- --scenario examples/scenario-config/valle-lauro-4.json --controller examples/ato.js
```

oppure si scrive lo scenario che produce, per leggerlo, cambiarlo o metterlo fra gli scenari:

```
npm run make-scenario -- --config examples/scenario-config/valle-lauro-4.json --output scenario.json
npm run make-scenario -- --line valle-lauro --trains 4 --headway 900 --directions both
```

Il treno controllato c'è sempre, con l'orario della linea; `count` è il numero degli altri treni (servizi, guidati dall'ATO interno).

## Campi

| Campo | Significato | Predefinito |
| :-- | :-- | :-- |
| `name`, `description` | Nome e descrizione dello scenario | generati |
| `line` | Id di una linea interna (`valle-lauro`, `rocca-sabato`, `ponte-pietrarsa`) o percorso di un `line.json`, relativo alla configurazione, per esempio una linea reale importata | obbligatorio |
| `train` | Id di un treno interno, per il treno controllato e per i servizi | `regional` |
| `signalling`, `onboard`, `trackside`, `weather` | Come in uno scenario | quelli della corsa |
| `leader` | Treno che precede il treno controllato sulla linea | `false` |
| `trains.count` | Numero di treni di servizio, da 0 a 200 | obbligatorio |
| `trains.headway_s` | Tempo fra due servizi della stessa direzione (s) | 600 |
| `trains.first_departure_s` | Partenza del primo servizio (s dall'inizio) | partenza del treno controllato + `headway_s` |
| `trains.directions` | `forward` (come il treno controllato), `backward`, oppure `both` alternati | `forward` |
| `trains.first_backward_departure_s` | Con `both`, partenza del primo servizio in direzione opposta | prima partenza + metà del distanziamento |
| `trains.dwell_s` | Sosta nelle stazioni intermedie (s) | quella dell'orario della linea |
| `trains.prefix` | Prefisso dei numeri: andata 101, 103, …, ritorno 102, 104, … | `R` |
| `timetable` | Percorso di un estratto di orario reale (sotto): i servizi sono le sue corse | nessuno |
| `from` | Con `timetable`, ora del giorno da cui prendere le corse (`HH:MM`) | la prima corsa |
| `offset_s` | Con `timetable`, secondo della corsa in cui parte la prima corsa scelta | 300 |

I servizi generati fermano in tutte le stazioni, con i tempi di percorrenza dell'orario della linea (`arr` e `dep` delle sue stazioni). Un servizio in direzione opposta usa gli stessi tempi letti al contrario: su una linea con pendenze forti può andare un po' in anticipo o in ritardo.

Su una linea a binario semplice i servizi delle due direzioni si incrociano solo nelle stazioni con un secondo binario; il blocco automatico e l'apparato fermano un treno in stazione finché la sezione davanti non è libera, ma con un distanziamento troppo breve due treni possono aspettarsi a vicenda. Scegli un distanziamento almeno pari al tempo di percorrenza fra due stazioni di incrocio, oppure controlla il risultato nella *Sala controllo*.

## Un orario reale

Con `timetable` i treni sono quelli di un orario reale: le prime `count` corse che partono a `from` o dopo, nelle due direzioni, con le loro fermate e i loro orari. L'estratto è un JSON piccolo:

```json
{
 "format": "yutreno-timetable-extract",
 "version": 1,
 "source": { "publisher": "…", "url": "…", "validity": "…" },
 "trips": [
  { "number": "5004", "stops": [
    { "station": "SALERNO", "departure": "06:00" },
    { "station": "SALERNO IRNO", "arrival": "06:04", "departure": "06:05" },
    { "station": "MERCATO S.SEVERINO", "arrival": "06:36" } ] }
 ]
}
```

I nomi delle stazioni si collegano a quelli della linea senza badare a maiuscole, accenti e punteggiatura; una parola di una lettera vale per una parola che comincia con quella lettera («MERCATO S.SEVERINO» è «Mercato San Severino»). Le fermate in stazioni che non sono sulla linea vengono tralasciate. Gli orari diventano secondi della corsa in modo che la prima corsa scelta parta a `offset_s`.

`examples/infra/salerno-mercato-s-severino/timetable.json` è l'estratto delle 21 corse giornaliere Trenitalia della linea Salerno – Mercato San Severino, dal NeTEx della Regione Campania sul Punto di Accesso Nazionale (`docs/it/TUTORIAL_LINEA.md`, sezione sugli orari). `examples/scenario-config/salerno-real-timetable.json` fa correre le sue prime quattro corse del mattino sulla linea importata da OpenStreetMap, RINF ed EU-DEM:

```
npm run headless -- --scenario examples/scenario-config/salerno-real-timetable.json --controller examples/ato.js
```

Un orario GTFS, NeTEx o railML completo si importa invece con `npm run import` (`docs/it/STANDARD_ORARI.md`); l'estratto serve per una sola linea presa da un file regionale grande.

## Durata della corsa

Una corsa si ferma dopo 7200 s di tempo simulato. Quando l'orario di uno scenario va oltre, come fa una giornata di corse reali, la corsa dura fino a un'ora dopo l'ultimo orario previsto.

## Verifiche

`verify-scenario-config` controlla i servizi generati (numeri, direzioni, orari), gli errori di una configurazione, le corse prese dall'orario reale e una corsa con treni nelle due direzioni. `verify-infra` (INF13) confronta le corse dell'orario reale con i tempi di percorrenza simulati sulla linea importata.
