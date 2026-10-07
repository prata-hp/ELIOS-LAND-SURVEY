from io import BytesIO
from pathlib import Path
from uuid import UUID

import numpy as np
import rasterio
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.processing_artifact import ProcessingArtifact

router = APIRouter(
    prefix="/surveys/{survey_id}/orthomosaic",
    tags=["Orthomosaic"],
)

def get_orthomosaic_artifact(
    survey_id: UUID,
    db: Session,
) -> ProcessingArtifact:
    artifact = db.scalar(
        select(ProcessingArtifact).where(
            ProcessingArtifact.survey_id == survey_id,
            ProcessingArtifact.artifact_type == "ORTHOMOSAIC",
        )
    )

    if artifact is None:
        raise HTTPException(
            status_code=404,
            detail="Orthomosaic artifact not found.",
        )

    path = Path(artifact.storage_path)

    if not path.exists() or not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="Orthomosaic file not found on storage.",
        )

    return artifact

@router.get("/info")
def get_orthomosaic_info(
    survey_id: UUID,
    db: Session = Depends(get_db),
):
    artifact = get_orthomosaic_artifact(survey_id, db)

    with rasterio.open(artifact.storage_path) as src:
        bounds = src.bounds
        resolution = src.res

        return {
            "artifact_id": str(artifact.id),
            "name": artifact.name,
            "file_format": artifact.file_format,
            "size_bytes": artifact.size_bytes,
            "crs": src.crs.to_string() if src.crs else None,
            "width": src.width,
            "height": src.height,
            "bands": src.count,
            "dtype": list(src.dtypes),
            "resolution": [
                float(resolution[0]),
                float(resolution[1]),
            ],
            "bounds": {
                "left": float(bounds.left),
                "bottom": float(bounds.bottom),
                "right": float(bounds.right),
                "top": float(bounds.top),
            },
        }

@router.get("/preview")
def get_orthomosaic_preview(
    survey_id: UUID,
    db: Session = Depends(get_db),
):
    artifact = get_orthomosaic_artifact(survey_id, db)

    with rasterio.open(artifact.storage_path) as src:

        max_dimension = 1600
        scale = min(
            1.0,
            max_dimension / max(src.width, src.height),
        )

        out_width = max(1, int(src.width * scale))
        out_height = max(1, int(src.height * scale))

        if src.count >= 3:
            data = src.read(
                [1, 2, 3],
                out_shape=(3, out_height, out_width),
                resampling=rasterio.enums.Resampling.bilinear,
            )
        else:
            data = src.read(
                1,
                out_shape=(out_height, out_width),
                resampling=rasterio.enums.Resampling.bilinear,
            )

        if data.ndim == 2:
            data = np.stack([data, data, data], axis=0)

        data = np.moveaxis(data, 0, -1)

        if data.dtype != np.uint8:
            data = np.clip(data, 0, 255).astype(np.uint8)

        image = Image.fromarray(data, mode="RGB")

        buffer = BytesIO()
        image.save(buffer, format="PNG", optimize=True)
        buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="image/png",
        headers={
            "Cache-Control": "public, max-age=3600",
        },
    )
