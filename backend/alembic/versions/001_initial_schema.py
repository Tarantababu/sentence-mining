"""initial postgres-ready schema

Revision ID: 001
Revises:
Create Date: 2026-11-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "units",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("skill_tags", sa.JSON(), nullable=True),
        sa.Column("is_structural", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("key", name="uq_units_key"),
    )
    op.create_index("ix_units_key", "units", ["key"], unique=True)

    op.create_table(
        "sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("raw_log", sa.Text(), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False, server_default="paste"),
        sa.Column("focus_next_lesson", sa.Text(), nullable=True),
        sa.Column("parsed_payload", sa.JSON(), nullable=True),
        sa.Column("ingested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "session_errors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=False),
        sa.Column("raw_utterance", sa.Text(), nullable=False),
        sa.Column("corrected_utterance", sa.Text(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_session_errors_session_id", "session_errors", ["session_id"])
    op.create_index("ix_session_errors_unit_id", "session_errors", ["unit_id"])

    op.create_table(
        "session_vocab",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=True),
        sa.Column("item", sa.String(length=256), nullable=False),
        sa.Column("example_usage", sa.Text(), nullable=False, server_default=""),
        sa.Column("used_well", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_session_vocab_session_id", "session_vocab", ["session_id"])

    op.create_table(
        "session_tracking",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
    )
    op.create_index("ix_session_tracking_session_id", "session_tracking", ["session_id"])

    op.create_table(
        "unit_memories",
        sa.Column("unit_id", sa.Integer(), sa.ForeignKey("units.id"), primary_key=True),
        sa.Column("stability_days", sa.Float(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_p", sa.Float(), nullable=True),
        sa.Column("last_outcome", sa.Integer(), nullable=True),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_focus", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_tracking", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "study_packs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("budget_cards", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("budget_prompts", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("generator", sa.String(length=32), nullable=False, server_default="fallback"),
        sa.Column("speaking_prompts", sa.JSON(), nullable=True),
    )
    op.create_index("ix_study_packs_generated_at", "study_packs", ["generated_at"])

    op.create_table(
        "study_cards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("study_pack_id", sa.Integer(), sa.ForeignKey("study_packs.id"), nullable=False),
        sa.Column("card_type", sa.String(length=32), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("answer", sa.Text(), nullable=False),
        sa.Column("why", sa.Text(), nullable=False, server_default=""),
        sa.Column("unit_keys", sa.JSON(), nullable=True),
        sa.Column("skill_tags", sa.JSON(), nullable=True),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_study_cards_study_pack_id", "study_cards", ["study_pack_id"])

    op.create_table(
        "reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("card_id", sa.Integer(), sa.ForeignKey("study_cards.id"), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("p_before", sa.JSON(), nullable=True),
        sa.Column("s_before", sa.JSON(), nullable=True),
        sa.Column("s_after", sa.JSON(), nullable=True),
    )
    op.create_index("ix_reviews_card_id", "reviews", ["card_id"])


def downgrade() -> None:
    op.drop_table("reviews")
    op.drop_table("study_cards")
    op.drop_table("study_packs")
    op.drop_table("unit_memories")
    op.drop_table("session_tracking")
    op.drop_table("session_vocab")
    op.drop_table("session_errors")
    op.drop_table("sessions")
    op.drop_table("units")
