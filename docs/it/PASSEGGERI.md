# Passeggeri

> Copia italiana di [PASSENGERS.md](../PASSENGERS.md). In caso di differenze fa fede il testo inglese.

Con `passengers` in uno scenario i treni portano persone. Arrivano in banchina da una domanda origine–destinazione, aspettano, salgono sul primo treno che serve la loro destinazione quando c'è posto, e lì scendono. Chi sale e chi scende determina la sosta, e le persone a bordo si aggiungono alla massa del treno. La corsa riporta attesa, viaggio, ritardo e carico, e i dati aperti pubblicano l'occupazione.

Il modello è **aggregato**: segue flussi di passeggeri, non individui. Le domande che YuTreno pone sui passeggeri (soste, puntualità, energia, comfort) dipendono dai flussi, e un modello aggregato mantiene la corsa deterministica e le sue misure esatte per quei flussi. La scelta del percorso dei singoli passeggeri resta fuori dal modello.

Senza `passengers` niente di tutto questo esiste e ogni corsa resta quella di prima.

Il codice: `src/core/passengers.ts` contiene il modello (domanda, banchine, code, salite e discese, misure), indipendente dai treni; `src/core/boarding.ts` lo collega ai treni della corsa (porte che si aprono e chiudono in fermata, sosta, massa a bordo, energia per passeggero-km in `Simulation.passengers()`).

## Un primo esempio

```json
{
 "line": "valle-lauro",
 "trains": { "count": 4, "headway_s": 600, "directions": "both" },
 "passengers": {
  "demand": [
   { "from": "Valle Lauro", "to": "Monte Clanio", "per_hour": 900 },
   { "from": "Ponte Sabato", "to": "Monte Clanio", "per_hour": 700 },
   { "from": "Monte Clanio", "to": "Valle Lauro", "per_hour": 250 }
  ]
 }
}
```

È una configurazione di scenario ([CONFIGURAZIONE_SCENARIO.md](CONFIGURAZIONE_SCENARIO.md)); `passengers` viene copiato così com'è nello scenario, e lo stesso campo funziona in qualunque scenario. L'esempio completo è `examples/scenario-config/valle-lauro-passengers.json`:

```
npm run headless -- --scenario examples/scenario-config/valle-lauro-passengers.json --controller examples/ato.js
```

L'ultima riga dell'uscita riassume i passeggeri. Con `--output <cartella>` il file `<scenario>_<corsa>_passengers.json` contiene tutte le misure e ogni fermata di ogni treno. Da TypeScript, `Simulation.passengers()` restituisce gli stessi dati durante la corsa o alla fine.

## La domanda

Ogni elemento di `demand` è un flusso da una stazione a un'altra, in passeggeri all'ora, eventualmente entro una finestra `start_s`–`end_s` in secondi della corsa; i flussi con la stessa coppia si sommano. Un'ora di punta del mattino è fatta di più finestre con intensità diverse.

Un flusso può cambiare treno: con `"via": "<stazione>"` i suoi passeggeri viaggiano fino a quella stazione, raggiungono l'altra banchina in `transfer_s` (predefinito 60 s) e prendono il primo treno che serve la loro destinazione, in coda con chi parte da lì. Il cambio è dichiarato, non scelto dai passeggeri, e avviene una volta.

`arrivals` sceglie come arrivano le persone:
- `uniform` (predefinito): un flusso continuo. Le quantità sono numeri reali (1,5 passeggeri è la metà di tre), la corsa è del tutto deterministica e le misure sono esatte per il flusso;
- `poisson`: fra due visite di un treno a una banchina il numero di persone arrivate si estrae da una distribuzione di Poisson con la media del flusso, con il generatore inizializzato da `seed` (predefinito 1). Le quantità sono persone intere. Lo stesso seme dà la stessa corsa, byte per byte.

## In una fermata

Quando le porte si aprono scendono i passeggeri diretti a questa stazione. Poi salgono quelli che aspettano una stazione che il treno serve più avanti, prima chi è arrivato prima, finché c'è posto; quando non c'è, ogni destinazione ha una parte del posto in proporzione alla sua coda (resti più grandi, con persone intere). Quando le porte si chiudono salgono anche quelli arrivati nel frattempo. Chi vuole ancora questo treno e non riesce a salire resta in banchina per il successivo, ed è contato come **lasciato a terra** a ogni partenza (una persona lasciata da due treni conta due volte).

La sosta di cui hanno bisogno i passeggeri è

```
sosta = fixed_s + max(discese, salite) / porte × per_passenger_s × (1 + crowding × quota in piedi)
```

dove *porte* è il numero di porte del treno, usate in parallelo, e la quota in piedi è la parte dei posti in piedi occupata, prima o dopo la fermata, la maggiore delle due. I valori predefiniti sono `fixed_s` 12 s (apertura, chiusura e consenso alla partenza), `per_passenger_s` 1,5 s e `crowding` 0,6. Sono dell'ordine dei valori misurati per i treni regionali nella letteratura sulle soste, che le lega ai passeggeri attraverso le porte e all'affollamento (Weston per la metropolitana di Londra; TCRP Report 165, *Transit Capacity and Quality of Service Manual*, capitolo sulla sosta); sono valori predefiniti dichiarati di YuTreno, da tarare sulla linea studiata.

Le porte restano aperte finché i passeggeri non hanno finito, e comunque fino alla sosta minima e all'orario di partenza. Vale per i servizi e per il treno comandato: il guidatore automatico e un controllore esterno vedono le porte aperte e non possono dare trazione. All'origine il treno comandato prende le persone che aspettano quando parte, senza allungare la fermata. All'ultima fermata scendono tutti; chi aveva una fermata che il treno non ha servito (una fermata mancata, o soppressa dal regolatore) è contato come **portato oltre**.

## Capacità

Il treno ha fra i suoi parametri `seats` (posti a sedere), `standing` (posti in piedi) e `doors` (porte per lato). Se mancano si ricavano dalla lunghezza: 2,7 posti a sedere e 2,0 in piedi per metro, una porta ogni 14 m. L'elettrotreno regionale di 110 m ha così 297 posti a sedere, 220 in piedi e 8 porte, vicino a un treno regionale di quattro casse.

## Massa a bordo

Ogni persona aggiunge `mass_kg` (predefinito 75 kg) al treno. La massa di un passeggero con bagaglio usata nei calcoli di prestazione è un valore normalizzato (EN 15663, *Masse di riferimento dei veicoli*); 75 kg è di quell'ordine e si può cambiare con `mass_kg`. La massa aggiunta:
- aumenta la massa e la massa equivalente del treno (le persone non ruotano, quindi il fattore delle masse rotanti non vale per loro); nel modello multimassa ogni veicolo ha la sua parte in proporzione alla lunghezza;
- rallenta l'accelerazione e aumenta la forza di pendenza e i limiti di aderenza;
- lascia invariata la decelerazione nominale, perché la forza frenante segue la massa, come con la valvola pesatrice dei treni viaggiatori. Lo spazio di frenatura in frenatura di servizio resta quindi lo stesso;
- aumenta l'energia di trazione.

Con la dinamica esterna la richiesta porta la massa delle persone a bordo nel campo facoltativo `payload_kg`, e `train.m` è la massa senza passeggeri ([DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md)). I modelli d'esempio in JavaScript, Python e MATLAB/Octave la aggiungono.

## Misure

`Simulation.passengers()` restituisce:

| Campo | Significato |
| :-- | :-- |
| `arrived`, `boarded`, `alighted`, `waiting`, `onboard` | Persone arrivate in banchina, salite, scese, ancora in attesa e a bordo |
| `left_behind`, `carried_past` | Come sopra |
| `mean_wait_s`, `max_wait_s` | Attesa in banchina all'origine di chi è salito |
| `transfers`, `journeys` | Cambi di treno fatti, viaggi finiti a destinazione |
| `mean_transfer_wait_s`, `max_transfer_wait_s`, `transfer_passenger_min` | Tempo dalla discesa nella stazione del cambio alla salita sul treno successivo (spostamento compreso), e il suo totale in minuti-passeggero: quanto costa una coincidenza persa |
| `transfer_stations` | Per stazione di cambio: passeggeri che vi hanno cambiato, quelli risaliti, la loro attesa media |
| `mean_journey_s` | Dall'arrivo in banchina alla discesa a destinazione, cambi compresi |
| `mean_passenger_delay_s` | Ritardo d'arrivo a destinazione, pesato sui passeggeri che lì scendono |
| `passenger_km`, `energy_kwh`, `energy_wh_per_pkm` | Passeggeri-km, energia netta di tutti i treni e la sua parte per passeggero-km |
| `trains` | Per treno: saliti, scesi, massimo a bordo, coefficiente di riempimento più alto (a bordo / posti a sedere a una partenza), coefficiente medio (passeggeri-km / posti-km), posti a sedere e in piedi |
| `stops` | Per fermata di ogni treno: scesi, saliti, lasciati a terra, a bordo, sosta necessaria |

Valgono sempre `arrived + transfers = boarded + waiting`, `boarded = alighted + onboard` e `alighted = journeys + transfers + carried_past` (senza cambi la prima è `arrived = boarded + waiting`). Leggere le misure non cambia mai la corsa: con arrivi di Poisson le persone arrivate da quando un treno è passato l'ultima volta da una banchina si contano al loro numero atteso, e si estraggono solo quando passa il treno successivo.

## Dati aperti

- **SIRI-ET**: ogni fermata già lasciata porta un `RecordedDepartureOccupancy` di SIRI 2.1 con il livello di occupazione, la percentuale dei posti a sedere occupati e i conteggi di scesi, saliti e passeggeri a bordo. L'uscita è valida contro lo schema SIRI.
- **GTFS-Realtime**: le posizioni dei veicoli portano `occupancy_status` e `occupancy_percentage` (percentuale dei posti a sedere occupati).

Il livello va da `empty` a `manySeatsAvailable` (fino a metà dei posti a sedere), `fewSeatsAvailable` (fino a tutti i posti a sedere), `standingRoomOnly` (fino a metà dei posti in piedi), `crushedStandingRoomOnly` e `full`.

## Limiti

- Un cambio di treno si dichiara con `via`, uno per flusso; i passeggeri non scelgono il percorso né cambiano piano quando una coincidenza è persa, aspettano il treno successivo.
- Il ritardo per passeggero confronta l'arrivo con l'orario dell'ultimo treno preso; il costo di una coincidenza persa sta nell'attesa del cambio e nel tempo di viaggio.
- La domanda non dipende dal servizio: le persone arrivano in banchina con l'intensità data, qualunque sia l'orario.
- Una coda per destinazione e stazione, senza scelta fra treni di velocità diversa; chi è primo nella coda sale per primo.
- La vista 3D disegna una figura per ogni persona in attesa, fino a 60 per banchina: chi va verso la fine della linea sulla banchina del binario I, gli altri su quella del binario II. Salita e discesa non sono animate.

## Cambiare treno: un esempio

Sulla rete della linea Valle Lauro e della diramazione per Rocca Sabato (`scenarios/services/branch-shuttle.json`) il servizio S 4101 aspetta a San Felice Scalo il treno comandato. Con

```json
"passengers": { "transfer_s": 60, "demand": [
  { "from": "Valle Lauro", "to": "Rocca Sabato", "via": "San Felice Scalo", "per_hour": 600 },
  { "from": "Ponte Sabato", "to": "Pietrarsa", "via": "San Felice Scalo", "per_hour": 1200 } ] }
```

97 passeggeri cambiano a San Felice Scalo: quando la coincidenza è mantenuta ciascuno aspetta 127 s, spostamento compreso (205 minuti-passeggero in tutto). Con un rallentamento a 15 km/h prima di San Felice Scalo il treno comandato arriva dopo l'attesa massima dell'S 4101, che parte; aspettano 915 s ciascuno l'S 4103 (1474 minuti-passeggero), e il loro viaggio passa in media da 1042 a 1802 s (`PAX10`).

## Verifiche

`verify-passengers`:
- **PAX1**: conservazione, con arrivi continui e di Poisson;
- **PAX2**: sosta in forma chiusa, con e senza passeggeri in piedi, e porte trattenute dai passeggeri in una corsa;
- **PAX3**: capacità e passeggeri lasciati a terra;
- **PAX4**: massa a bordo: il tempo di accelerazione cresce con la massa equivalente e lo spazio di frenatura resta;
- **PAX5**: determinismo con il seme, e nessun cambiamento senza domanda;
- **PAX6**: dinamica esterna con i passeggeri;
- **PAX7**: occupazione in SIRI-ET e GTFS-Realtime;
- **PAX8**: il treno comandato aspetta i suoi passeggeri;
- **PAX9**: persone in attesa e a bordo nell'istantanea della sala di controllo, che non cambia la corsa;
- **PAX10**: passeggeri che cambiano treno, con la coincidenza mantenuta e persa.
