# Deploy & Release — considerazioni

Analisi (design-only, nessuna implementazione qui) su come industrializzare build e release di
Swaft: produrre eseguibili per **Windows, Linux e macOS** in automatico su GitHub, con un minimo di
test in CI prima della release, **restando dentro il free tier** di GitHub Actions.

---

## 1. Obiettivo e vincoli

**Obiettivo dichiarato**: quando `main` cambia, generare release con eseguibili per i tre OS; far
girare *qualche* suite di test post-merge e pre-release (non tutte).

**Vincolo dominante — minuti Actions.** Il repo è **privato** ⇒ 2000 minuti/mese inclusi nel piano
free, e i minuti sono conteggiati con un **moltiplicatore per OS**:

| Runner   | Moltiplicatore | 1 minuto reale costa |
| -------- | -------------- | -------------------- |
| Linux    | ×1             | 1 min di budget      |
| Windows  | ×2             | 2 min di budget      |
| macOS    | ×10            | 10 min di budget     |

> Nota: se in futuro il repo diventasse **pubblico**, i minuti Actions sono **illimitati/gratuiti** e
> quasi tutto questo documento si semplifica (la sezione §5 sul risparmio diventa opzionale). Questa è
> la singola leva più grande sui costi: vale la pena valutarla.

Conseguenza pratica: **macOS costa 10× tutto il resto.** Un solo job macOS da 8 minuti "brucia" 80
minuti di budget. Tutta la strategia sotto ruota attorno a *non* pagare macOS più spesso del
necessario.

**Altri vincoli / assunzioni:**
- Nessun budget dichiarato per code-signing (certificato Windows ~200–500 €/anno; Apple Developer
  99 $/anno). Le prime release saranno **non firmate** → warning SmartScreen (Win) e Gatekeeper (mac).
  Vedi §7.
- **Nessun modulo nativo**: `sql.js` e `hash-wasm` sono WASM. Non serve `node-gyp`/rebuild per arch,
  ma i `.wasm` vanno impacchettati correttamente (vedi §4).

---

## 2. Stato attuale

- Build dev/prod tramite **`electron-vite`** (`npm run build` → `apps/desktop/out/{main,preload,renderer}`).
  Questo produce i bundle JS, **non** un installer/eseguibile distribuibile.
- **Nessun tool di packaging** (niente electron-builder / electron-forge nel repo).
- **Nessun workflow CI** (`.github/` assente).
- **Nessuna build-resource**: mancano icone (`.ico`/`.icns`/`.png`), `appId`, metadati prodotto.
- `main` di `package.json` desktop → `./out/main/index.js` (coerente con electron-builder).
- Config vite tiene `sql.js`/`hash-wasm` **external** e emette due entry extra in `out/main`
  (`dbWorker`, `scriptHost`) spawnate a runtime → vanno inclusi nel pacchetto.

---

## 3. Scelta del tool di packaging: **electron-builder**

Raccomandazione: **electron-builder**. Motivi:
- Produce in un colpo i formati che ci servono: **NSIS** (Win installer) + opzionale portable/zip,
  **AppImage** (+`deb`/`rpm` opzionali) su Linux, **dmg**/**zip** su macOS.
- Integrazione nativa con **GitHub Releases** come publish target (`--publish`), e con
  **electron-updater** per l'auto-update (§8) — feed servito dagli asset della release.
- Nessuna dipendenza nativa da ricompilare → configurazione minima.

Alternativa: *electron-forge*. Ottimo, ma electron-builder ha il percorso "build+publish su GitHub +
auto-update" più battuto e meno codice di glue. Con lo stack attuale (electron-vite) l'accoppiata
**electron-vite (bundle) → electron-builder (package)** è quella standard.

### 3.1 Punti di attenzione col packaging (monorepo + WASM)

- **WASM external**: `sql-wasm.wasm` (sql.js) e i wasm di hash-wasm non vanno compressi dentro
  l'`asar` in modo che il runtime non li trovi. Servono in `files` + `asarUnpack` (es.
  `**/*.wasm`, `**/node_modules/sql.js/**`). Da verificare con un package reale + smoke test.
- **npm workspaces (hoisting)**: le dipendenze runtime (`sql.js`, `hash-wasm`, `seebo`, ecc.) sono
  spesso *hoisted* nel `node_modules` di root. electron-builder deve raccoglierle: build con
  `--project apps/desktop` e verificare che gli asset finali contengano quelle dipendenze. In caso di
  problemi di hoisting, opzioni: `nmHoistingLimits`, oppure un `postinstall`/`--include`, oppure
  installare le prod-deps nel package desktop.
- **Entry extra runtime**: `out/main/dbWorker.js` e `out/main/scriptHost.js` devono finire nel
  pacchetto (sono già in `out/main`, quindi coperti da `files: out/**`, ma va confermato che gli
  spawn a runtime risolvano i path dentro l'asar).
- **safeStorage su Linux**: `SafeStorageCipher` usa `electron.safeStorage`, che su Linux dipende dal
  keyring (libsecret/kwallet). Su ambienti headless o senza keyring il cipher cade su un backend
  "basic". Non blocca la build, ma è una nota per la QA della versione Linux.

---

## 4. Cosa aggiungere al repo (prerequisiti one-time)

Non serve nel workflow, ma è propedeutico:
1. `electron-builder` come devDependency (root o desktop) + config (`electron-builder.yml` o campo
   `build` in `apps/desktop/package.json`): `appId`, `productName`, `directories.output`, `files`,
   `asarUnpack`, target per OS, `publish: github`.
2. **Icone**: in `apps/desktop/buildResources/` — `icon.ico` (Win), `icon.icns` (mac), `icon.png`
   (Linux, ≥512px), generate dal sorgente `icon.svg` già presente lì. (NB: `build/` è gitignorato nel
   repo, quindi la resources-dir di electron-builder va impostata su `buildResources`.)
3. Uno **schema di versioning**: oggi `version` è `0.0.0`. Serve una fonte di verità (la `version` di
   `apps/desktop/package.json`) e un processo di bump (manuale o `npm version`). La versione della
   release deriva da lì.
4. Uno script npm `package`/`dist` (es. `electron-vite build && electron-builder`).

---

## 5. Strategia GitHub Actions economica

Principio guida: **separare "CI leggera frequente" da "release pesante rara"**, e non pagare mai
macOS a ogni commit.

### 5.1 Due workflow distinti

**A) CI (`ci.yml`) — frequente, solo Linux.**
- Trigger: `pull_request` verso `main` + `push` su `main`.
- Runner: **solo `ubuntu-latest`** (×1).
- Job: `npm ci` → `npm run typecheck` → `npm run lint` → `npm run test` (unit vitest, ~30s).
- **Escludere** dai run frequenti: e2e Playwright e le *heavy suites* (`SWAFT_RUN_HEAVY_TESTS=1`).
  Questi girano solo pre-release o on-demand (§5.3).
- `concurrency` con `cancel-in-progress: true` per non accumulare run su push rapidi.
- Cache di `~/.npm` (`actions/setup-node` con `cache: npm`).
- Costo tipico: ~3–5 min ×1 = **3–5 min/budget a run**.

**B) Release (`release.yml`) — raro, matrix 3 OS.**
- Trigger: **NON** ogni push su main (vedi §5.2). Preferibile **tag semver `v*`** o dispatch manuale.
- Pre-step (gate): un job Linux che rifà `typecheck+lint+test` (e qui *sì* si possono aggiungere le
  heavy suite / un subset e2e) → se fallisce, **niente build** (i job macOS/Win costosi non partono).
- Build matrix: `ubuntu-latest`, `windows-latest`, `macos-latest`, `fail-fast: false`.
- Ogni job: `npm ci` → `electron-vite build` → `electron-builder --publish always` (pubblica gli
  asset sulla GitHub Release del tag). In alternativa: build + upload artefatti + un job finale
  `softprops/action-gh-release` che allega tutto.
- `timeout-minutes` per OS come *safety cap* (soprattutto macOS, per non bruciare budget su un job
  bloccato).

### 5.2 Trigger della release — la scelta che pesa di più sul budget

La richiesta letterale è "release a ogni modifica di `main`". Tradotta 1:1 significherebbe pagare la
matrix 3-OS (macOS ×10 incluso) **a ogni commit** → insostenibile sul free tier. Opzioni, dalla più
economica:

1. **Tag semver (`v1.2.3`)** — *raccomandata*. Release solo quando decidi tu di rilasciare. Il flusso
   "modifico main" resta rapido (solo CI Linux); quando è ora di rilasciare fai `npm version` + push
   del tag. Massimo controllo sui minuti.
2. **Version-gated push su main** — trigger su push a main, ma il job release parte **solo se la
   `version` di `apps/desktop/package.json` è cambiata** rispetto al commit precedente (step di
   detection). Così onori "release quando cambio main (e bumpo la versione)" senza rilasciare a ogni
   fix di typo. Buon compromesso se vuoi evitare di gestire tag a mano.
3. **`workflow_dispatch`** — release manuale dal tab Actions. Zero automatismo, zero sprechi.
4. **Ogni push a main** — sconsigliata: possibile su budget, ma solo tagliando macOS o rendendolo
   opzionale (vedi §5.4). La riporto solo per completezza.

### 5.3 Quali test far girare (e dove)

- **A ogni PR/push (CI Linux)**: `typecheck` + `lint` + **unit** (`npm test`). Veloci, alto valore.
- **Pre-release (gate del release.yml, Linux)**: gli stessi + eventualmente le **heavy suite** e/o un
  **subset e2e** critico. Non tutti gli e2e — solo il "happy path" che convalida che il binario abbia
  senso rilasciarlo.
- **e2e completi**: on-demand (`workflow_dispatch`) o schedulati raramente (es. settimanale) —
  Playwright con Electron reale è lento e va tenuto fuori dal loop frequente.

### 5.4 Se macOS diventa troppo caro

Leve, in ordine:
- Buildare macOS **solo su tag** (mai su push), mentre Win/Linux possono girare più spesso.
- Rendere macOS **opzionale/manuale** (`workflow_dispatch` con input `include_macos`) finché non c'è
  domanda reale di utenti Mac.
- macOS **solo `arm64`** (o solo `x64`) invece di universal, per dimezzare il tempo del job.
- Ridurre la frequenza delle release (raggruppare più commit in una release).

---

## 6. Stima consumo mensile (ordine di grandezza)

Assunzioni prudenti per la matrix di release (build + package):

| Job (release)      | Tempo reale | Moltip. | Budget    |
| ------------------ | ----------- | ------- | --------- |
| Gate test (Linux)  | ~5 min      | ×1      | 5         |
| Build Linux        | ~5 min      | ×1      | 5         |
| Build Windows      | ~7 min      | ×2      | 14        |
| Build macOS        | ~8 min      | ×10     | **80**    |
| **Tot / release**  |             |         | **~104**  |

- **CI Linux** per push/PR: ~4 min ciascuno. 100 run/mese ≈ 400 min.
- **Release**: ~104 min l'una. Con **4 release/mese** ≈ 416 min.
- **Totale** ≈ 400 + 416 ≈ **~820 / 2000** min → ampio margine, *finché* le release non diventano
  troppo frequenti. Il termine che esplode è sempre macOS (80/release): 12 release/mese ≈ 960 min di
  solo macOS. Da qui la scelta tag-based + le leve §5.4.

(Numeri indicativi: da ricalibrare col primo run reale, ma l'ordine di grandezza regge.)

---

## 7. Firma e notarizzazione

- **Windows (NSIS non firmato)**: SmartScreen mostrerà "editore sconosciuto". Funziona, ma frizione
  per l'utente. Firma richiede un cert OV/EV (EV rimuove subito il warning; OV lo attenua nel tempo).
- **macOS (dmg non firmato/non notarizzato)**: Gatekeeper blocca l'app ("app danneggiata / editore non
  identificato"); l'utente deve fare *right-click → Open* o `xattr -dr com.apple.quarantine`. Serve
  Apple Developer (99 $/anno) + notarizzazione via `notarytool` per un'esperienza pulita.
- **Linux (AppImage)**: nessuna firma richiesta; esperienza già liscia.

**Raccomandazione**: partire **non firmati** su tutti e tre (documentare nelle release note come
aprire l'app su Win/mac), e introdurre la firma solo quando ci sono utenti reali che la giustificano.
electron-builder legge i certificati da secret/env (`CSC_LINK`/`CSC_KEY_PASSWORD` per Win/mac,
`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` per la notarizzazione) → si aggiungono dopo
senza cambiare l'impianto.

---

## 8. Auto-update (opzionale, fase 2)

- **electron-updater** con feed = GitHub Releases (`provider: github`). L'app controlla la release più
  recente e propone/scarica l'update.
- Costo: elettron-builder genera già i metadati (`latest.yml`/`latest-mac.yml`) se `publish: github`.
- Su repo **privato** l'updater deve autenticarsi per scaricare gli asset (token) → attrito. Se si
  vuole auto-update semplice, è un altro argomento a favore del repo pubblico, oppure release
  pubbliche staccate.
- Rimandabile: le prime versioni possono essere download manuale dalla pagina Releases.

---

## 9. Roadmap incrementale consigliata

1. **Packaging locale** — aggiungere electron-builder + config + icone; `npm run dist` che produce un
   installer funzionante sulla *tua* macchina. Smoke test: l'app parte, DB (sql.js/WASM) funziona,
   scriptHost/dbWorker spawnano. *(È il vero rischio tecnico: va validato prima di automatizzare.)*
2. **CI Linux** — `ci.yml`: typecheck + lint + unit su PR/push. Economico, valore immediato.
3. **Release matrix su tag** — `release.yml` con gate test (Linux) + build 3-OS su `v*`, publish su
   GitHub Releases (non firmato). Onora "release automatiche" senza bruciare budget.
4. *(Opz.)* version-gated push su main se preferisci non gestire tag a mano (§5.2 opz. 2).
5. *(Opz. fase 2)* firma/notarizzazione quando servono; poi auto-update.

---

## 10. Domande aperte / decisioni da prendere

- **Trigger**: tag semver (consigliato) vs version-gated push vs manuale? → determina §5.2.
- **Repo pubblico o privato?** Impatta enormemente budget minuti e auto-update.
- **macOS**: universal o singola arch? Incluso da subito o on-demand?
- **Formati**: bastano NSIS + AppImage + dmg, o servono anche portable/zip/deb/rpm?
- **Firma**: si accetta il warning iniziale (non firmato) o si investe subito nei certificati?
- **e2e in pre-release**: quale subset minimo considerare "bloccante" per una release?
