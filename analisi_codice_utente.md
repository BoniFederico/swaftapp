# Codice utente in Swaft — capability e action scritte dall'utente

Analisi di fattibilità e proposta di design per consentire all'utente di creare template di tipo
**Capability** e **Action** scritti in JavaScript, registrati su Seebo e utilizzabili nei document e
nelle API request.

Riferimenti verificati sul codice al 2026-07-20 (schema v22, seebo 0.4.0).

**Stato: Fase A implementata** (branch `feature/user_custom_code`). Le capability read-only in
sandbox funzionano end-to-end: nuovo tipo di template `capability`, script host su `utilityProcess`
con timeout e kill, `swaft.env.get`, uso nei document e nei campi API, vista dedicata con test-run.
Fasi B (trust del workspace), C (action + sezione Actions API) e D (profilo developer) da fare — la
Fase B resta il prerequisito prima di qualunque condivisione di workspace con codice.

Scostamenti dalla proposta, decisi durante l'implementazione:

- **Nomi duplicati: non si registra nessuna delle due capability** (§5.1 diceva solo "diagnostica").
  Registrarne una sola avrebbe legato le formule a quella caricata per prima, cioè a un ordinamento
  arbitrario; il principio "ambiguità = mai risoluzione silenziosa" impone di fermarsi.
- **Gli argomenti arrivano appiattiti sul requirement**, non sotto `args`: verificato sul motore, e
  `capabilityArgs` normalizza entrambe le forme.
- **Una chiamata deve sempre portare un `id`** (`cfg({ id: 'x' })`): è il motore a pretenderlo, non
  Swaft.
- **Il `type` dichiarato si legge staticamente** con una regex su `export const type = '…'`, perché
  importare il modulo per conoscerlo avrebbe significato eseguire codice utente durante `validate`.
- **`executionMode` non è ancora onorato**: il profilo è sempre `sandbox`. Onorarlo prima della Fase D
  concederebbe permessi che nulla è pronto a controllare.

---

## 1. Verdetto in breve

La feature è **fattibile e architetturalmente coerente** con quello che Swaft è già: il motore
espone esattamente i due punti d'innesto che servono (`capabilities` in `createEngine`,
`engine.defineAction`), e Swaft li usa già per `env`, `template` e `log`. Il grosso del lavoro non è
"far girare JS", è **decidere dove gira e con quali poteri**.

Ci sono però quattro punti su cui la proposta iniziale va corretta prima di scrivere codice. Sono
elencati per intero nella §3; in sintesi:

1. **La scrittura di `swaft.env` non può stare nelle capability.** Le capability girano dentro il
   render, e i render in Swaft sono continui, ripetuti e speculativi (analisi di reachability a ogni
   modifica, anteprima all'hover, auto-render del document). Un effetto lì sarebbe non deterministico
   e non auditabile. La scrittura appartiene alle **action**, che hanno già conferma, receipt e audit.
2. **Il renderer non è un'opzione** come sandbox: in produzione la CSP è `script-src 'self'` e il
   renderer è per design *untrusted*. L'unica sede difendibile è un **processo separato**.
3. **Seebo non offre alcuna rete di sicurezza** su questo asse: il suo modello di sicurezza classifica
   capability e action handler come *trusted host code*. Registrandoci codice utente si inverte
   quell'assunzione, e tutto l'isolamento diventa responsabilità di Swaft.
4. **I template sono dati sincronizzati** (🟢). Rendere i template eseguibili significa che aprire il
   workspace di qualcun altro esegue il suo codice. Serve una decisione esplicita di trust, altrimenti
   la feature è un vettore di supply chain.

Il costo reale non è nella registrazione su Seebo (poche decine di righe): è nel runtime isolato, nel
modello di permessi che oggi **non esiste**, e nella disciplina di caching necessaria a non far
esplodere i tempi di render.

---

## 2. Cosa esiste già (punti d'innesto verificati)

### 2.1 Il motore

`SeeboHost.engine()` ([SeeboHost.ts:174](apps/desktop/src/main/seebo/SeeboHost.ts#L174)) costruisce un
engine con:

- `capabilities`: mappa nome → `defineCapability(nome, { type, resolve })`. Oggi i 9 widget
  (`textbox`, `listbox`, …) più le data-capability `template` ed `env`. Il **resolve può essere
  asincrono** — `env` lo è già ([SeeboHost.ts:202](apps/desktop/src/main/seebo/SeeboHost.ts#L202)).
- `engine.defineAction(type, handler)` per gli action handler
  ([SeeboHost.ts:226](apps/desktop/src/main/seebo/SeeboHost.ts#L226)), oggi solo `log`
  ([action-handlers.ts](apps/desktop/src/main/seebo/action-handlers.ts)).

`SeeboConfig` espone anche `functions`, `libraries`, `types`, `macros` e `limits`
([seebo-module.ts:143](apps/desktop/src/main/seebo/seebo-module.ts#L143)) — estensioni oggi
inutilizzate, potenzialmente interessanti in seguito ma fuori scope qui.

**Dettaglio critico per l'efficienza**: `engine()` è chiamato **a ogni** `analyze`, `validate`,
`render`. Non c'è engine persistente. Qualunque cosa si registri deve quindi essere *già compilata* e
costare quanto un accesso a una mappa.

### 2.2 I template

- Il tipo è `z.enum(['document','api'])` ([ops.ts:206](packages/shared/src/ops.ts#L206)); il
  **subtype è una stringa libera** con un catalogo TS (`SUBTYPES`, ops.ts:787).
- `templates.type` è **TEXT senza CHECK** ([schema.ts:87](apps/desktop/src/main/storage/schema.ts#L87)):
  aggiungere tipi **non richiede migrazione né bump di `SCHEMA_VERSION`**.
- Il subtype `javascript` **esiste già** come subtype document: CodeMirror
  ([CodeEditor.tsx:64](apps/desktop/src/renderer/src/editor/CodeEditor.tsx#L64)) e Prettier
  ([format.ts](apps/desktop/src/renderer/src/editor/format.ts)) sono già cablati. L'editor JS è
  **lavoro zero**.
- Draft/release: la source viva è `templates.source`, le release sono snapshot; `resolveSource`
  ([ReleaseService.ts:164](apps/desktop/src/main/workspace/ReleaseService.ts#L164)) dà la "effective
  source". Il codice utente eredita gratis versioning, changelog e rollback.

### 2.3 Il flusso API

`http.send` ([handlers.ts:300](apps/desktop/src/main/transport/handlers.ts#L300)) è già un punto di
orchestrazione sottile: *resolve formule → send → record history*. I trigger pre/post si innestano
esattamente lì (meglio: estraendo l'orchestrazione in un servizio dedicato, lasciando l'handler
sottile).

Il modello request è JSON dentro `templates.source`
([httpRequestSchema, ops.ts:269](packages/shared/src/ops.ts#L269)): **aggiungere una sezione
`actions` non tocca il DB**, solo lo schema zod.

### 2.4 I gate che si ereditano gratis

Catena IPC a quattro stadi: preload (un solo canale) → router (sender check + allow-list derivata da
`OP_NAMES`) → dispatch (session guard default-deny + validazione zod) → handler. E, se l'esecuzione
passa dal layer action, conferma esplicita + receipt redatti + audit.

---

## 3. I quattro vincoli che cambiano il design

### 3.1 Seebo considera il codice registrato *fidato*

`docs/seebo/SECURITY.md` è esplicito: template source e dati risolti sono *untrusted*, mentre
«`define*` extensions, capabilities → **trusted** — host code registered at `createEngine`; receives
plain JS». Il motore si difende dai *template*, non da chi gli registra una capability.

Conseguenze concrete:

- Nessun limite di Seebo (`maxSteps`, `timeoutMs`, …) protegge il corpo di una capability utente:
  quei budget governano l'*evaluation del template*, non il JS dell'host.
- La garanzia di terminazione di Seebo («the language is not Turing-complete, no user loops») **si
  perde**: `while(true)` in una capability blocca chi la esegue. Serve un budget esterno con kill.
- La sanificazione di Seebo però ci aiuta: i valori che rientrano nello stato sono deep-clonati e
  **solo JSON** (niente `Date`, `Map`, class instance, funzioni). Il contratto "una capability
  restituisce JSON serializzabile" non è una limitazione arbitraria: è già il contratto del motore, e
  coincide con ciò che un confine di processo può trasportare. Le due cose si rinforzano.

### 3.2 Il renderer è escluso

In produzione la CSP iniettata dal main è `script-src 'self'`
([index.ts:23-35](apps/desktop/src/main/index.ts#L23)); niente `eval`, `new Function`, blob worker. E
`SWAFT_SECURITY_MODEL.md` §3 (IPC-7) impone che una CSP stretta *ci sia*. Usare il renderer come
sandbox richiederebbe di indebolirla, e comunque il renderer è classificato *untrusted host*: non è
un punto di enforcement. **Scartato.**

### 3.3 `worker_threads` e `node:vm` non sono confini di sicurezza

- `worker_threads` è già usato per il DB
  ([worker-db-backend.ts](apps/desktop/src/main/storage/worker-db-backend.ts)) e dà l'ottimo
  *pattern* (protocollo request/reply, pending map, timeout, `terminate()`, fallback in-process) — ma
  condivide lo spazio di indirizzamento e ha `require`/`process` pieni.
- `node:vm` non compare in tutto il codebase, ed è documentato da Node stesso come non-sicurezza: da
  un context si esce banalmente via `this.constructor.constructor('return process')()`.
- Non esiste in dipendenza nulla tipo `isolated-vm`, `ses`, `quickjs-emscripten`, e l'ambiente è
  offline (l'installazione di pacchetti nuovi è già fallita in passato in questo repo): **il design non
  deve dipendere da una nuova dipendenza npm.**

La risposta è già scritta nei documenti del progetto: `SWAFT_SECURITY_MODEL.md` OOS-1 («run in an
isolated process if OS-level guarantees are needed») e `SWAFT_ARCHITECTURE.md` OD-A8 («`utilityProcess`
may still be used where full process isolation is specifically required»). Quindi: **`utilityProcess`**.

Onestà intellettuale su cosa dà e cosa non dà: `utilityProcess` è un processo Node completo. Isola
crash, memoria e CPU, e permette il kill su timeout — ma **non toglie `require` da solo**. L'assenza di
Node dentro lo script utente va costruita: bootstrap che cancella i global pericolosi, `Module` non
esposto, nessun handle passato, e il codice utente eseguito dentro un contesto minimo. È hardening a
strati, non una capsula perfetta; va scritto nero su bianco che il modello di minaccia è *"utente
distratto e template importato mediamente ostile"*, non *"attaccante determinato con RCE come premio"*.
Chi vuole la seconda deve stare in `sandbox` con la rete chiusa e il workspace non fidato.

### 3.4 Il modello di permessi oggi non esiste

`executionMode` governa **una sola riga** in tutto il main
([ActionService.ts:55-64](apps/desktop/src/main/actions/ActionService.ts#L55)) — e per giunta quasi
inerte, perché il chiamante passa `environment: 'test'` e `permissions: []` fissi. La tabella
sandbox/dev di `SWAFT_SECURITY_MODEL.md` §8.1 (file writes, DB writes, permessi espliciti) è
**documentazione senza implementazione**. `HttpService` ignora del tutto l'execution mode: le blocked
domains valgono sempre.

Quindi "librerie e accessi diversi a seconda di sandbox/developer" **non è un aggancio esistente da
usare: è enforcement nuovo da scrivere**, ed è probabilmente la parte più delicata dell'intera feature.
Vincolo da non violare (EXE-5): *dev non bypassa mai la conferma delle action*.

---

## 4. Il punto di design su cui dissento: `swaft.env` in scrittura

La proposta dice: dentro le funzioni JS si accede a `swaft.env.nome` **in lettura e scrittura**.

La lettura è giusta e semplice: è `EnvironmentService.resolve`
([EnvironmentService.ts:137](apps/desktop/src/main/workspace/EnvironmentService.ts#L137)) già pronto.

La **scrittura dentro una capability** è invece un errore, e non per purismo. Guardiamo quante volte
gira davvero una capability durante l'uso normale:

- `ApiRequestService.analyze` **renderizza ogni campo** della request per calcolare la reachability
  degli input ([ApiRequestService.ts:128](apps/desktop/src/main/workspace/ApiRequestService.ts#L128)) —
  e la UI la richiama a ogni modifica dei campi.
- L'anteprima all'hover renderizza lo slot sotto il mouse (feature aggiunta pochi giorni fa).
- Il DocumentView auto-renderizza; l'editor valida in debounce.
- Il folder policy layer renderizza header, hostname del proxy e campi auth.

Una scrittura di variabile d'ambiente in quel contesto verrebbe eseguita un numero di volte
imprevedibile, in momenti che l'utente non ha scelto, su un dato **🟢 sincronizzato** che finisce nel
file di workspace condiviso. È esattamente la classe di bug che non si riesce a diagnosticare.

**Proposta**: mantenere la simmetria concettuale ma spostare l'effetto dove esiste già la macchina per
governarlo.

| Contesto | `swaft.env` lettura | `swaft.env` scrittura |
|---|---|---|
| Capability | ✅ | ❌ (errore in fase di validazione, non silenzioso) |
| Action | ✅ | ✅ — applicata alla fine, con receipt |

Questo non toglie nulla al caso d'uso vero, che è quello classico: *login → prendi il token dalla
response → salvalo per le chiamate successive*. Quel caso è una **action post-request**, e lì la
scrittura è perfetta: c'è un trigger esplicito, una conferma, un receipt e un audit.

Suggerisco inoltre di **non** usare la forma `swaft.env.nome = valore`. Un assegnamento sembra locale e
sincrono, mentre sotto c'è una scrittura su SQLite + `ws.save()` su un dato sincronizzato. Meglio una
API esplicita e asincrona:

```js
const base = swaft.env.get('BASE_URL');      // lettura: sincrona sul contesto già risolto
await swaft.env.set('TOKEN', body.token);    // scrittura: solo in action, transazionale a fine action
```

Con `set` che **accumula** in un buffer e viene applicata in un'unica transazione al termine
dell'action: se l'action fallisce a metà, non restano scritture parziali, e il receipt può elencare le
chiavi toccate (i valori no — vedi §7).

---

## 5. Architettura proposta

### 5.1 Due nuovi tipi di template

`templateTypeSchema` diventa `z.enum(['document','api','capability','action'])`, con subtype fisso
`javascript` per entrambi i nuovi tipi. Nessuna migrazione DB. L'editor JS, il format e il versioning
funzionano senza modifiche.

**Il nome della capability/action è il nome del template.** È coerente con la decisione già presa per
`template('cfg')`, che risolve per nome (Fase 1, decisione 8). Vincoli da imporre al salvataggio:

- identificatore JS valido (`/^[A-Za-z_$][\w$]*$/`);
- **non riservato**: nessun shadowing dei 9 widget, di `env`, `template`, né dei nomi built-in di Seebo;
- univoco nel workspace tra i template di tipo capability (idem per le action). Ambiguità = diagnostica,
  mai risoluzione silenziosa (di nuovo, coerente con la decisione 8).

### 5.2 Contratto del codice utente

**Capability** — pura, restituisce un valore JSON:

```js
export const type = 'object';           // contratto statico opzionale (come `template`)
export default async function ({ args, swaft }) {
  const base = swaft.env.get('BASE_URL');
  return { base, ts: swaft.now() };     // JSON-serializzabile obbligatorio
}
```

Uso identico a oggi, nei document e nei campi API: `${ mieiDati({ x: 1 }).base }`.

**Action** — effetto, riceve input e contesto:

```js
export const confirm = true;            // default consigliato: true
export async function dryRun({ input, api, swaft }) { return { preview: input }; }
export default async function ({ input, api, swaft }) {
  await swaft.env.set('TOKEN', api.response.json.token);
  return { saved: true };               // diventa il receipt
}
```

Nelle action legate a una request, `api` contiene `request` (sempre) e `response` (solo post-request).

### 5.3 Registrazione: pigra e cacheata, non "eager al salvataggio"

L'idea "al salvataggio si registra su Seebo" va invertita, perché **non esiste un engine persistente**
su cui registrare: `SeeboHost.engine()` ne crea uno nuovo a ogni chiamata. Registrare al salvataggio
non avrebbe nessun engine da aggiornare.

Il modello giusto:

- un **`UserCodeRegistry`** (nuovo servizio main) che conosce i template di tipo capability/action, con
  cache `id → { name, hash, compiledHandle, contract }`;
- invalidazione sul save (`template.updateSource`), sulla release e sul cambio di release selection —
  gli stessi eventi che già invalidano `resolveSource`;
- `SeeboHost.engine()` itera il registry e registra **descriptor sottili**: `resolve` non è il codice
  utente, è un proxy che inoltra al runtime isolato la coppia `(handle, args)`. Costo per engine:
  una `Object.fromEntries` su una mappa già pronta.

Così "salvare registra" resta vero dal punto di vista dell'utente (dal salvataggio in poi la capability
esiste ovunque), senza engine globali da tenere in vita.

### 5.4 Il runtime isolato

Un **`utilityProcess` singolo e riusato** ("script host"), con lo stesso protocollo del DB worker:

- avvio pigro alla prima esecuzione, warm per la sessione; respawn automatico dopo un kill;
- protocollo request/reply con pending map e correlation id, messaggi **solo JSON**;
- **timeout per chiamata** con kill del processo e `CAPABILITY_TIMEOUT`/`ACTION_TIMEOUT` (il kill è
  l'unica difesa reale contro `while(true)`);
- bootstrap che riduce la superficie prima di caricare codice utente (niente `require` esposto, global
  ripuliti, nessun handle passato);
- l'oggetto `swaft` **non contiene mai riferimenti diretti a servizi**: è un proxy che rimanda al main,
  dove i controlli vengono applicati di nuovo. Il main resta l'autorità (EXE-1).

Perché un solo processo e non uno per esecuzione: lo spawn costa decine di ms, e con render continui
sarebbe insostenibile. Il prezzo è che due capability condividono il processo: accettabile perché il
confine che conta è *utente ↔ main*, non *capability ↔ capability*.

### 5.5 I due profili di esecuzione

| | `sandbox` (default) | `developer` |
|---|---|---|
| `require` / import di librerie | ❌ | ✅ su allow-list esplicita |
| Rete | ❌ (nessun `fetch`) | ✅ **solo** via `swaft.http`, che passa da `HttpService` → blocked domains, redirect re-validation, enforced headers |
| Filesystem | ❌ | ✅ limitato a `fileExportRoot` (da implementare, FB-1/FB-2) |
| `swaft.env` lettura | ✅ | ✅ |
| `swaft.env` scrittura | ✅ solo in action | ✅ solo in action |
| Timeout per chiamata | 2s (allineato al `timeoutMs` di Seebo) | configurabile, con tetto |
| Conferma delle action | richiesta | **richiesta comunque** (EXE-5) |

Punto non negoziabile: la rete del codice utente **non** deve essere un `fetch` nudo nel processo
isolato, altrimenti l'intera policy di `HttpService` (blocked domains, SSRF, proxy di folder) viene
aggirata da tre righe di JS. Deve essere un proxy verso il main.

### 5.6 La sezione Actions dell'API view

`httpRequestSchema` guadagna un campo opzionale:

```ts
actions: z.array(z.object({
  ref: z.string(),                      // nome del template action
  trigger: z.enum(['pre','post']),
  input: z.record(z.string()).optional(),   // valori, possono contenere formule ${ … }
  enabled: z.boolean().default(true),
})).max(16).optional()
```

Orchestrazione (estraendo `http.send` in un `ApiRunService`):

1. `resolve` delle formule (già esistente);
2. **pre-action** in ordine: ricevono `api.request`; possono restituire un **patch** della request, che
   viene fuso esplicitamente. Niente mutazione in place: il patch è ispezionabile, loggabile e
   mostrabile nella tab "Request render" già esistente;
3. `HttpService.send`;
4. **post-action**: ricevono `api.request` e `api.response`; qui vivono `swaft.env.set`, le estrazioni e
   le asserzioni;
5. history + receipt.

Resta valida la **decisione 6** del piano Fase 1: `action(...)` dentro i *campi* continua a essere
rifiutata. Le action stanno nella loro sezione, non nelle formule. La distinzione dato/effetto rimane
netta, che è ciò che rende il sistema comprensibile.

Nota di roadmap: questo assorbe naturalmente **Fase 2** (request come action) e **Fase 4**
(output/post-request con extract/assert) del piano esistente — con il vantaggio che extract e assert
diventano codice utente invece di un mini-linguaggio da inventare.

---

## 6. Efficienza

I punti dove questa feature può degradare l'esperienza, con la mitigazione:

| Rischio | Mitigazione |
|---|---|
| Engine ricreato a ogni chiamata | Registry pre-compilato; registrare costa una mappa, non una compilazione |
| Codice utente eseguito su ogni keystroke (`ApiRequestService.analyze` renderizza ogni campo) | Debounce lato UI + **memo per `(capability, JSON(args))` valido per l'intero pass di render**; le capability sono dichiarate pure, quindi la memo è lecita |
| Anteprima all'hover che esegue codice | Eseguire solo capability dichiarate cacheable; riusare la promise-cache già presente in ApiView |
| Round-trip IPC per ogni risoluzione | Un solo processo warm; batch delle risoluzioni indipendenti dello stesso pass |
| Re-parse del template a ogni render | Abilitare l'`astCache` opt-in di Seebo (`docs/seebo/PERFORMANCE.md`) |
| Spawn del processo | Lazy + warm; il costo si paga una volta per sessione |

Va misurato prima di rilasciare: il render di un campo API con una capability utente deve restare
nell'ordine dei millisecondi, altrimenti la digitazione nella URL bar diventa scattosa.

---

## 7. Sicurezza: il rischio da decidere a monte

**I template viaggiano.** `templates` e `releases` sono tabelle 🟢 sincronizzate: fanno parte del file
`.swaft` che si condivide. Oggi condividere un workspace significa condividere *testo*; con questa
feature significa condividere **codice che verrà eseguito** appena qualcuno apre un document o manda una
request.

Non è un dettaglio implementativo, è una scelta di prodotto. Le opzioni:

1. **Trust esplicito per workspace** (consigliata): all'apertura, se il workspace contiene template
   capability/action non ancora fidati, il codice **non gira**; un banner elenca cosa c'è e l'utente
   approva. L'approvazione si lega all'hash del contenuto: modificato il codice, serve riapprovare.
   Il flag di trust è 🔵 **local-only**, altrimenti si autofirmerebbe viaggiando.
2. Firma per autore. Più robusta, ma richiede identità e distribuzione delle chiavi: sproporzionata
   ora.
3. Nessun controllo. Da escludere.

Altri punti fermi:

- **I segreti del keychain non vanno esposti** a `swaft`. Il vincolo esistente ("il renderer non vede
  mai il valore del segreto") va esteso al codice utente: al massimo un riferimento opaco che solo
  `HttpService` sa risolvere.
- **Receipt redatti**: i receipt esistenti già passano da `redact`. Le chiavi env scritte si possono
  elencare, **i valori no** (sono spesso token).
- **`validate` non deve eseguire codice utente**: le diagnostiche dell'editor devono restare statiche.
- Il codice utente non deve poter **ridefinire** capability built-in (§5.1) né registrare action
  con il nome di un handler di sistema.

---

## 8. Impatto sul codice (checklist)

Nessuna migrazione DB richiesta. Nessuna dipendenza npm nuova.

**Shared** — `packages/shared/src/ops.ts`: estendere `templateTypeSchema`, `SUBTYPES`,
`DEFAULT_SUBTYPE`; aggiungere `actions` a `httpRequestSchema`; nuove op (`usercode.*` per test-run e
lista, `workspace.trustCode`) in `OP_NAMES` + `REQUEST_SCHEMAS` + `OpMap`.

**Main** — nuovo `UserCodeRegistry` (compilazione + cache + invalidazione), nuovo `ScriptHostService`
(`utilityProcess`, protocollo, timeout, profili), estensione di `SeeboHost.engine()` per registrare
capability/action dal registry, nuovo `ApiRunService` (orchestrazione pre/post), estensione di
`EnvironmentService` con una `setMany` transazionale, wiring in `app-bootstrap.ts`/`services.ts`,
handler in `handlers.ts`. Un secondo entry point rollup per lo script host in
`electron.vite.config.ts` (come `dbWorker`).

**Renderer** — un `CodeView` per i nuovi tipi (editor JS + pannello di test-run + diagnostiche), arm nel
dispatch di `WorkspaceView.tsx:291`, icone (`WorkspaceView.tsx:41`, `WorkingTree.tsx:77`), il tipo nella
lista hardcoded `WorkingTree.tsx:558`, opzioni in `CreateTemplateDialog.tsx:57`, sezione Actions nella
API view, banner di trust, chiavi i18n en+it, classi CSS per tipo.

**Test** — registry (compilazione, cache, invalidazione, nomi riservati/duplicati); script host
(timeout con kill, crash e respawn, rifiuto di valori non serializzabili); profili
(sandbox: niente rete/require; dev: rete solo via HttpService e blocked domains rispettate); env
(scrittura vietata in capability, transazionale in action); orchestrazione pre/post (patch applicato,
fallimento pre che blocca il send); trust (workspace non fidato → codice non eseguito).

---

## 9. Roadmap consigliata

Sconsiglio il big bang. Un taglio verticale sottile che attraversa tutti gli strati mette alla prova le
scelte difficili (isolamento, caching, trust) su una superficie piccola.

1. **Fase A — Capability read-only in sandbox.** Tipo `capability`, script host con timeout e kill,
   `swaft.env.get`, uso nei document. Niente rete, niente require, niente scrittura. È la fase che
   valida la performance e il modello di isolamento.
2. **Fase B — Trust del workspace.** Prima di qualsiasi condivisione. Va fatta *prima* della C, non dopo.
3. **Fase C — Action utente + sezione Actions API.** Trigger pre/post, patch della request,
   `swaft.env.set` transazionale, receipt.
4. **Fase D — Profilo developer.** Allow-list di librerie, `swaft.http` come proxy verso `HttpService`,
   confine di scrittura su file. È la fase che richiede di implementare davvero la §8.1 del security
   model, oggi solo scritta.

---

## 10. Domande aperte da decidere

1. **Trust**: si adotta l'approvazione per workspace della §7? Senza una risposta qui, la Fase C non
   dovrebbe partire. Va bene adottare l'approvazione per workspace.
2. **`swaft.env` in scrittura solo nelle action**: si accetta la §4, o c'è un caso d'uso per la
   scrittura in capability che mi sfugge? COnfermo si accetta la 4
3. **Sintassi**: `swaft.env.get/set` espliciti (proposta) o `swaft.env.nome` con proxy? La seconda è più
   elegante da leggere ma nasconde l'asincronia e la persistenza. Va bene la proposta con getter e setter.
4. **Scope dei nomi**: capability globali al workspace (proposta) o scoped al progetto come
   `template(...)`? Il progetto darebbe più isolamento, il workspace più riuso. Va bene la proposta.
5. **Fallimento di una pre-action**: blocca il send (proposta) o è ignorabile con un flag per action? Blocca il send.
6. **Le action utente possono essere invocate da un document** con `action({type:'nomeUtente'})`, o
   restano legate alla sezione API? Tecnicamente è gratis; è una scelta di prodotto. Assolutamente sono usabili da un document anche, sia le action che le capability.
