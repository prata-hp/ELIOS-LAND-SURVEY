from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.processing import router as processing_router
from app.api.ingestion import router as ingestion_router
from app.api.validation import router as validation_router
from app.api.surveys import router as surveys_router
from app.api.uploads import router as uploads_router
from app.api.artifacts import router as artifacts_router
from app.api.orthomosaic import router as orthomosaic_router
from app.api.cadastral_real import router as cadastral_real_router

app = FastAPI(
    title="ELIOS-LAND API",
    description="Land survey and orthomosaic processing backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(surveys_router)
app.include_router(uploads_router)
app.include_router(artifacts_router)
app.include_router(orthomosaic_router)
app.include_router(processing_router)
app.include_router(ingestion_router)
app.include_router(validation_router)

@app.get("/")
def root():
    return {
        "name": "ELIOS-LAND API",
        "version": "0.1.0",
        "status": "running",
    }

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "elios-land-backend",
    }

app.include_router(cadastral_real_router)

from app.api.analysis_compat import router as analysis_compat_router
app.include_router(analysis_compat_router)

from app.api.gis_workspace import router as gis_workspace_router
app.include_router(gis_workspace_router)
