import time
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from .database import engine, Base
from .routes import todos

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Wait for database connection and create tables
    retries = 10
    while retries > 0:
        try:
            logger.info("Attempting database connection and table creation...")
            Base.metadata.create_all(bind=engine)
            with engine.connect() as conn:
                from sqlalchemy import text
                conn.execute(text("ALTER TABLE todos ADD COLUMN IF NOT EXISTS user_id VARCHAR(255) DEFAULT 'legacy-user';"))
                conn.commit()
            logger.info("Database connection successful and tables verified.")
            break
        except OperationalError as exc:
            retries -= 1
            logger.warning("Database not ready yet (%s). Retrying in 2 seconds... (%d retries left)", exc, retries)
            if retries == 0:
                logger.error("Could not connect to database after maximum retries.")
                raise exc
            time.sleep(2)
    yield


app = FastAPI(title="Todo API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(todos.router)


@app.get("/")
def read_root():
    return {"message": "Todo API is running"}

