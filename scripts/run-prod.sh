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

export PYTHONPATH="."
export APP_ENV="${APP_ENV:-prod}"
export SEED_SAMPLE_DATA="${SEED_SAMPLE_DATA:-false}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required in production (use postgresql+psycopg://...)." >&2
  exit 1
fi

alembic upgrade head
WORKERS="${WEB_CONCURRENCY:-2}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers "$WORKERS"
