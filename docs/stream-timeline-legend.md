# Stream Timeline Log — Legend

Bestand: `logs/cc-gui-stream-YYYY-MM-DD.log` (NDJSON: één JSON-regel per entry)

---

## Activeren

| Component | Hoe |
|---|---|
| Backend | `STREAM_DEBUG=true` in `.env` |
| Frontend | `?stream_debug=1` in de URL, of `window.__STREAM_DEBUG__ = true` in de console |

---

## Algemene velden (elke entry)

| Veld | Type | Betekenis |
|---|---|---|
| `s` | number | Monotoon sequentienummer binnen deze timeline |
| `ts` | string | ISO 8601 timestamp met ms (bv. `2026-07-28T14:30:01.234Z`) |
| `d` | number | Delta in ms sinds vorige entry (eerste = 0) |
| `p` | string | Pipelinefase: `b_send` / `f_recv` / `f_proc` |
| `sid` | string | Session ID |
| `cid` | string | Chat ID |
| `ev` | string | Event type (bv. `chat.thinking`, `tool.started`, `chat.assistant`) |
| `eid` | string | Event ID (UUID uit `BaseEvent`) |
| `aid` | string | Subagent ID (alleen bij subagent events) |

## Content-specifieke velden

| Veld | Type | Wanneer aanwezig | Betekenis |
|---|---|---|---|
| `len` | number | `chat.thinking`, `chat.assistant` | Lengte van de content string |
| `pre` | string | `chat.thinking`, `chat.assistant` | Eerste 80 karakters van de content |
| `par` | boolean | `chat.thinking`, `chat.assistant` | Was dit een partial (streaming) event? |
| `tln` | string | `tool.*` events | Tool name (bv. `Read`, `Write`, `Bash`) |

## Frontend processing velden (alleen `p = "f_proc"`)

| Veld | Type | Betekenis |
|---|---|---|
| `act` | string | Wat de handler deed (zie acties-tabel hieronder) |
| `mid` | string\|null | Target message ID (waar tekst aan geplakt werd/wordt) |
| `bid` | string\|null | Target thinking block ID |
| `sgid` | string\|null | Target segment ID binnen een thinking block |
| `mrf` | string\|null | Waarde van `streamMsgIdRef` **ná** de actie |
| `trf` | string\|null | Waarde van `currentThinkingIdRef` **ná** de actie |
| `mc` | number | Aantal messages in de array ná de actie |
| `bc` | number | Aantal thinking blocks ná de actie |

---

## Acties (`act`)

| `act` waarde | Event type(s) | Wat er gebeurde |
|---|---|---|
| `new_message` | `chat.assistant` | Eerste text delta → nieuwe assistant message aangemaakt, `mrf` gezet |
| `append_message` | `chat.assistant` | Volgende text delta → tekst geplakt aan bestaande message |
| `new_block` | `chat.thinking` | Eerste thinking delta → nieuw thinking block + placeholder message + segment aangemaakt, `trf` gezet |
| `append_segment` | `chat.thinking` | Thinking delta → tekst geplakt aan laatste thinking segment in huidig block |
| `new_segment` | `chat.thinking` | Thinking delta na een tool/files segment → nieuw thinking segment in huidig block |
| `tool_started` | `tool.started` | Tool segment (status=running) toegevoegd aan huidig thinking block |
| `tool_completed` | `tool.completed` | Tool segment gemarkeerd als done/error + collapse logic + files segment |
| `file_event` | `file.read`, `file.changed` | Files segment toegevoegd/geüpdatet in huidig thinking block |
| `compacted` | `session.compacted` | Session gecompacteerd → finalizeStream + system message |
| `waiting` | `session.waiting` | Stream finalized (Claude wacht op volgende prompt) |
| `completed` | `session.completed` | Stream finalized + exit code check |
| `aborted` | `session.aborted` | Stream finalized + "Generation aborted." message |
| `error` | `chat.error`, `session.error` | Stream finalized + error message |
| `finalize_stream` | (synthetisch) | `finalizeStream()` aangeroepen — legt ref-waarden vast vóórdat ze ge-nullt worden |

---

## Pipelinefases (`p`)

```
┌──────────┐    ws.send()     ┌───────────┐    handleEvent()   ┌───────────────┐
│ Backend  │ ──────────────── │ Frontend  │ ────────────────── │ Frontend      │
│ handler  │                  │ WS recv   │                    │ state update  │
└──────────┘                  └───────────┘                    └───────────────┘
     │                             │                                  │
     ▼                             ▼                                  ▼
  b_send                       f_recv                             f_proc
  (_sentAt timestamp           (timestamp bij                     (act + mrf/trf
   in WS envelope)              JSON.parse)                        na state change)
```

---

## Voorbeeld: een volledige turn

```json
{"s":1,"ts":"...","d":0,"p":"b_send","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e1","len":45,"pre":"Let me think about this...","par":true}
{"s":2,"ts":"...","d":4,"p":"f_recv","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e1","len":45}
{"s":3,"ts":"...","d":2,"p":"f_proc","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e1","act":"new_block","bid":"b1","sgid":"s1","trf":"b1","mc":4,"bc":1}
{"s":4,"ts":"...","d":70,"p":"b_send","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e2","len":32,"pre":"I need to check the file first","par":true}
{"s":5,"ts":"...","d":2,"p":"f_recv","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e2","len":32}
{"s":6,"ts":"...","d":1,"p":"f_proc","sid":"a1b2","cid":"default","ev":"chat.thinking","eid":"e2","act":"append_segment","bid":"b1","trf":"b1"}
{"s":7,"ts":"...","d":577,"p":"b_send","sid":"a1b2","cid":"default","ev":"tool.started","eid":"e3","tln":"Read"}
{"s":8,"ts":"...","d":2,"p":"f_recv","sid":"a1b2","cid":"default","ev":"tool.started","eid":"e3","tln":"Read"}
{"s":9,"ts":"...","d":2,"p":"f_proc","sid":"a1b2","cid":"default","ev":"tool.started","eid":"e3","act":"tool_started","bid":"b1","sgid":"t1","trf":"b1"}
{"s":10,"ts":"...","d":555,"p":"b_send","sid":"a1b2","cid":"default","ev":"tool.completed","eid":"e4","tln":"Read"}
{"s":11,"ts":"...","d":2,"p":"f_recv","sid":"a1b2","cid":"default","ev":"tool.completed","eid":"e4","tln":"Read"}
{"s":12,"ts":"...","d":3,"p":"f_proc","sid":"a1b2","cid":"default","ev":"tool.completed","eid":"e4","act":"tool_completed","bid":"b1","trf":"b1"}
{"s":13,"ts":"...","d":55,"p":"b_send","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e5","len":12,"pre":"Here is the ","par":true}
{"s":14,"ts":"...","d":2,"p":"f_recv","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e5","len":12}
{"s":15,"ts":"...","d":1,"p":"f_proc","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e5","act":"new_message","mid":"m1","mrf":"m1","trf":"b1"}
{"s":16,"ts":"...","d":67,"p":"b_send","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e6","len":8,"pre":"content.","par":true}
{"s":17,"ts":"...","d":1,"p":"f_recv","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e6","len":8}
{"s":18,"ts":"...","d":1,"p":"f_proc","sid":"a1b2","cid":"default","ev":"chat.assistant","eid":"e6","act":"append_message","mid":"m1","mrf":"m1","trf":"b1"}
{"s":19,"ts":"...","d":518,"p":"b_send","sid":"a1b2","cid":"default","ev":"session.waiting","eid":"e7"}
{"s":20,"ts":"...","d":2,"p":"f_proc","sid":"a1b2","cid":"default","ev":"session.waiting","eid":"e7","act":"waiting","mrf":null,"trf":null}
```

---

## Hoe analyseer je het logbestand

### Met `jq`

```bash
# Alle frontend:proc entries
cat logs/cc-gui-stream-2026-07-28.log | jq 'select(.p == "f_proc")'

# Alleen de acties en ref-waarden
cat logs/cc-gui-stream-2026-07-28.log | jq 'select(.p == "f_proc") | {s, ev, act, mrf, trf}'

# Vind waar mrf wijst naar een oud message ID (mogelijk ref-lek)
cat logs/cc-gui-stream-2026-07-28.log | jq 'select(.act == "new_message") | {s, mrf, mid}'

# Alle tool started/completed met delta tijden
cat logs/cc-gui-stream-2026-07-28.log | jq 'select(.tln != null) | {s, p, ev, tln, d}'
```

### Met Python

```python
import json

with open('logs/cc-gui-stream-2026-07-28.log') as f:
    entries = [json.loads(line) for line in f if line.strip()]

# Timeline overzicht
for e in entries:
    if e['p'] == 'f_proc':
        print(f"seq={e['s']:3d}  {e['ev']:20s}  act={e.get('act','?'):16s}  mrf={str(e.get('mrf','')):10s}  trf={str(e.get('trf','')):10s}")

# Vind transities waar mrf zou moeten null zijn maar dat niet is
for e in entries:
    if e.get('act') == 'finalize_stream' and e.get('mrf') is not None:
        print(f"WAARSCHUWING: finalize_stream maar mrf={e['mrf']} (seq={e['s']})")
```
