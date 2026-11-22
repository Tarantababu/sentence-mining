from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from app.db import Base


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(256))
    kind: Mapped[str] = mapped_column(String(32))
    skill_tags: Mapped[list] = mapped_column(JSON, default=list)
    is_structural: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    memory: Mapped[UnitMemory | None] = relationship(back_populates="unit", uselist=False)
    errors: Mapped[list[SessionError]] = relationship(back_populates="unit")


class SessionRecord(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    raw_log: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(32), default="paste")
    focus_next_lesson: Mapped[str | None] = mapped_column(Text, nullable=True)
    parsed_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    errors: Mapped[list[SessionError]] = relationship(back_populates="session")
    vocab: Mapped[list[SessionVocab]] = relationship(back_populates="session")
    tracking: Mapped[list[SessionTracking]] = relationship(back_populates="session")


class SessionError(Base):
    __tablename__ = "session_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id"), index=True)
    raw_utterance: Mapped[str] = mapped_column(Text)
    corrected_utterance: Mapped[str] = mapped_column(Text)
    explanation: Mapped[str] = mapped_column(Text, default="")
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[SessionRecord] = relationship(back_populates="errors")
    unit: Mapped[Unit] = relationship(back_populates="errors")


class SessionVocab(Base):
    __tablename__ = "session_vocab"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"), nullable=True)
    item: Mapped[str] = mapped_column(String(256))
    example_usage: Mapped[str] = mapped_column(Text, default="")
    used_well: Mapped[bool] = mapped_column(Boolean, default=False)

    session: Mapped[SessionRecord] = relationship(back_populates="vocab")
    unit: Mapped[Unit | None] = relationship()


class SessionTracking(Base):
    __tablename__ = "session_tracking"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"), index=True)
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("units.id"), nullable=True)
    text: Mapped[str] = mapped_column(Text)

    session: Mapped[SessionRecord] = relationship(back_populates="tracking")
    unit: Mapped[Unit | None] = relationship()


class UnitMemory(Base):
    __tablename__ = "unit_memories"

    unit_id: Mapped[int] = mapped_column(ForeignKey("units.id"), primary_key=True)
    stability_days: Mapped[float] = mapped_column(Float)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_p: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_outcome: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    success_count: Mapped[int] = mapped_column(Integer, default=0)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False)
    is_focus: Mapped[bool] = mapped_column(Boolean, default=False)
    is_tracking: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    unit: Mapped[Unit] = relationship(back_populates="memory")


class StudyPack(Base):
    __tablename__ = "study_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    budget_cards: Mapped[int] = mapped_column(Integer, default=8)
    budget_prompts: Mapped[int] = mapped_column(Integer, default=3)
    generator: Mapped[str] = mapped_column(String(32), default="fallback")
    speaking_prompts: Mapped[list] = mapped_column(JSON, default=list)

    cards: Mapped[list[StudyCard]] = relationship(
        back_populates="study_pack", order_by="StudyCard.order_index"
    )


class StudyCard(Base):
    __tablename__ = "study_cards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    study_pack_id: Mapped[int] = mapped_column(ForeignKey("study_packs.id"), index=True)
    card_type: Mapped[str] = mapped_column(String(32))
    prompt: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    why: Mapped[str] = mapped_column(Text, default="")
    unit_keys: Mapped[list] = mapped_column(JSON, default=list)
    skill_tags: Mapped[list] = mapped_column(JSON, default=list)
    queue: Mapped[str] = mapped_column(String(16), default="due")
    order_index: Mapped[int] = mapped_column(Integer, default=0)

    study_pack: Mapped[StudyPack] = relationship(back_populates="cards")
    reviews: Mapped[list[Review]] = relationship(back_populates="card")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("study_cards.id"), index=True)
    result: Mapped[str] = mapped_column(String(16))
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    p_before: Mapped[dict] = mapped_column(JSON, default=dict)
    s_before: Mapped[dict] = mapped_column(JSON, default=dict)
    s_after: Mapped[dict] = mapped_column(JSON, default=dict)

    card: Mapped[StudyCard] = relationship(back_populates="reviews")
