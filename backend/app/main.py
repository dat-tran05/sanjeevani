"""FastAPI entry point — single /query SSE endpoint."""
import os
from dotenv import load_dotenv
load_dotenv()  # load .env from repo root if backend started from there

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.agents.graph import run_query_stream


@asynccontextmanager
async def lifespan(app: FastAPI):
    # MLflow autolog (one line — captures every LangGraph node trace)
    try:
        import mlflow
        mlflow.langchain.autolog()
        if os.environ.get("MLFLOW_EXPERIMENT_NAME"):
            mlflow.set_experiment(os.environ["MLFLOW_EXPERIMENT_NAME"])
        print("[startup] MLflow autolog enabled")
    except Exception as e:
        print(f"[startup] MLflow autolog skipped: {e}")
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/query")
def query_endpoint(req: QueryRequest):
    def event_stream():
        for ev in run_query_stream(req.query):
            yield ev.to_sse()
    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("FASTAPI_PORT", "8000"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=False)
