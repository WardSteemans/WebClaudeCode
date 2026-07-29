# Logging in cc-gui — Gebruikersdocumentatie

## Overzicht

cc-gui heeft een **gestructureerd log systeem** dat zowel frontend als backend logs centraal verzamelt in leesbare tekstbestanden. Alle logs belanden in de map `logging/` in de workspace root.

Het systeem gebruikt **vier niveaus**: `DEBUG`, `INFO`, `WARN`, `ERROR`, en elke logregel is getagd met een `[module]`-label zodat je eenvoudig kunt filteren op component.

---

## Bestanden

| Bestand | Inhoud |
|---|---|
| `logging/cc-gui-YYYY-MM-DD.log` | **Hoofdlog** — alle logs van backend én frontend. Eén bestand per dag. |
| `logging/title-gen-YYYY-MM-DD.log` | **Titelgeneratie-log** — uitsluitend logs over het automatisch genereren van gesprekstitels. Geen streaming-ruis. |
| `logging/cc-gui-stream-YYYY-MM-DD.log` | **Stream timeline** — alleen actief als `STREAM_DEBUG=true` in environment. Bevat low-level event-timing data. |

Voorbeeld na een paar dagen gebruik:
```
logging/
├── cc-gui-2026-07-28.log
├── cc-gui-2026-07-29.log
├── title-gen-2026-07-28.log
└── title-gen-2026-07-29.log
```

Bestanden roteren automatisch om middernacht. Oude bestanden worden nooit automatisch verwijderd — opschonen is handmatig.

---

## Logformaat

Elke regel in het hoofdlog en de dedicated logs heeft dit formaat:

```
[TIMESTAMP] [LEVEL] [module] bericht {"key":"value"}
```

Voorbeelden:

```
[2026-07-28 14:30:01.123] [DEBUG] [chats] generate-title: calling AI API {"baseUrl":"https://api.anthropic.com","model":"claude-3-5-haiku-20241022","msgCount":4}
[2026-07-28 14:30:02.456] [INFO]  [chats] generate-title: success {"title":"Database schema review"}
[2026-07-28 14:30:03.789] [INFO]  [fe:useChatStream] generateChatTitle: title set {"title":"Database schema review"}
[2026-07-28 14:31:00.001] [DEBUG] [ws] client connected
[2026-07-28 14:31:05.500] [WARN]  [session] stderr output {"line":"Warning: deprecated flag used"}
[2026-07-28 14:35:00.000] [ERROR] [api-router] upstream error {"statusCode":502,"message":"Bad Gateway"}
```

- **Timestamp**: `YYYY-MM-DD HH:MM:SS.mmm`
- **Level**: `DEBUG` | `INFO` | `WARN` | `ERROR`
- **Module**: herkomst van de log (zie module-overzicht hieronder)
- **Bericht**: vrije tekst
- **Data**: optionele JSON met context (keys/waarden, geen secrets)

Frontend logs hebben prefix `fe:` voor de module-naam (bv. `fe:useChatStream`).

---

## Logniveaus

| Niveau | Betekenis | Wanneer gebruikt |
|---|---|---|
| `DEBUG` | Gedetailleerde diagnostiek | Alleen relevant bij het debuggen van een specifiek probleem |
| `INFO` | Normale operatie | Bevestiging dat iets gelukt is, startup meldingen |
| `WARN` | Iets werkte niet, maar geen crash | Fallback gebruikt, API call faalde maar we gaan door, timeout |
| `ERROR` | Fout die impact heeft | Crash, dataverlies, onherstelbare fout |

Alleen `ERROR` wordt **direct** naar schijf geschreven (niet gebufferd). Andere niveaus worden elke seconde of bij 50 regels gebufferd weggeschreven.

---

## Modules

Elke component in cc-gui logt onder een eigen module-naam. Dit zijn de belangrijkste:

### Backend modules

| Module | Wat het logt |
|---|---|
| `server` | Opstarten, HTTP requests (methode + path), poort-binding |
| `ws` | WebSocket: connecties, disconnects, heartbeats, subagent starts, foutieve JSON |
| `session` | Claude Code proces: spawnen, stdout/stderr, prompts versturen, exits |
| `api-router` | API routing: missende keys, vision API calls, TLS waarschuwingen, upstream errors |
| `chats` | **Titelgeneratie**: API call start, model/URL, success/fallback, errors, timeouts |
| `eventParser` | Stream event parsing: onbekende events, parse fouten |
| `eventParser:state` | Parser state reset |
| `eventParser:system` | System events (API errors van Claude) |
| `db` | Database: laden, aanmaken, schema initialisatie |
| `sessions` | Sessiebestanden: lijsten, lezen, niet-gevonden waarschuwingen |
| `git` | Git commands (performance marks) |
| `azure-devops` | Azure DevOps connectie: begin/eind/falen |
| `pricing` | Token pricing: cache hits, API calls, achtergrondverversing |
| `stream-log` | Stream timeline: hoeveel entries weggeschreven |

### Frontend modules (altijd met `fe:` prefix in de backend logs)

| Module | Wat het logt |
|---|---|
| `fe:useChatStream` | Chat flow: sessie laden, **titelgeneratie** (start, succes, fouten, settings-check, threshold) |
| `fe:ws` | WebSocket client: connectiepogingen, reconnect, fouten, disconnect |
| `fe:ErrorBoundary` | React render fouten met component stack trace |

---

## Logs bekijken

### Real-time volgen

```bash
# Alles live volgen
tail -f logging/cc-gui-$(date +%Y-%m-%d).log

# Alleen errors en warnings
tail -f logging/cc-gui-$(date +%Y-%m-%d).log | grep -E "\[WARN\]|\[ERROR\]"
```

### Filteren op module

```bash
# Alleen WebSocket logs
grep "\[ws\]" logging/cc-gui-*.log

# Alleen API router logs
grep "\[api-router\]" logging/cc-gui-*.log

# Alleen frontend logs
grep "\[fe:" logging/cc-gui-*.log
```

### Filteren op niveau

```bash
# Alle errors van vandaag
grep "\[ERROR\]" logging/cc-gui-$(date +%Y-%m-%d).log

# Alle warnings van de laatste 3 dagen
grep "\[WARN\]" logging/cc-gui-2026-07-2*.log
```

### Combineren

```bash
# Errors in de session manager
grep "\[session\]" logging/cc-gui-*.log | grep "\[ERROR\]"

# Claude Code stderr output
grep "\[session\].*stderr" logging/cc-gui-*.log
```

---

## Titelgeneratie logs

Omdat deze logs vaak naar een AI gestuurd worden voor diagnose, schrijven ze naar een **apart bestand** zonder ruis van streaming, WebSocket, of andere componenten.

### Wat staat erin?

Het bestand `logging/title-gen-YYYY-MM-DD.log` bevat ALLEEN:

**Van de backend (`chats`):**
- Of er een API key beschikbaar is
- Naar welke base URL en met welk model de AI API wordt aangeroepen
- Succes of falen van de API call (non-200 status, netwerkfout, timeout, parse error)
- Gegenereerde of fallback titel

**Van de frontend (`useChatStream`):**
- Start van titelgeneratie (met model, hasKey, baseUrl, msgCount)
- Succes: welke titel is gezet
- Fouten: missende titel in response, non-ok HTTP status, fetch exceptions
- Guard checks: is auto-titel uitgeschakeld? is de threshold bereikt?

### Wanneer wordt titelgeneratie getriggerd?

De frontend controleert na elke assistent-response (wanneer streaming stopt) of:

1. `autoTitleEnabled` aan staat (standaard: **aan**)
2. `autoTitleTiers` minstens één tier bevat (standaard: `[{upTo:20, every:5}, {upTo:200, every:25}]`)
3. Er minstens 2 betekenisvolle berichten zijn (user + assistant)
4. Het aantal berichten de volgende tier-grens overschrijdt

Pas als alle vier checks slagen, wordt `/api/chats/generate-title` aangeroepen.

Standaard wordt de titel dus **voor het eerst** gegenereerd zodra de eerste assistent-response binnen is (2 berichten). Daarna elke 5 berichten tot 20, en vervolgens elke 25 berichten.

### Voorbeeld titelgeneratie logs

Een succesvolle flow:
```
[2026-07-28 14:30:01.100] [DEBUG] [fe:useChatStream] generateChatTitle: threshold reached {"meaningfulCount":2,"isFirstGen":true,"currentInterval":5,"lastGen":0}
[2026-07-28 14:30:01.120] [DEBUG] [fe:useChatStream] generateChatTitle: starting {"model":"claude-3-5-haiku-20241022","hasKey":true,"baseUrl":"https://api.deepseek.com/anthropic","msgCount":2}
[2026-07-28 14:30:01.123] [DEBUG] [chats] generate-title: calling AI API {"baseUrl":"https://api.deepseek.com/anthropic","model":"claude-3-5-haiku-20241022","msgCount":2}
[2026-07-28 14:30:02.456] [INFO]  [chats] generate-title: success {"title":"Python refactoring vraag"}
[2026-07-28 14:30:02.789] [INFO]  [fe:useChatStream] generateChatTitle: title set {"title":"Python refactoring vraag"}
```

Een flow zonder API key (fallback):
```
[2026-07-28 15:00:01.100] [DEBUG] [fe:useChatStream] generateChatTitle: threshold reached {"meaningfulCount":2,...}
[2026-07-28 15:00:01.120] [DEBUG] [fe:useChatStream] generateChatTitle: starting {"model":null,"hasKey":false,"baseUrl":null,"msgCount":2}
[2026-07-28 15:00:01.123] [INFO]  [chats] generate-title: no ANTHROPIC_API_KEY in env, using fallback
[2026-07-28 15:00:01.200] [INFO]  [fe:useChatStream] generateChatTitle: title set {"title":"Kun je me helpen met..."}
```

Een netwerkfout:
```
[2026-07-28 16:00:01.123] [DEBUG] [chats] generate-title: calling AI API {"baseUrl":"https://api.anthropic.com","model":"claude-3-5-haiku-20241022","msgCount":2}
[2026-07-28 16:00:06.456] [WARN]  [chats] generate-title: AI API request error, using fallback {"message":"ENOTFOUND api.anthropic.com"}
[2026-07-28 16:00:06.500] [WARN]  [fe:useChatStream] generateChatTitle: fetch failed {"message":"NetworkError"}
```

---

## Automatische titels instellen

In de Settings dialog (⚙️ knop rechtsboven):

| Instelling | Standaard | Wat het doet |
|---|---|---|
| **Auto-generate titles** | Aan | Zet titelgeneratie aan/uit. Alleen zichtbaar in logs als `autoTitleEnabled`. |
| **Regeneration tiers** | `0–20: elke 5`, `20–200: elke 25` | Bepaalt hoe vaak de titel ververst wordt naarmate het gesprek langer wordt. |

Tiers worden bewaard in de database (`/api/settings`) als `autoTitleEnabled` (boolean) en `autoTitleTiers` (JSON array).

---

## Naar een AI sturen

Als je logging naar een AI wilt sturen voor diagnose, stuur dan bij voorkeur alleen het relevante dedicated log:

```bash
# Titelgeneratie problemen: stuur alleen dit bestand
cat logging/title-gen-$(date +%Y-%m-%d).log

# Algemene problemen: filter op module + niveau
grep -E "\[ERROR\]|\[WARN\]" logging/cc-gui-$(date +%Y-%m-%d).log
```

De dedicated logs bevatten **geen** gevoelige data zoals API keys — die worden nooit gelogd.

---

## Configuratie

Er zijn twee omgevingsvariabelen die logging beïnvloeden:

| Variabele | Standaard | Effect |
|---|---|---|
| `STREAM_DEBUG` | `false` | Zet `true` om low-level stream timeline logging te activeren in `logging/cc-gui-stream-YYYY-MM-DD.log`. Nuttig voor debuggen van streaming events. |

Alle andere logniveaus zijn hardcoded en kunnen niet via configuratie worden aangepast.

---

## Buffer en flush gedrag

Het logsysteem buffert logregels in het geheugen voor performance:

| Trigger | Actie |
|---|---|
| `ERROR` niveau log | Direct flushen (buffer + dedicated) |
| Buffer ≥ 50 regels | Flushen |
| Elke 1000ms (timer) | Flushen indien nodig |
| Middernacht | Roteren: oud bestand sluiten, nieuw bestand openen |
| `SIGINT` / `SIGTERM` | Alles flushen en veilig afsluiten |
| `uncaughtException` | ERROR loggen, flushen, exit 1 |
| `unhandledRejection` | ERROR loggen, flushen |

Dedicated logs (zoals `title-gen`) gebruiken `fs.appendFileSync` bij elke schrijfactie — die worden niet gebufferd omdat het volume laag is.

---

## Opschonen

Logs worden nooit automatisch verwijderd. Handmatig opschonen:

```bash
# Verwijder logs ouder dan 7 dagen
find logging/ -name "*.log" -mtime +7 -delete

# Of alles wissen
rm logging/*.log
```

---

## Technische details

Voor ontwikkelaars die aan het logsysteem willen werken:

- **Backend logger**: `packages/backend/src/logger.ts` — `createLogger(module, dedicatedLog?)` returned een `Logger` met `debug/info/warn/error/begin/end/fail/mark`. Gebruikt `fs.WriteStream` met buffering. Bepaalt het `logging/` pad door vanaf de bestandslocatie omhoog te lopen tot de workspace root (de map met `package.json` die `"workspaces"` bevat).
- **Frontend logger**: `packages/frontend/src/logger.ts` — `createFrontendLogger(module)` returned een `FrontendLogger`. Stuurt elke log als fire-and-forget HTTP POST naar `/api/log`.
- **Log route**: `packages/backend/src/routes/log.ts` — ontvangt frontend logs, her-logt ze in de backend stream met module prefix `fe:`, en forwardt title-gen logs naar dedicated file.
- **Dedicated logs**: `writeDedicatedEntry(name, entry)` en `appendToDedicatedLog(...)` in `logger.ts` schrijven naar `logging/<name>-YYYY-MM-DD.log`. Geëxporteerd zodat ook `log.ts` ze kan gebruiken.
- **Shared types**: `packages/shared/src/types.ts` definieert `LogLevel`; `packages/shared/src/logger.ts` definieert `BaseLogger` interface.
