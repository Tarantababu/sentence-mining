# Architecture: Sentence Mining

Personalized error-driven language and memory engine. Learners paste a speaking-session log; the backend maps surface mistakes to canonical units, updates a deterministic forgetting curve, and returns a small i+1 study pack (practice cards + next-session speaking prompts).

This document is the implementation contract for `backend/` and `frontend/`. The GitHub repository is `Tarantababu/sentence-mining` (fallback name `language-memory-engine`).

## System overview

```
┌─────────────┐     POST /api/sessions/ingest      ┌──────────────────┐
│  React UI   │ ─────────────────────────────────► │  FastAPI         │
│  Vite + TS  │ ◄───────────────────────────────── │  routers         │
│  Tailwind   │     study pack / units / health    └────────┬─────────┘
└─────────────┘                                             │
                      ┌─────────────────────────────────────┼────────────────┐
                      │                                     ▼                │
                      │  parser Φ  →  unit catalog  →  memory engine         │
                      │                                     │                │
                      │                          material_generator          │
                      │                          (OpenAI + template fallback)│
                      │                                     │                │
                      │                          SQLAlchemy / Alembic        │
                      │                          SQLite now, Postgres-ready  │
                      └──────────────────────────────────────────────────────┘
```

OpenAI is optional enrichment only. Parser baseline, `S_k` / `p_k`, urgency, and budget/diversity selection are pure Python and pytest-covered. A missing, rate-limited, or failing API key never crashes the app.

## Repository structure

```
sentence-mining/
├── .env.example
├── .gitignore
├── README.md
├── scripts/
│   ├── run-local.sh          # SQLite, reload, optional seed
│   └── run-prod.sh           # gunicorn/uvicorn workers, Postgres-capable DATABASE_URL
├── backend/
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/         # initial schema migration
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py           # FastAPI app, CORS, lifespan (seed)
│   │   ├── config.py         # pydantic-settings from env
│   │   ├── db.py             # engine, session, Base
│   │   ├── models/           # SQLAlchemy tables
│   │   ├── schemas/          # Pydantic request/response + OpenAI payloads
│   │   ├── routers/
│   │   │   ├── health.py
│   │   │   ├── sessions.py
│   │   │   ├── study_pack.py
│   │   │   ├── reviews.py
│   │   │   └── units.py
│   │   └── services/
│   │       ├── parser.py
│   │       ├── unit_catalog.py
│   │       ├── memory_engine.py
│   │       ├── material_generator.py
│   │       ├── openai_client.py
│   │       └── seed.py
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── test_parser.py
│   │   ├── test_memory_engine.py
│   │   ├── test_selection.py
│   │   ├── test_reviews.py
│   │   └── test_api.py
│   └── requirements.txt
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css
        ├── api.ts
        └── components/       # player, ingest, unit inspector (iterated after backend)
```

Python 3.11+ for the API. Node 20+ for the Vite app. The first PR lands a working backend plus a real frontend scaffold; a finished Duolingo-style player is not a backend-PR blocker.

## Environment configuration

Copy `.env.example` to `backend/.env` or the repo root. Keys:

| Key | Default | Role |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./sentence_mining.db` | SQLAlchemy URL. Swap to `postgresql+psycopg://…` in prod with no model changes. |
| `SEED_SAMPLE_DATA` | `false` | When `true` or `1`, first boot inserts one realistic parsed session, unit memories, and a study pack so the UI is never empty. |
| `OPENAI_API_KEY` | empty | Optional. Empty → skip LLM, use deterministic templates. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Chat model for log enrichment and card phrasing. |
| `OPENAI_TIMEOUT_SECONDS` | `12` | Hard timeout on every OpenAI call. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated browser origins. |
| `APP_ENV` | `local` | `local` or `prod`. |

Health `GET /api/health` reports process liveness and whether `OPENAI_API_KEY` is configured (boolean only, never the secret).

## Database schema

SQLAlchemy 2.0 models + Alembic. Types stay on the Postgres-safe subset: `Integer` PKs, `DateTime(timezone=True)`, `Boolean`, `Float`, `Text`, `JSON`. No SQLite-only types, no `ENUM` native types (store card type / review result as constrained strings). Naming convention on `pk_`, `fk_`, `ix_`, `uq_` so Alembic diffs stay portable.

### `units`

Canonical learning units `k ∈ K`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `key` | String(64) unique | Slug, e.g. `do_the_school_run` |
| `label` | String(256) | Human title |
| `kind` | String(32) | `chunk`, `verb_prep`, `lexical_contrast`, `grammar` |
| `skill_tags` | JSON list[str] | Broader tags (`collocation`, `articles`, …) |
| `is_structural` | Boolean | Recurring structural gap vs one-off slip candidate |
| `created_at` | DateTime TZ | |

Seed catalog (minimum, also used by the parser mapper):

- chunks: `do_the_school_run`, `no_point_in_ing`, `by_hand`
- verb-preposition: `attend_no_prep`, `schedule_meeting`
- lexical contrasts: `for_free_vs_freely`, `rather_not_vs_wouldnt_prefer`
- grammar: `articles_a_the_zero`

Unknown surface errors mint a unit with key `misc_<normalized_phrase>` and kind inferred as `chunk`.

### `sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `raw_log` | Text | Original paste |
| `source` | String(32) | `paste` or `seed` |
| `focus_next_lesson` | Text nullable | Joined FOCUS lines |
| `parsed_payload` | JSON | Structured parser output |
| `ingested_at` | DateTime TZ | |

### `session_errors`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `session_id` | FK sessions | |
| `unit_id` | FK units | |
| `raw_utterance` | Text | `You said` |
| `corrected_utterance` | Text | `Correct` |
| `explanation` | Text | `Why` |
| `is_recurring` | Boolean | `RECURRING` marker or repeat in this log |

### `session_vocab`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `session_id` | FK sessions | |
| `unit_id` | FK units nullable | |
| `item` | String(256) | Headword / chunk |
| `example_usage` | Text | |
| `used_well` | Boolean | `used well!` mastery signal |

### `session_tracking`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `session_id` | FK sessions | |
| `unit_id` | FK units nullable | |
| `text` | Text | Line from TRACKING LIST |

### `unit_memories`

One row per unit. This is `S_k`, `t_last`, and the flags the selector reads.

| Column | Type | Notes |
| --- | --- | --- |
| `unit_id` | Integer PK/FK | |
| `stability_days` | Float | `S_k > 0` |
| `last_seen_at` | DateTime TZ nullable | `t_last`; null until first review or `used well!` |
| `last_p` | Float nullable | `p_k` at last observation |
| `last_outcome` | Integer nullable | `0` miss / `1` success |
| `error_count` | Integer | |
| `success_count` | Integer | |
| `is_recurring` | Boolean | Sticky once seen as RECURRING |
| `is_focus` | Boolean | Set from latest FOCUS FOR NEXT LESSON |
| `is_tracking` | Boolean | Set from latest TRACKING LIST |
| `updated_at` | DateTime TZ | |

### `study_packs`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `generated_at` | DateTime TZ | |
| `budget_cards` | Integer | Default 8 |
| `budget_prompts` | Integer | Default 3 |
| `generator` | String(32) | `openai` or `fallback` |
| `speaking_prompts` | JSON | List of `{prompt, unit_keys, why}` |

### `study_cards`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `study_pack_id` | FK study_packs | |
| `card_type` | String(32) | `fill_in_blank`, `fix_error`, `transform_sentence` |
| `prompt` | Text | Learner-facing stem |
| `answer` | Text | Expected response |
| `why` | Text | Immediate feedback copy |
| `unit_keys` | JSON | 1–2 unit slugs |
| `skill_tags` | JSON | For diversity accounting |
| `order_index` | Integer | Presentation order |

### `reviews`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | Integer PK | |
| `card_id` | FK study_cards | |
| `result` | String(16) | `knew_it`, `shaky`, `missed` |
| `submitted_at` | DateTime TZ | |
| `p_before` | JSON | `{unit_key: p_k}` snapshot |
| `s_before` | JSON | `{unit_key: S_k}` |
| `s_after` | JSON | `{unit_key: S_k}` |

Indexes: `units.key` unique; `session_errors.session_id`; `unit_memories.updated_at`; `study_packs.generated_at`; `study_cards.study_pack_id`.

## Parser (Φ)

Deterministic regex/section parser is the verifiable baseline. OpenAI enrichment runs only when a block is present but yields zero structured items (ambiguous free-form prose). Enrichment output is validated with Pydantic; on any failure the raw log is stored and the rule parser result (possibly empty) is kept.

Recognized sections and fields:

- Error item: `You said` → `raw_utterance`, `Correct` → `corrected_utterance`, `Why` → `explanation`, optional `RECURRING` → `is_recurring`.
- `VOCABULARY OF THE DAY`: `item`, example usage, mastery if the line contains `used well!`.
- `TRACKING LIST`: bullet or line items.
- `FOCUS FOR NEXT LESSON`: bullet or line items.

Surface text maps to catalog keys via phrase/pattern tables (e.g. “school run” → `do_the_school_run`, “no point in” → `no_point_in_ing`, “attend to the” → `attend_no_prep`). Recurring structural gaps are items marked `RECURRING` **or** the same unit appearing more than once in one log. Chunks also inherit broader skill/grammar tags from the catalog.

## Memory engine

All times UTC. For unit `k` at time `t`:

- `S_k(t) > 0` stored in days (`S_MIN = 0.25`, new units start at `S_INIT = 1.0`).
- `t_last` is last **review or successful in-conversation use**, not the error ingest itself. New units start with `t_last` null.
- If `t_last` is null, `p_k(t) = 0` (never encoded as a retrieval). Otherwise `Δt_k = max(0, (t − t_last) / 86400)` and `p_k(t) = exp(−Δt_k / S_k(t))`.
- First success with null `t_last` uses `Δt_k = S_INIT` so spaced-repetition gain is non-zero.

**Miss** (`o_k = 0`: ingest error, or review `missed`): prediction-error weighting.

```
surprise = p_k(t)                         # unexpected if recall was high
recurring = 1.35 if is_recurring else 1.0
reduction = 0.20 * (1 + 0.55 * surprise) * recurring
S ← max(S_MIN, S * (1 − min(reduction, 0.85)))
```

An unexpected failure (high `p_k`) or a recurring gap cuts stability harder than a miss that was already likely.

**Success** (`o_k = 1`: `used well!`, card `knew_it`): increase `S` with diminishing returns as `S` grows, scaled by elapsed time (spaced-repetition gain).

```
spacing = Δt / (Δt + S)
diminish = 60 / (60 + S)
S ← S * (1 + 0.80 * spacing * diminish)
```

Review `shaky` is a partial success: the same formula with gain `0.80 * 0.35`.

**Urgency** used by the queue and selector:

```
w_k = 1 + 0.50·is_focus + 0.40·is_recurring + 0.20·is_tracking
urgency_k = w_k * (1 − p_k(t))
```

Ingest of a session applies misses for each error item (at ingest time), successes for `used well!` vocab, and refreshes focus/tracking flags from the latest lists (previous session flags are cleared, then the new lists applied).

## i+1 material selection

Default budget `B`: **8** practice cards + **3** speaking prompts.

1. Rank remaining units by `urgency_k`.
2. Greedy submodular pick: once a unit (or a shared skill tag) is already in the set, its score is divided by `1 + coverage_count` (diminishing returns).
3. Each card targets **1 or 2** units. A second unit is attached only when it shares a skill tag and is still in the top urgency band.
4. Card-type diversity: rotate `fill_in_blank`, `fix_error`, `transform_sentence` so no type exceeds `ceil(B/2)`.
5. Surrounding phrasing is short, adult, and on-catalog; templates never introduce untaught low-frequency vocabulary.

OpenAI, when configured, rewrites the selected skeleton into natural contextual sentences. The rewrite must preserve `unit_keys`, `card_type`, and `answer`. Validation failure → keep the deterministic skeleton.

Immediate grading is client-side against `answer` (normalized) plus a Why line from the card. Results post to `POST /api/reviews/submit` as `knew_it` | `shaky` | `missed` and update `S_k` / `p_k` for every unit on the card.

## HTTP API

| Method | Path | Body / result |
| --- | --- | --- |
| `POST` | `/api/sessions/ingest` | `{ raw_log }` → session id, parsed units, updated memories |
| `GET` | `/api/study-pack/latest` | Latest pack + cards + speaking prompts, or 404 |
| `POST` | `/api/study-pack/generate` | Optional `{ budget_cards, budget_prompts }` → new pack |
| `POST` | `/api/reviews/submit` | `{ card_id, result }` → per-unit `s_before` / `s_after` / `p_before` |
| `GET` | `/api/units` | All units with current `S_k`, `p_k`, urgency, flags |
| `GET` | `/api/health` | `{ status, openai_configured }` |

## Frontend (target UX)

Duolingo-inspired, adult, uncluttered:

- Top progress bar and session/streak counter.
- Card-by-card player with keyboard shortcuts (`1` knew it, `2` shaky, `3` missed, Enter submit).
- Instant evaluation and Why copy; no cartoon mascots.
- Side or follow-on panel: next-session speaking prompts.
- Ingest tab/modal: paste session log.
- Unit memory inspector: `S_k`, `p_k`, urgency, recurring/focus/tracking.

The first backend PR only needs the Vite + React + TypeScript + Tailwind tree compiling; the player can land immediately after tests are green.

## Tests (pytest)

- Parser: RECURRING flag, `used well!`, TRACKING/FOCUS sections, catalog mapping.
- Forgetting curve: exact `p_k` from `Δt` and `S`; surprise penalty larger when `p_k` high; recurring miss penalizes more than a one-off; success grows `S` with diminishing returns.
- Selection: budget respected; 1–2 units per card; coverage diminishing returns; type diversity.
- Reviews: `knew_it` / `shaky` / `missed` mutate `S_k` as specified; API round-trip.

## Local and production run

- Local: `./scripts/run-local.sh` → Alembic upgrade, optional seed, `uvicorn app.main:app --reload --app-dir backend`, Vite on `:5173` proxying `/api`.
- Prod: `./scripts/run-prod.sh` → `DATABASE_URL` Postgres, `SEED_SAMPLE_DATA=false`, uvicorn/gunicorn with workers, no reload.

Seed data is a single realistic English-learner session covering the catalog units, including at least one `RECURRING` error and one `used well!` vocab line, plus a generated fallback study pack.
