# Blocco mobile

> Copia italiana di [MOVING_BLOCK.md](../MOVING_BLOCK.md). In caso di differenze fa fede il testo inglese.

Con il blocco fisso un treno può entrare in una sezione di blocco solo quando il treno davanti l'ha liberata: la sua autorizzazione finisce al segnale prima della prima sezione occupata. Con il blocco mobile finisce un margine dietro la coda del treno davanti, ovunque essa sia. Dalla TSI CCS del 2023 (Regolamento (UE) 2023/1695) non è un livello a sé: quello che si chiamava livello 3 ora è "ETCS livello 2 con blocco mobile". In YuTreno è quindi un'opzione del livello 2 che uno scenario accende (fase 11, decisione 15; il piano è nel progetto del proprietario, `sviluppo/piano-blocco-mobile.md`).

## Come si chiede

```json
{
  "line": "valle-lauro", "signalling": "ETCS", "onboard": "reference",
  "spacing": "moving_block",
  "moving_block": { "margin_m": 50, "report_period_s": 6, "radio_delay_s": 0 }
}
```

`spacing` vale `fixed_block` per impostazione predefinita; `moving_block` contiene tre parametri facoltativi:
- `margin_m`, il margine fra la coda confermata di un treno e la fine dell'autorizzazione del treno che lo segue (il "margine L3" della specifica di X2Rail-5, che ne lascia la misura all'implementazione), 50 m se non indicato;
- `report_period_s`, il periodo dei rapporti di posizione che l'RBC chiede a ogni treno con il pacchetto 58 (`T_CYCLOC`), 6 s se non indicato, come il bordo di riferimento fa comunque;
- `radio_delay_s`, quanto impiega un rapporto di posizione ad arrivare all'RBC, 0 se non indicato.

Il blocco mobile ha bisogno dei rapporti di posizione di ogni treno, quindi funziona con l'ETCS, un bordo a messaggi (`reference` o `external`) su ogni treno, la terra semplice e una linea singola. Se una variante dello scenario sceglie altro (la supervisione interna, il blocco automatico, la terra con apparato, una rete), la corsa resta a blocco fisso e il registro lo dice con un avviso.

## La regola

Per un treno che ne segue un altro nello stesso verso, l'RBC prende la coda confermata del treno davanti dal suo ultimo rapporto di posizione con l'integrità confermata. Per il Subset-026 §3.6.5.2.4 è la testa riportata meno `L_TRAININT`, la lunghezza confermata del treno, che va dalla coda minima sicura nell'istante in cui il treno era noto integro alla testa stimata, e quindi contiene già l'incertezza dell'odometria. Il punto pericoloso è quella coda, e la fine dell'autorizzazione sta il margine più indietro. L'autorizzazione data davvero è la più corta fra questa e quella che darebbero i segnali se i treni dello stesso verso non ci fossero: i segnali continuano a proteggere le partenze trattenute per l'orario, le tratte a binario unico date al verso opposto e le tratte bloccate.

La coda non si sposta mai in avanti. Nel frattempo il treno davanti può solo essere andato avanti, quindi l'ultima coda riportata è sempre dalla parte della sicurezza; un rapporto vecchio costa capacità, mai sicurezza. È qui che il periodo dei rapporti e il ritardo della radio diventano misurabili: il treno che segue resta dietro una coda vecchia al più di un periodo più un ritardo.

Un treno davanti di cui l'RBC non ha mai avuto la coda confermata (appena comparso, o un bordo che non riporta l'integrità) è distanziato dal blocco fisso.

## Integrità e radio

L'interfaccia del treno di un bordo a messaggi può riferire che l'integrità del treno è persa: l'evento di scenario `integrity_loss` con `train` (l'id di un servizio, `leader` per il merci davanti, o il treno comandato se non indicato) e una durata. Il motore manda allora al bordo `train.integrity` nella sua richiesta, solo dopo il primo evento del genere, così le richieste di ogni altra corsa non cambiano. Il bordo di riferimento riporta subito la perdita (Subset-026 §3.6.5.1.4 d) e in ogni rapporto finché l'integrità non è di nuovo confermata (§3.6.5.2.9), con `Q_INTEGRITY` 3 e senza `L_TRAININT`; altrimenti riporta `Q_INTEGRITY` 1 con `L_TRAININT` uguale alla lunghezza del treno più `L_DOUBTUNDER`, come se una fonte esterna confermasse l'integrità subito prima di ogni rapporto. `Q_INTEGRITY` è il nome della Baseline 4; da un bordo esterno la terra legge ancora il nome della Baseline 3 `Q_LENGTH`, con gli stessi valori.

Mentre l'integrità è persa l'RBC non ha una coda confermata nuova e tiene quella vecchia: il treno che segue si ferma dietro il punto in cui il treno davanti era noto integro, e riparte quando l'integrità è di nuovo confermata. Lo stesso succede quando il treno davanti smette di parlare: `radio_loss` con `train` taglia la radio di quel solo treno, nei due sensi (e il suo bordo frena dopo `T_NVCONTACT` senza messaggi dall'RBC, come in ogni perdita della radio).

## Che cosa non fa

È il blocco mobile senza rilevamento del treno a terra, fra treni dello stesso verso, nel percorso dell'RBC semplice. Restano fuori di proposito: la terra con apparato, dove un itinerario in una sezione occupata richiederebbe itinerari permissivi; il rilevamento a terra come ripiego e le sezioni virtuali del rilevamento ibrido; treni senza dispositivo d'integrità misti a treni che l'hanno, salvo il blocco fisso dietro un treno mai confermato; lo stato "sconosciuto" del binario e la ricognizione della specifica di X2Rail-5 dopo un guasto; il modello fisico del dispositivo d'integrità e della lunghezza sicura del treno; la conferma dell'integrità da parte del macchinista. Gli aspetti dei segnali e la sala di controllo mostrano ancora le sezioni di blocco occupate: con il blocco mobile non sono loro a distanziare i treni.

## Verifiche

`npm run verify` esegue `verify-moving-block` (MB1–MB6) sulla linea Valle Lauro con `examples/ato.js` e il bordo di riferimento:

| Caso | Blocco mobile | Blocco fisso |
| :-- | :-- | :-- |
| Dietro il merci (`moving-block`): distanza minima dalla sua coda, arrivo | 94,2 m, 942,8 s | 613,8 m, 1001,8 s |
| Il merci si ferma in linea per 300 s (`moving-block-leader-stopped`): distanza a cui aspetta il treno che segue, arrivo | 85,6 m, 1247,6 s | 210,1 m, 1306,6 s |
| Integrità del merci persa da 150 a 450 s (`moving-block-integrity-loss`): coda congelata a 4994 m, arrivo | 962,7 s | — |
| Radio del merci persa da 150 a 250 s (`moving-block-radio-loss`): coda congelata a 4994 m, arrivo | 1042,2 s | — |
| Rapporti ogni 2 s invece di 6 s, arrivo | 942,0 s | — |
| Rapporti in ritardo di 5 s, arrivo | 945,5 s | — |

A ogni passo di ogni corsa a blocco mobile il treno che segue resta almeno il margine meno 5 m dietro la coda vera del treno davanti, e la sua fine dell'autorizzazione non è mai più vicina a essa del margine. Con un distanziamento di 600 s il secondo servizio tiene l'orario realizzato del blocco fisso e non è mai trattenuto dal segnalamento. La distanza minima della prima riga si raggiunge a 7,6 km, dove il merci fa la sua sosta di 150 s in linea: il treno che segue aspetta dietro di lui al margine più l'età dell'ultimo rapporto, dove con il blocco fisso aspettava una sezione di blocco più indietro.

**Capacità.** `verify-capacity` (CAP5) calcola il distanziamento minimo di due treni regionali dalle code confermate del primo e lo misura: 193,2 s calcolati, 199 s misurati (+3,0 %), contro 239 s con il blocco fisso e lo stesso bordo. La campagna di confronto dei blocchi (`campaigns/block-comparison.json`) trova che il secondo treno non è più trattenuto dal segnalamento da 200 s invece che da 230 s ([CAPACITA.md](CAPACITA.md#blocco-mobile)).

Le righe della matrice sono quelle del Subset-026 §3.6.5.1–3.6.5.2 e dei pacchetti 0 e 58, e quattro righe della specifica di X2Rail-5 (`X2R5-MB-*`).
