# Come è stato sviluppato YuTreno: l'uso dell'IA

> Copia italiana di [AI_USE.md](../AI_USE.md). In caso di differenze fa fede il testo inglese.

YuTreno è un progetto personale di Nicola Amatucci, sviluppato con un assistente di programmazione basato sull'IA, Claude di Anthropic, usato tramite Claude Code. Questa pagina dice chi ha fatto che cosa, perché chi legge, valuta o riusa il lavoro possa giudicarlo per quello che è.

## Chi ha fatto che cosa

L'autore ha diretto il progetto. Ha scelto che cosa costruire e in quale ordine: la richiesta da cui è nato il piano (più treni con orari e passeggeri), la rete, l'importazione delle linee reali, le richieste della ricerca venute dal confronto di YuTreno con la letteratura. Ha preso le decisioni di progetto: sedici sono registrate, con motivi e date, in [ROADMAP.md](ROADMAP.md#decisioni-prese-dal-proprietario). Ha approvato il piano di ogni fase prima che cominciasse, ha scelto le linee reali, ha scaricato o fornito i dati che l'ambiente di sviluppo non poteva raggiungere, e ha esaminato i risultati.

L'assistente ha scritto la maggior parte del codice, delle verifiche e della documentazione, sotto quella direzione. Ha anche letto le norme (Subset-026, Subset-039, Subset-130, EULYNX, la specifica del blocco mobile di X2Rail-5) dai testi ufficiali e ha registrato nella matrice dei requisiti che cosa è implementato, semplificato o mancante. Durante lo sviluppo ogni commit fatto con l'assistente portava una riga `Co-Authored-By` con il nome del modello. Il repository pubblico parte da un unico commit del 10 novembre 2026; quella storia, circa 250 commit, ciascuno con il motivo della modifica, resta nel repository privato dell'autore e può essere mostrata su richiesta, per esempio a un revisore.

## Come si controlla il lavoro

Il codice scritto con un assistente di IA è affidabile quanto le verifiche che lo circondano, quindi il progetto si fonda sulle verifiche più che sulla sola revisione:

- 23 verifiche (`npm run verify`) che eseguono il simulatore e falliscono quando una regola viene spenta;
- un golden master di 282 corse (`npm run golden`) e uno della pagina, perché una modifica che non deve cambiare il comportamento non possa cambiare nessun numero senza che ce ne si accorga;
- campagne deterministiche con impronte, perché ogni risultato si possa riprodurre byte per byte;
- la matrice dei requisiti (`docs/traceability/matrix.csv`), in cui ogni requisito implementato o semplificato ha un test con il tag.

Gli errori trovati strada facendo sono registrati, non nascosti: la roadmap riporta per esempio un superamento che il motore non contava, trovato aggiungendo la deriva dell'odometria, e come è stato corretto.

## Che cosa significa per chi riusa

- Diritto d'autore e licenze stanno in [NOTICE.md](../../NOTICE.md): il codice è sotto EUPL-1.2, la documentazione sotto CC BY 4.0.
- Il bordo di riferimento non è validato con lo strumento dell'ERA per le curve di frenatura ([VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md)), e niente in YuTreno è un'implementazione certificata di una norma. È uno strumento per la ricerca e la didattica.
- I risultati ottenuti con YuTreno in una pubblicazione dovrebbero citare la versione (il commit) usata e, dove conta, dire che il simulatore è stato sviluppato con l'assistenza dell'IA.
