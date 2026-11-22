from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models as _models  # noqa: F401
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.routers import health, reviews, sessions, study_pack, units
from app.services.seed import seed_if_needed
from app.services.unit_catalog import ensure_catalog


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        ensure_catalog(db)
        if get_settings().seed_sample_data:
            seed_if_needed(db)
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Sentence Mining",
        description="Personalized error-driven language and memory engine",
        version="0.1.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list or ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.include_router(health.router)
    application.include_router(sessions.router)
    application.include_router(study_pack.router)
    application.include_router(reviews.router)
    application.include_router(units.router)
    return application


app = create_app()
