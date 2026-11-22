#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv 2>/dev/null || true
fi
if [[ -f .venv/bin/activate ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
python3 -m pip install -q -r requirements.txt

if [[ ! -f .env && ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

export PYTHONPATH="."
export APP_ENV="${APP_ENV:-local}"
export SEED_SAMPLE_DATA="${SEED_SAMPLE_DATA:-true}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///./sentence_mining.db}"

alembic upgrade head
exec uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
