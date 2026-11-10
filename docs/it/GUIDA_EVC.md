# Guida: collegare un calcolatore di bordo ETCS a YuTreno

> Copia italiana. Il documento di riferimento è la versione inglese [EVC_GUIDE.md](../EVC_GUIDE.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Questa guida è per chi ha, o vuole scrivere, un calcolatore di bordo ETCS (EVC) e vuole metterlo alla prova su YuTreno. Il calcolatore può essere un prototipo di ricerca, un'implementazione didattica o un EVC esistente da avvolgere con un adattatore. La seconda parte descrive il percorso concreto per integrare openETCS, l'implementazione aperta nata dal progetto europeo omonimo, che abbiamo già scaricato, compilato e fatto girare.

Il protocollo è descritto in [BORDO_ETCS.md](BORDO_ETCS.md); qui si racconta come usarlo.

## Cosa si ottiene

L'idea è semplice. YuTreno simula tutto ciò che sta fuori dal calcolatore di bordo:
- la linea con le sue boe;
- il RBC che concede le autorizzazioni;
- il treno che si muove secondo la sua dinamica;
- il macchinista, umano o automatico;
- i guasti degli scenari e il verdetto finale.

Il calcolatore riceve ciò che riceverebbe su un treno vero (odometria, telegrammi delle boe, messaggi radio) e risponde come risponderebbe un vero EVC: frenatura di servizio, urgenza, taglio della trazione, messaggi per il RBC e indicazioni per il DMI.

Il motore va al passo con il calcolatore: si ferma, gli manda la richiesta e riparte solo con la risposta. Quindi una corsa è ripetibile byte per byte. Uno scenario che mette in difficoltà un EVC, per esempio foglie sulla rotaia, un freno degradato o una radio che si perde in un punto preciso, si può rigiocare identico dopo ogni modifica del codice. Il verdetto dice se il treno si è fermato dove doveva, se la protezione è intervenuta e se c'è stato un superamento dell'autorizzazione.

C'è un dettaglio importante: il motore conta i superamenti ma non frena al posto del bordo. Un EVC che sbaglia una curva lascia passare il treno oltre la fine dell'autorizzazione, e il verdetto lo registra. È proprio quello che si vuole scoprire in prova.

## Come vive una corsa, vista dal bordo

Alla **prima richiesta** il campo `start` è vero e arrivano tre cose:
- i dati del treno: lunghezza, velocità massima, decelerazioni, tempi di frenatura e di taglio della trazione, masse rotanti;
- i valori nazionali;
- la posizione memorizzata, cioè il gruppo di boe sotto il treno e la distanza della testa da esso.

È l'equivalente di un inizio missione con posizione valida. Il bordo deve azzerarsi, registrare quel gruppo come LRBG e mandare subito un rapporto di posizione (messaggio 136 con il pacchetto 0). Finché il RBC non riceve quel rapporto non apre la sessione e non manda nulla.

**La prima autorizzazione.** Ricevuto il rapporto, al ciclo successivo arriva il messaggio 3, riferito proprio a quel gruppo di boe. Contiene l'autorizzazione al movimento (pacchetto 15), il profilo statico (27), le pendenze (21), il collegamento delle boe davanti (5) ed eventuali limitazioni temporanee (65). Il bordo converte tutte le distanze dal LRBG alle sue coordinate e da lì supervisiona.

**In marcia**, a ogni ciclo (100 ms salvo diversa scelta) arrivano:
- l'odometria;
- le boe superate nel ciclo, ognuna con la lettura dell'odometro al passaggio;
- i messaggi radio.

Il RBC rinnova il messaggio 3 ogni 5 s anche se nulla cambia, e lo rimanda subito quando cambia l'autorizzazione, il gruppo di riferimento o una limitazione. Il bordo deve mandare rapporti di posizione a ogni gruppo di boe letto, perché il RBC usa sempre l'ultimo LRBG segnalato come riferimento dei messaggi successivi.

**Gli scenari** entrano in gioco a metà corsa. Con la radio guasta i messaggi si perdono nei due sensi e il bordo deve accorgersene da solo con `T_NVCONTACT`. L'ordine di arresto arriva come messaggio 16. Le zone di aderenza ridotta e il freno degradato non vengono annunciati: si vedono solo dagli effetti, cioè frenate più lunghe e slittamenti.

**Alla fine** della corsa il canale si chiude: con un processo, stdin si chiude e il programma deve terminare.

## Dal bordo minimo al proprio EVC

La strada più breve parte da `examples/onboard/minimal_onboard.py`. È un bordo in poco più di cento righe di Python che porta il treno al capolinea su entrambe le linee. Il primo passo è farlo girare così com'è:

```bash
npm run headless -- --onboard "exec:python examples/onboard/minimal_onboard.py"
npm run headless -- --line appennino --onboard "exec:python examples/onboard/minimal_onboard.py"
```

Da lì si sostituisce un pezzo alla volta con il proprio codice, verificando dopo ogni passo che la corsa resti superata.

**Il ciclo di lettura.** Una riga di JSON per richiesta, una per risposta, nient'altro su stdout. I messaggi di diagnostica vanno su stderr, che compare sulla console di YuTreno. Per capire cosa arriva conviene, le prime volte, scrivere ogni richiesta e risposta in un file dal proprio programma.

**La localizzazione.** Il gruppo di boe si riconosce dalla prima boa (`N_PIG` = 0). L'identificativo da usare nei messaggi è `NID_C · 16384 + NID_BG`. L'odometro del passaggio è il riferimento a cui sommare le distanze dei pacchetti.

**I dati di terra.** Nei pacchetti con iterazioni i valori del primo elemento stanno al livello del pacchetto e i successivi in `elements`. Ogni distanza `D_…` è incrementale rispetto all'elemento precedente. Il profilo statico finisce con `V_STATIC` = 127, le pendenze con `G_A` = 255. Le velocità sono in passi da 5 km/h, le distanze in metri.

**La supervisione.** Qui sta il valore di un EVC, ed è la parte da confrontare con il bordo di riferimento di YuTreno (`--onboard reference`), che segue l'impostazione del Subset-026 §3.13. Conviene far girare gli stessi scenari con i due bordi e confrontare i CSV: velocità consentita, stato della supervisione e modo sono nelle stesse colonne.

**Le risposte.** Tre accortezze evitano gli errori più comuni:
- `outputs` e `dmi` devono esserci sempre;
- quando si comanda l'urgenza va indicato `emergency_reason`, perché il verdetto conta come interventi solo quelli con motivo `intervention`;
- l'urgenza va tenuta finché il treno non è fermo.

**Le prove.** Si fanno su tutti gli scenari, poi nella pagina:

```bash
npm run headless -- --scenario scenarios --onboard "exec:python my_onboard.py" --output tests
npm run bridge -- --port 8767 --exec "python my_onboard.py"   # poi nella pagina: ETCS onboard → External via API
```

**Attraversare un confine fra RBC.** Gli scenari con `rbc_borders_m` dividono la linea fra due RBC ([TERRA.md](TERRA.md#più-rbc-e-il-passaggio-fra-rbc)); richiedono la terra con apparato, `--trackside interlocking`. Lì ogni messaggio radio porta `NID_RBC`, e un bordo che lo ignora mescola le autorizzazioni dei due RBC. Cosa serve, nell'ordine in cui la terra se lo aspetta: prendere il primo `NID_RBC` come RBC di supervisione e metterlo in ogni messaggio mandato; quando un'autorizzazione contiene il pacchetto 131, mandare i rapporti di posizione anche all'RBC che indica (lo stesso rapporto, con il suo `NID_RBC`) e tenere da parte i suoi messaggi; al primo rapporto verso di lui con la testa, più l'incertezza dell'odometria, oltre il confine (`D_RBCTR` dalla LRBG del pacchetto), usare i suoi messaggi conservati e trattarlo come RBC di supervisione; dal vecchio RBC accettare solo il messaggio 24 con il pacchetto 42 e `Q_RBC` = 0, e rispondere con il messaggio 156. Il vecchio RBC ordina la chiusura solo dalla tua coda confermata, quindi i tuoi rapporti di posizione devono portare `Q_INTEGRITY` 1 (o `Q_LENGTH` 1 della Baseline 3) con `L_TRAININT`. Gli esempi in `examples/onboard/` non lo fanno: funzionano con un solo RBC, come prima. Il modello è il bordo di riferimento (`readRadio`, `positionReport` e `handoverStep` in `src/core/evc.ts`).

**Dietro e davanti in un blocco mobile.** Con `spacing: 'moving_block'` ([BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)) l'RBC costruisce l'autorizzazione del treno dietro il tuo dalla coda confermata che danno i tuoi rapporti di posizione: `Q_INTEGRITY` 1 (o `Q_LENGTH` 1) e `L_TRAININT`, dalla coda minima sicura nell'istante in cui il treno era noto integro alla testa stimata. Senza, il tuo treno non è mai confermato e il treno dietro è distanziato dal blocco fisso. Riporta ogni `T_CYCLOC` secondi del pacchetto 58, che arriva in ogni messaggio 3, e a ogni gruppo di boe; leggi `train.integrity` della richiesta e riporta `Q_INTEGRITY` 3, senza `L_TRAININT`, finché vale `"lost"`.

Se l'EVC è scritto in un linguaggio compilato, il collegamento più semplice resta lo stesso: un eseguibile che legge stdin e scrive stdout. Se deve restare acceso fra una corsa e l'altra o girare su un'altra macchina, si mette in ascolto su TCP (`--onboard tcp://host:port`) con lo stesso formato a righe.

### Controlli sul proprio bordo

Prima di dare la colpa al proprio algoritmo conviene verificare il protocollo:
- la prima risposta contiene un messaggio 136 con il gruppo della posizione memorizzata;
- `D_LRBG` è in metri, positivo nel verso di marcia;
- le distanze dei pacchetti sono sommate all'odometro del LRBG del messaggio, non dell'ultimo gruppo letto;
- l'urgenza resta comandata fino a velocità zero.

Se il bordo non riceve mai il messaggio 3, quasi sempre il rapporto di posizione è sbagliato o manca. Se il treno parte e si ferma subito, di solito è un errore di riferimento delle distanze.

## Integrare openETCS

### Che cos'è e in che stato è

openETCS è stato un progetto europeo del programma ITEA2, chiuso alla fine del 2015. Voleva una «implementazione di riferimento non vitale» del bordo ETCS, basata sul Subset-026. Il modello è scritto in SCADE e da lì è generato il codice C. Il risultato è pubblicato con la openETCS Open License Terms, una doppia licenza che comprende la EUPL (dalla 1.1) e la Creative Commons Attribution-ShareAlike 3.0.

Il codice generato sta nel repository `srcAndBinary`, il cui ultimo commit è del gennaio 2016, con i rilasci v0.3 e v0.4 e il dimostratore della linea Amsterdam–Utrecht. Il modello SCADE e la documentazione sono nel repository `modeling`. È quindi materiale fermo da anni, ma completo abbastanza da girare. Per rigenerare il codice servirebbe SCADE, che è commerciale; per usare quello già generato basta un compilatore C.

### Cosa abbiamo verificato

Lo script `examples/openetcs/build.sh` scarica il repository e compila con gcc i 1109 file C del calcolatore di bordo in una libreria statica. Costruisce poi una prova minima (`test_evc.c`) che inizializza il contesto ed esegue 500 cicli da 10 ms:

```bash
sh examples/openetcs/build.sh            # crea ./openetcs-build, circa 500 MB, un minuto
```

La compilazione va a buon fine senza modifiche, a patto di aggiungere al percorso degli header la libreria matematica di SCADE (`libmathext`), che nel repository si trova accanto alla variante per ERSA. La prova gira: il bordo diventa pronto dopo un centinaio di cicli e resta nel modo No Power (codice 16). È il comportamento atteso, perché nessuno ha ancora attivato la cabina. Il contesto del calcolatore occupa circa 2 MB e un ciclo costa una frazione di millisecondo.

Su Windows lo script gira in WSL o in MSYS2 con gcc.

La funzione principale generata è una sola:

```c
void EVC(kcg_bool reset, odometry_T_Obu_BasicTypes_Pkg *API_Odometry, T_internal_Type_Obu_BasicTypes_ API_SystemTime,
         API_TrackSideInput_T_API_Msg_Pk *API_fromTrack, DMI_to_EVC_Message_int_T_API_DM *API_fromDMI,
         TIU_Input_msg_API_TIU_Pkg *API_fromTIU, mobileHWStatus_Type_MoRC_Pck *API_mobileHWStatus,
         ps_dataForStartOfMission_T_API_ *API_persistentData, outC_EVC *outC);
```

Le uscite stanno nel contesto `outC`:
- `API_toRBC`, i messaggi per il RBC;
- `API_toTIU`, i comandi di frenatura;
- `API_toDMI`;
- alcune grandezze di servizio comode per le prime prove: `debugCurrentMode`, `debugPermittedSpeed`, `debugIinterventionSpeed`, la posizione nominale e i suoi limiti.

### L'adattatore

L'integrazione consiste in un programma C, l'adattatore, che parla con YuTreno con il protocollo del bordo esterno su stdin/stdout e all'interno chiama `EVC()`. Tenerlo come processo separato ha due vantaggi. Il motore non cambia. E il codice openETCS, con la sua licenza a reciprocità, resta in un programma a sé invece di mescolarsi con YuTreno (questa è un'osservazione di metodo, non un parere legale).

Il primo compito dell'adattatore è il tempo. YuTreno chiede un ciclo ogni 100 ms, openETCS è progettato per cicli da 10 ms. Per ogni richiesta l'adattatore esegue quindi dieci cicli, con `API_SystemTime` in millisecondi e l'odometria interpolata nel ciclo. Meglio ancora si può impostare il ciclo del bordo a 10 ms con `--onboard-cycle 0.01`, al prezzo di dieci volte più scambi.

Il secondo compito è tradurre gli ingressi:
- **Odometria.** Il tipo `odometry_T` vuole la posizione nominale con un minimo e un massimo in centimetri, le velocità in cm/s, l'accelerazione in centesimi di m/s², l'istante di misura, lo stato di moto e la direzione. La distanza di YuTreno diventa la nominale, e l'intervallo si costruisce con un errore proporzionale alla distanza percorsa.
- **Boe e radio.** Arrivano tutte da un solo ingresso, `API_fromTrack`, un messaggio per ciclo. L'adattatore deve quindi mettere in coda boe e messaggi e consegnarli uno per ciclo. Per una boa si compila l'intestazione del telegramma e la posizione del centro della boa in odometria. Per un messaggio radio si compila l'intestazione del messaggio. In entrambi i casi i pacchetti vanno in forma «compressa»: una tabella di metadati con `nid_packet` e indirizzi di inizio e fine, più un vettore di interi con le variabili nell'ordine del Subset-026. Il codice del simulatore di terra di openETCS (`MEN_demonstrator_stubs/Simulation`) contiene già le funzioni di conversione dai pacchetti strutturati alla forma compressa. Ci sono per tutti i pacchetti che manda il nostro RBC (`C_P005_tracksim_compr`, `C_P015_…`, `C_P021_…`, `C_P027V1_…`, `C_P065_…`) e per i valori nazionali del pacchetto 3. Conviene usare quelle invece di riscriverle. È anche il motivo per cui YuTreno trasmette i pacchetti con i nomi e nell'ordine della specifica.
- **Interfaccia treno.** `API_fromTIU` porta lo stato del treno: cabina attiva, direzione, integrità, trazione, sonno e non leading. Con il tipo di inserimento fisso porta anche i dati del treno, che si ricavano da `train_data`. Attivando la cabina il bordo esce dal modo No Power.
- **DMI.** L'inizio missione di openETCS passa dal DMI: identificativo del macchinista, livello 2, dati del RBC e comando di partenza. L'adattatore deve recitare questa sequenza su `API_fromDMI` nei primi cicli. Il protocollo del DMI segue quello di ERSA, i cui dettagli non sono aperti, quindi va ricostruito dai tipi generati (`DMI_to_EVC_Message_int_T`).

Il terzo compito sono le uscite. `API_toTIU.info.brake_command` diventa `service_brake` e `emergency`. `API_toRBC` va decompresso nel formato JSON dei messaggi, a partire dal 136 con il pacchetto 0. Velocità consentita, di intervento e modo vanno nel `dmi` della risposta.

### Cosa serve anche dalla parte di YuTreno

openETCS segue la specifica più da vicino del nostro RBC, e qui sta la parte principale del lavoro.

L'inizio missione vero passa per un dialogo che il nostro RBC oggi non fa: il bordo apre la sessione (155), il RBC risponde con la versione del sistema (32), il bordo conferma (159) e manda i dati del treno validati (129), il RBC li accetta (8) e il bordo chiede l'autorizzazione (132). Il RBC va quindi esteso con questi messaggi, con i riconoscimenti (`M_ACK` e messaggio 146) e con l'uso corretto di `T_TRAIN`.

Probabilmente servirà anche il pacchetto 3 dei valori nazionali e, se l'EVC lo richiede, l'autorizzazione con le sezioni e i temporizzatori. Sono estensioni utili comunque, perché avvicinano il lato terra di YuTreno a quello reale per qualsiasi EVC.

### Il piano proposto

1. **Adattatore senza movimento.** L'adattatore riceve le richieste, esegue i cicli, attiva la cabina e recita l'inizio missione sul DMI. Si controlla che il bordo arrivi in Stand By e poi tenti di aprire la sessione radio. È il punto in cui si scopre quanta parte del DMI va ricostruita.
2. **Dialogo di inizio missione nel RBC di YuTreno.** Messaggi 155, 32, 159, 129, 8, 132 e i riconoscimenti, con una verifica che lo copra.
3. **Boe e messaggio 3 in forma compressa**, con le funzioni di conversione del simulatore di terra di openETCS. Obiettivo: modo Full Supervision con una velocità consentita sensata.
4. **Uscite e corsa completa.** Comandi di frenatura, rapporti di posizione e DMI. Obiettivo: il controllore di esempio porta il treno al capolinea con il bordo openETCS.
5. **Scenari e confronto.** Tutti gli scenari con openETCS, con il bordo di riferimento e con la supervisione interna, sugli stessi dati. È il risultato più prezioso: tre implementazioni dello stesso sistema di protezione messe alla prova sulle stesse condizioni ripetibili.

I primi due passi sono quelli con più incertezza, perché dipendono da quanto il modello openETCS segua fedelmente l'inizio missione della specifica. Gli ultimi tre sono lavoro di traduzione fra formati già noti.

### Rischi da tenere presenti

Il codice è fermo dal 2016 e il modello copriva un sottoinsieme delle funzioni, pensato per il dimostratore; alcune parti potrebbero essere incomplete. Il protocollo del DMI non è pubblico. Le dimensioni dei vettori generati, per esempio 500 interi per i pacchetti di un messaggio, pongono limiti da rispettare. E infine la licenza: un adattatore che include codice openETCS va distribuito rispettandone i termini.

## Fonti

- openETCS, D3.8 Open Source Code (rimanda al repository `srcAndBinary` e indica la licenza): https://itea4.org/index.php/project/workpackage/document/download/2593/D3.8.%20openETCS%20-%20Open%20Source%20Code.pdf
- openETCS, D3.5.4 API (interfacce del calcolatore, ciclo da 10 ms, tipi di odometria, TIU e DMI): https://itea4.org/index.php/project/workpackage/document/download/2573/D3.5.4.%20openETCS%20-%20API.pdf
- openETCS, D3.6.1 Functional Model: https://github.com/openETCS/modeling/blob/master/deliverables/D3.6.1.pdf?raw=true
- Codice generato: https://github.com/openETCS/srcAndBinary
- ERA, specifiche ERTMS/ETCS (Subset-026, Subset-034, Subset-094), pubblicate dall'Agenzia dell'Unione europea per le ferrovie.
