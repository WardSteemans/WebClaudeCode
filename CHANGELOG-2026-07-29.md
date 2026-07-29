# Changelog — 2026-07-29

> Branch: `feature/attachments-stream-reliability-logging`
> Base: `master` (na PR #4 — stream-json refactoring)
> 14 files changed, ~393 insertions, ~80 deletions

---

## 1. 📎 File attachments in chat input (nieuwe feature)

**Wat**: Gebruikers kunnen nu tekst/code-bestanden meesturen met hun prompts, naast de bestaande image paste functionaliteit.

**Hoe**:
- `PromptInput.tsx` kreeg een 📎-knop die een hidden `<input type="file">` opent, met accept voor ~40 tekst/code extensies (`.txt`, `.log`, `.json`, `.md`, `.js`, `.ts`, `.py`, `.sql`, etc.)
- Bestanden worden via `FileReader` lokaal ingelezen (max 1 MB per bestand)
- Geselecteerde bestanden verschijnen als verwijderbare pill-badges naast eventuele image previews, met bestandsnaam en grootte
- De image/file preview area is omgezet van `absolute` naar inline `flex` layout zodat alles netjes naast elkaar staat
- `FileAttachment` interface toegevoegd aan zowel `packages/shared/src/chat.ts` als `packages/frontend/src/lib/chat/types.ts` (id, text, fileName, mimeType, size)
- `ChatMessage.files` optioneel veld toegevoegd voor opslag in chat history
- Bij verzenden worden file contents inline in de prompt geplakt als `--- fileName ---\n...content...\n--- end fileName ---` blokken
- In de chat bubble verschijnt `[N files attached]` (of `[N images + M files attached]` bij combinatie)

**Files**:
- `packages/shared/src/chat.ts` — `FileAttachment` interface + `files` op `ChatMessage`
- `packages/frontend/src/lib/chat/types.ts` — zelfde types aan frontend-kant
- `packages/frontend/src/components/chat/PromptInput.tsx` — file picker UI, pill badges, `resetKey` prop, `memo` wrap
- `packages/frontend/src/components/chat/ChatPanel.tsx` — `FilePreviewBlock` component (toont bestandsinhoud inline, collapse na 20 regels)
- `packages/frontend/src/hooks/useChatStream.ts` — `filesRef`, files in prompt verwerken, `files` op user message

---

## 2. 📂 File preview in chat messages (nieuwe feature)

**Wat**: Meegestuurde bestanden worden inline getoond in de chat als opvouwbare code blocks.

**Hoe**:
- `FilePreviewBlock` component in `ChatPanel.tsx`:
  - Header met 📄 icoon, bestandsnaam, en regel-telling
  - Syntax-highlighted preview in `<pre>` met max-height 300px + scroll
  - Bestanden >20 regels worden gecollapsed getoond met "Show all N lines" toggle
  - Styling consistent met de rest van de chat UI (slate kleuren, dark mode support)
- Messages met `msg.files` renderen één `FilePreviewBlock` per bestand

**Files**:
- `packages/frontend/src/components/chat/ChatPanel.tsx`

---

## 3. ⚡ Session history cache — instant restore bij chat switch (performance)

**Wat**: Wanneer je tussen chats wisselt, wordt de history van een eerder geladen sessie direct uit het geheugen hersteld — zonder netwerkrequest.

**Hoe**:
- De oude `historyAttempted` Set (FIFO, 200 entries, alleen een "al geprobeerd"-vlag) is vervangen door `historyCache` Map (LRU, 50 entries)
- De cache slaat de volledige messages array én thinking blocks map op
- Bij mount: eerst cache checken → bij hit: `setMessages` + `setThinkingBlocks` direct aanroepen, geen fetch
- Alleen succesvolle loads worden gecached; failures retryen bij volgende mount
- HTTP error check (`r.ok`) toegevoegd vóór `.json()` parsen
- LRU eviction: oudste entry wordt verwijderd bij 50 entries
- Uitgebreide console logging: `CACHE HIT`, `FETCH`, `LOADED`, `EMPTY`, `FAILED`

**Files**:
- `packages/frontend/src/hooks/useChatStream.ts`

---

## 4. 🩹 Stream timeout fix — geen false cuts meer tijdens lange tool/thinking fasen (bugfix)

**Wat**: De 120-seconden stream timer kon voorheen aflopen tijdens lange Claude Code thinking- of tool-execution fasen, waardoor responses halverwege werden afgekapt.

**Root cause**: `resetStreamTimer()` werd alleen aangeroepen bij `chat.assistant` text events. Tijdens een lange tool call (bv. `Bash` die 90s duurt) arriveerden er geen text events → timer liep af → response werd gecancelled.

**Fix**: `resetStreamTimer()` staat nu bovenaan `handleEvent()` en wordt bij **elk** event aangeroepen — ook thinking blocks, tool results, subagent updates, etc. Zolang er events binnenkomen (van welk type dan ook), blijft de timer gereset.

**Files**:
- `packages/frontend/src/hooks/useChatStream.ts`

---

## 5. 🪵 Logging directory structuur — van platte map naar subdirectories (backend)

**Wat**: Log bestanden worden nu georganiseerd in een directory-structuur in plaats van alles in `logging/` te dumpen.

**Nieuwe structuur**:
```
logging/
├── main/            ← cc-gui-YYYY-MM-DD.log (hoofdlog)
├── stream/          ← cc-gui-stream-YYYY-MM-DD.log (stream events)
├── pty/             ← pty debug output
├── title/           ← title-gen-YYYY-MM-DD.log (titel generatie)
└── diagnostics/     ← cut-debug-YYYY-MM-DD.log (stream afkapping debugging)
```

**Hoe**:
- `logger.ts`: `ensureLogDir` accepteert nu optionele `subDir` parameter; `MAIN_LOG_DIR` wijst naar `logging/main/`
- `writeDedicatedEntry` ondersteunt hiërarchische namen met `/` als separator: `"title/title-gen"` → `logging/title/title-gen-*.log`
- `stream-log.ts`: stream logs naar `logging/stream/` via `STREAM_LOG_DIR`
- `ptty-session-manager.ts`: PTY debug output naar `logging/pty/`
- `chats.ts`: logger naam van `'title-gen'` naar `'title/title-gen'`
- `log.ts`: routing van frontend logs naar `title/title-gen` en `diagnostics/cut-debug` dedicated logs

**Files**:
- `packages/backend/src/logger.ts`
- `packages/backend/src/routes/stream-log.ts`
- `packages/backend/src/routes/chats.ts`
- `packages/backend/src/routes/log.ts`
- `packages/backend/src/services/ptty-session-manager.ts`

---

## 6. 🩺 Stream diagnostics logging — cut-response debugging (observability)

**Wat**: Uitgebreide logging om te kunnen debuggen waarom Claude responses soms worden afgekapt.

**Hoe**:
- **Frontend** (`useChatStream.ts`):
  - Console logs op mount/unmount van ChatPanel, WS open/close, session ready, send events
  - `finalizeStream` logt state op finalisatie-moment: hadActiveMsg, contentLen, msgCount, thinkCount, timerActive
  - `stream timer fired` logt of er content en messages waren op timeout-moment
  - WS messages voor andere chats worden gelogd bij assistant/completed/error events (niet bij elk event — noise-reductie)
  - History load pad: CACHE HIT / FETCH / LOADED / EMPTY / FAILED
- **Frontend** (`App.tsx`, `ChatList.tsx`, `store.ts`):
  - URL restore en URL→store sync events
  - Chat click events met vorige/nieuwe activeChatId
  - Auto-import completion met chat count
- **Backend** (`log.ts`):
  - `finalizeStream` en `stream timer fired` events van de frontend worden doorgestuurd naar `diagnostics/cut-debug` dedicated log
- **Backend** (`session-manager.ts`):
  - Process exit logt nu de eerste 200 karakters van eventuele onverwerkte stdout buffer + totale buffer lengte
  - De `processLine()` call is verplaatst naar ná de log, zodat de buffer inhoud bewaard blijft voor de log entry

**Files**:
- `packages/frontend/src/hooks/useChatStream.ts`
- `packages/frontend/src/App.tsx`
- `packages/frontend/src/components/chat/ChatList.tsx`
- `packages/frontend/src/store.ts`
- `packages/backend/src/routes/log.ts`
- `packages/backend/src/services/session-manager.ts`

---

## 7. 🔧 Auto-import steelt geen focus meer (UX fix)

**Wat**: Bij het laden van de app worden bestaande Claude Code sessies automatisch geïmporteerd als chats. Voorheen werd de laatst geïmporteerde chat meteen actief — ook als de gebruiker al een andere chat open had. Nu niet meer.

**Hoe**:
- `store.ts`: `addChat` kreeg een `setActive` optie (default `true`)
- `ChatList.tsx`: auto-import gebruikt `setActive: false` → de actieve chat blijft onaangeroerd
- `setActiveChat` heeft nu console logging zodat zichtbaar is welke chat actief wordt

**Files**:
- `packages/frontend/src/store.ts`
- `packages/frontend/src/components/chat/ChatList.tsx`

---

## 8. ⚛️ Render optimalisatie — soepeler typen tijdens streaming (performance)

**Wat**: Tijdens actieve streaming kon het typen in de prompt input haperen omdat React de message list aan het re-renderen was.

**Hoe**:
- `PromptInput` is gewrapped in `React.memo` om onnodige re-renders te voorkomen
- `ChatPanel` gebruikt `useDeferredValue(messages)` → de message list render wordt een lagere prioriteit gegeven, zodat user input (typen) altijd voorrang krijgt

**Files**:
- `packages/frontend/src/components/chat/PromptInput.tsx`
- `packages/frontend/src/components/chat/ChatPanel.tsx`

---

## 9. 🧹 Opruiming — image preview layout fix

**Wat**: De image preview thumbnails waren `absolute` gepositioneerd, wat problematisch werd met de toevoeging van file attachments.

**Hoe**: Image previews zijn verplaatst naar een inline flex container (`flex gap-2 flex-wrap`), consistent met file attachment badges.

**Files**:
- `packages/frontend/src/components/chat/PromptInput.tsx`
