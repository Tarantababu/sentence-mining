from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    openai_configured: bool
