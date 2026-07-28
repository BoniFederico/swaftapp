# Enhance Scenario — piano attività

Stato: proposta, non ancora wired. Branch: `feature/enhance_scenarios`.
Schema DB attuale: `SCHEMA_VERSION = 25` (`apps/desktop/src/main/storage/schema.ts:14`).

Due feature:

1. Breakpoint su blocco scenario (pausa + resume + storico esecuzioni parziali).
2. Document template importabili via drag&drop, eseguibili in scenario con richiesta input, + flag "riusa valore per input con stesso id nella run".

---

## 1. Breakpoint su blocco

### Stato attuale rilevante

- Concetto di pausa run **già esiste**, ma solo per `INPUT_REQUIRED` lanciato da un blocco `api` durante `resolve()` (`apps/desktop/src/main/workspace/ApiRequestService.ts:155-240` → `ScenarioService.ts:467-486 pauseForInput`, status `awaiting-input`).
- Stato run (`RunState`) è **solo in memoria**, `Map` in `ScenarioService.ts:103` — **non persiste a un riavvio app**. Le tabelle `scenario_runs`/`scenario_run_steps` (`schema.ts:200-227`) restano come storico ma non permettono resume automatico dopo restart.
- Loop di esecuzione: `ScenarioService.ts:310-356 loop()`, dispatch per blocco: `execBlock() :358-435`.
- Context menu blocco: `ScenarioView.tsx:742-810 NodeContextMenu` (voci attuali: Edit, Run block, Run from here, Delete). Nessuna voce "Duplica" ancora — conferma che aggiungere voci qui è pattern già usato.
- Render nodo canvas (per hover icon): `ScenarioCanvas.tsx:340-390`.
- `status(runId)` (`ScenarioService.ts:262-274`) già ritorna run + step fatti finora dal DB — quindi "vedere dettaglio esecuzioni blocchi fatte finora mentre in pausa" è **quasi gratis**: la UI già mostra lo storico step via `scenario_run_steps`.

### Design proposto

- Nuovo campo `breakpoint?: boolean` sul nodo scenario di tipo `template` (`packages/shared/src/scenario.ts:19-47`, `scenarioNodeSchema`).
- Nuovo status run `paused-breakpoint` (accanto a `awaiting-input`), gestito con lo stesso meccanismo Promise-based di `pauseForInput` (`:467-486`): in `loop()`, prima di chiamare `execBlock()` su un nodo con `breakpoint === true`, sospendere e aspettare un `resume(runId)` esplicito (nuovo metodo simile a `provideInput`, ma senza richiedere valori).
- UI: nuova voce context menu "Toggle breakpoint" (icona a pallino rosso, pattern GDB/VSCode) in `NodeContextMenu` + handler `menuToggleBreakpoint(node)` accanto a `menuDelete`/`menuEdit` (`ScenarioView.tsx:465-483`). Persistere il flag nel grafo scenario (stesso giro salvataggio degli altri campi nodo).
- Hover icon: piccolo indicatore permanente (non solo hover) quando `node.breakpoint === true`, es. bordo rosso o pallino nell'angolo del nodo in `ScenarioCanvas.tsx:340-390`; hover può mostrare un'icona "toggle rapido" cliccabile per non forzare sempre il menu contestuale.
- Pannello run (`ScenarioRunPanel.tsx`): quando status è `paused-breakpoint`, mostrare bottone "Resume" (chiama nuovo `controller.resume()`) + storico step già eseguiti (riuso di quanto già renderizzato per `awaiting-input`, nessun lavoro nuovo qui).

### Decisione

- Confermato: **nessuna persistenza di `RunState` richiesta**. Resume breakpoint valido solo entro la sessione app corrente (coerente col comportamento già esistente di `awaiting-input`). Nessun task di persistenza da pianificare.

### Task

- [ ] `packages/shared/src/scenario.ts` — aggiungere `breakpoint?: boolean` a `scenarioNodeSchema` per nodi `template`.
- [ ] `ScenarioService.ts` — nuovo status `paused-breakpoint`; check pre-`execBlock` nel `loop()`; nuovo metodo `resume(runId)` (senza input) analogo a `provideInput`.
- [ ] IPC/preload — esporre `resume(runId)` al renderer (verificare canale accanto a `provideInput`).
- [ ] `ScenarioView.tsx` — voce menu "Toggle breakpoint" + handler + persistenza su save grafo.
- [ ] `ScenarioCanvas.tsx` — indicatore visivo permanente + hover affordance sul nodo con breakpoint attivo.
- [ ] `ScenarioRunPanel.tsx` — bottone Resume per status `paused-breakpoint`; verificare che lo storico step già visualizzato copra il caso (probabile riuso diretto).
- [ ] Doc utente — aggiornare `docs/guide/scenarios.md` con sezione breakpoint.

---

## 2. Document template via drag&drop + esecuzione in scenario + riuso input

### Stato attuale rilevante

- `document` è **già** un tipo di template di primo livello (`packages/shared/src/ops.ts:235 templateTypeSchema`), con editor dedicato `DocumentView.tsx` e motori per subtype (`document/engines/{MermaidView,EChartsView,SwaggerView}.tsx`).
- **Non è però eseguibile come blocco scenario oggi**: `ops.ts:1199` limita `kind` a `'api' | 'action' | 'capability' | 'decision' | 'delay' | 'start'` — manca `'document'`. Coerente con `execBlock()` (`ScenarioService.ts:358-435`) che gestisce solo `api`/`capability`/`action`, altrimenti errore "Unsupported block type" (`:434`).
- Rendering documento già passa da Seebo con lo **stesso contratto** di richiesta input delle API: `RenderService.render()` (`RenderService.ts:49-56`) chiama `host.render(source, values, undefined, ctx)` → `RenderResultDto` con `pending: RequirementDto[]` (`ops.ts:1008-1020`), identico a `AppError('INPUT_REQUIRED', ..., {pending})` usato da `ApiRequestService.ts:229-233`. Questo rende il pattern di richiesta-input **direttamente riusabile**, non da reinventare.
- UI richiesta input già condivisa: `InputPanel.tsx` (usato sia da `DocumentView` che da `ScenarioRunPanel.tsx:103-114`) — punto di innesto naturale per il nuovo flag "riusa questo valore".
- **Verificato**: per l'import OpenAPI/Postman esistente (`ImportDialog.tsx`) **non c'è drag&drop**, solo file-picker click (`ImportDialog.tsx:113-120`, `<input type="file" accept=".json,.yaml,.yml,...">`) + textarea paste (`:123-133`). Nessun `onDrop`/`onDragOver` nel file. Il rilevamento formato (`adapt()`, `:10-21`) riconosce solo OpenAPI/Postman via shape JSON (`openapi`/`swagger`/`paths` o `item`/Postman `info.schema`).
- Drag&drop **esiste** altrove ma con scopi diversi: singolo-file su un widget (`JsonInput.tsx:56`, ambito ristretto a un campo) e riordino interno albero (`WorkingTree.tsx:589,674,803`, sposta nodi esistenti, non importa file esterni — distingue già `dataTransfer` interno da drop di file OS).
- Import materializzato oggi via op `collection.import` → `ImportService` (main) — pattern architetturale da seguire per il nuovo import (op dedicata, non bypass diretto DB).

### Decisione: generalizzare l'import esistente, non farne uno nuovo isolato

- `ImportDialog.tsx` va **esteso**, non duplicato: aggiungere `onDrop`/`onDragOver` sulla dropzone esistente (o sull'intero dialog) che richiama lo stesso `analyze()`/`f.text()` già usato dal file-picker (`:116-119`) — stesso codice, solo trigger diverso.
- `adapt()` (`:10-21`) va generalizzato a riconoscere anche: `.http` (via `http-file.ts` esistente in `packages/shared/src`, già usato per il formato api-as-.http), e ora anche i document template (subtype da estensione: `.md`, `.html`, `.mermaid`, `.eml`, ecc.) — quindi un unico import multi-formato invece di rami separati per ogni tipo.
- `accept` dell'`<input type="file">` va esteso di conseguenza (oggi `.json,.yaml,.yml` soltanto).
- Vantaggio: un solo componente di import (drag&drop + click + paste dove ha senso) per tutti i formati, invece di un componente nuovo solo per document template.

### Design proposto

**A. Generalizzare `ImportDialog` a drag&drop multi-formato (api .http + document template)**

- Aggiungere `onDrop`/`onDragOver` a `ImportDialog.tsx`, riuso diretto di `analyze()` (`:67-86`) già chiamato dal file-picker — nessuna logica nuova di lettura file.
- Estendere `adapt()` (`:10-21`) con branch `.http` (riuso `http-file.ts` di `packages/shared`) e branch "document" per estensioni non-JSON/YAML riconosciute (`.md`, `.html`, `.mermaid`, `.eml`, ecc. — i subtype già supportati da `DocumentView`): crea template `type: 'document'`, `subtype` da estensione, `source` = contenuto file.
- `accept` input file esteso di conseguenza; drop multi-file per import collettivo (oggi singolo file).
- Materializzazione: per document template, valutare se estendere l'op `collection.import` esistente o aggiungerne una dedicata più semplice (un document non ha "requests"/folders da mappare come una collection OpenAPI) — passa comunque da `ImportService` lato main, mai scrittura diretta DB dal renderer.
- Working Tree: se si vuole drop diretto sull'albero (oltre che nel dialog), serve distinguere "drop per riordino interno" (`dataTransfer` custom già usato da `WorkingTree.tsx:589,674,803`) da "drop file OS esterno" (`dataTransfer.files`) — i due casi non collidono, controllo già naturale su quale proprietà di `dataTransfer` è popolata.

**B. Esecuzione document template come blocco scenario**

- Aggiungere `'document'` a `kind` in `ops.ts:1199`.
- `execBlock()` (`ScenarioService.ts:358-435`): nuovo ramo `type === 'document'` che chiama `RenderService.render(refId, values)`; gestione `pending` **analoga** al ramo `api` (`:377-411`, `for(;;)` + cattura `INPUT_REQUIRED` + `pauseForInput`) — stesso meccanismo, minima duplicazione se estratto in helper condiviso.
- Context `SeeboRenderContext['scenario']` (`{outputs, previousAlias}`, già passato in `ScenarioService.ts:42,319,463-465`) va propagato anche al render del document-block, per permettere `previous(...)` dentro un document template eseguito in scenario (coerenza con blocchi api/action).
- Editor scenario: aggiungere `'document'` alle scelte disponibili quando si crea/collega un nodo `template` (dropdown/tipo referenziabile).

**C. Flag "usa questo valore per altri input della run con stesso id"**

- Estendere `InputPanel.tsx` con un checkbox per-requirement "Usa questo valore per altri input con lo stesso nome in questa run".
- Nuovo stato **per-run** (non per-template come l'attuale `local_input_state` persistito in `RenderService.ts:73-97`, che è cross-sessione per template — concetto diverso, da non confondere): mappa in `RunState` (`ScenarioService.ts:45-60`) `rememberedInputs: Record<requirementId, value>`.
- Quando un nuovo `pending` viene generato (da blocco api O document — il contratto `RequirementDto` è condiviso, vedi sopra) e il suo `id` è già in `rememberedInputs`, auto-risolvere senza chiedere di nuovo all'utente.
- Quando l'utente fornisce un valore con checkbox spuntato via `provideInput`, scrivere in `rememberedInputs` prima di riprendere il loop.

**Decisione**: scope **esteso a tutta la run**, non solo tra document template — vale anche per input richiesti da blocchi `api` nella stessa run. Nessun costo implementativo aggiuntivo: `rememberedInputs` si aggancia allo stesso `pending`/`provideInput` condiviso da entrambi i tipi di blocco.

### Task

- [ ] `packages/shared/src/ops.ts` — aggiungere `'document'` a `kind` (`:1199`).
- [ ] `ScenarioService.ts` — ramo `execBlock` per `type === 'document'` (riuso pattern retry/pausa del ramo `api`); propagare `SeeboRenderContext['scenario']` al render.
- [ ] `ScenarioService.ts` — `rememberedInputs` in `RunState`; logica auto-fill su nuovo `pending`; scrittura su `provideInput` quando flag spuntato.
- [ ] `InputPanel.tsx` — checkbox "riusa valore per input con stesso id in questa run" + wiring valore nel payload di `provideInput`.
- [ ] `ImportDialog.tsx` — `onDrop`/`onDragOver` riusando `analyze()`; estendere `adapt()` per `.http` e document template; estendere `accept` file-picker.
- [ ] Op import — estendere `collection.import` o aggiungerne una dedicata per document template (via `ImportService`, main).
- [ ] (Opzionale) `WorkingTree.tsx` — drop diretto file OS sull'albero, distinto dal drag interno esistente.
- [ ] `ScenarioView.tsx` / editor nodo — permettere di referenziare un template `document` come `ref` di un nodo `template`.
- [ ] Doc utente — `docs/guide/document-templates.md` (import drag&drop) e `docs/guide/scenarios.md` (document block in scenario, flag riuso input esteso a tutta la run).

---

## Considerazioni di fattibilità generali

- Nessuna delle due feature richiede modifiche allo storage on-disk (FORMAT.md) o al codec di export/import scenario esistente — sono estensioni di runtime/UI, basso rischio di rottura backward-compat sul formato file.
- Entrambe riusano meccanismi già esistenti (pausa/resume Promise-based, `RequirementDto`/`InputPanel`, `SeeboRenderContext.scenario`) invece di introdurne di nuovi da zero — riduce rischio e superficie di test.
- `RunState` resta in memoria per scelta (nessuna persistenza cross-restart richiesta) — semplifica sia breakpoint-resume che `rememberedInputs`, entrambi validi solo per la sessione app corrente.
- Il drag&drop per l'import va costruito estendendo `ImportDialog.tsx` esistente (che oggi supporta solo click-picker + paste, non drop) — non è un componente nuovo isolato, ma la generalizzazione di uno già presente con pattern di import via op consolidato.
