from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import (
    ProcessingArtifact,
    ProcessingJob,
    SurveyFile,
    SurveyProject,
)
from app.services.nodeodm_service import (
    create_nodeodm_task,
    download_nodeodm_all,
    extract_nodeodm_products,
    get_nodeodm_task_info,
    get_nodeodm_task_output,
)

router = APIRouter(
    prefix="/surveys",
    tags=["Processing"],
)

ALLOWED_JOB_TYPES = {
    "VALIDATION",
    "PPK",
    "ORTHOMOSAIC",
    "BOUNDARY",
    "COMPARISON",
}

def _job_response(job: ProcessingJob) -> dict:
    return {
        "id": str(job.id),
        "survey_id": str(job.survey_id),
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "error_message": job.error_message,
    }

def _survey_storage_root(survey: SurveyProject) -> Path:
    return (
        Path(settings.storage_root)
        / "surveys"
        / survey.survey_code
    )

def _find_survey_images(
    survey_id: UUID,
    db: Session,
) -> list[SurveyFile]:
    statement = (
        select(SurveyFile)
        .where(
            SurveyFile.survey_id == survey_id,
            SurveyFile.file_type == "IMAGE",
        )
        .order_by(SurveyFile.original_filename)
    )

    return list(db.scalars(statement).all())

def _find_gcp_file(
    survey_id: UUID,
    db: Session,
) -> SurveyFile | None:
    statement = (
        select(SurveyFile)
        .where(
            SurveyFile.survey_id == survey_id,
            SurveyFile.file_type.in_(
                ["GCP", "GCP_TXT"]
            ),
        )
        .order_by(SurveyFile.uploaded_at.asc())
    )

    return db.scalars(statement).first()

def _register_artifact(
    db: Session,
    survey: SurveyProject,
    job: ProcessingJob,
    artifact_type: str,
    name: str,
    path: Path,
    file_format: str,
) -> ProcessingArtifact:
    existing = db.scalar(
        select(ProcessingArtifact)
        .where(
            ProcessingArtifact.survey_id == survey.id,
            ProcessingArtifact.artifact_type == artifact_type,
        )
    )

    if existing is not None:
        existing.processing_job_id = job.id
        existing.name = name
        existing.storage_path = str(path)
        existing.file_format = file_format
        existing.size_bytes = (
            path.stat().st_size
            if path.is_file()
            else sum(
                item.stat().st_size
                for item in path.rglob("*")
                if item.is_file()
            )
        )

        return existing

    if path.is_file():
        size_bytes = path.stat().st_size
    else:
        size_bytes = sum(
            item.stat().st_size
            for item in path.rglob("*")
            if item.is_file()
        )

    artifact = ProcessingArtifact(
        survey_id=survey.id,
        processing_job_id=job.id,
        artifact_type=artifact_type,
        name=name,
        storage_path=str(path),
        file_format=file_format,
        size_bytes=size_bytes,
    )

    db.add(artifact)

    return artifact

def _sync_orthomosaic_job(
    job: ProcessingJob,
    survey: SurveyProject,
    db: Session,
) -> ProcessingJob:
    if not job.nodeodm_task_uuid:
        raise RuntimeError(
            "ORTHOMOSAIC job has no NodeODM task UUID."
        )

    task_info = get_nodeodm_task_info(
        job.nodeodm_task_uuid
    )

    node_status = task_info.get(
        "status",
        {},
    )

    status_code = node_status.get("code")
    progress = int(
        task_info.get(
            "progress",
            0,
        )
        or 0
    )

    job.progress = max(
        0,
        min(
            100,
            progress,
        ),
    )

    if status_code == 40:
        job.status = "COMPLETED"
        job.progress = 100
        job.completed_at = datetime.now(
            timezone.utc
        )
        job.message = (
            "NodeODM processing completed. "
            "Preparing ELIOS-LAND artifacts."
        )

        db.commit()

        survey_root = _survey_storage_root(
            survey
        )

        processed_root = (
            survey_root / "processed"
        )

        archive_path = (
            processed_root
            / "nodeodm"
            / f"{job.nodeodm_task_uuid}.zip"
        )

        archive_path.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        products = None

        orthomosaic_path = (
            processed_root
            / "orthomosaic"
            / "orthomosaic.tif"
        )

        dsm_path = (
            processed_root
            / "elevation"
            / "dsm.tif"
        )

        ept_path = (
            processed_root
            / "point_cloud"
            / "entwine_pointcloud"
        )

        if (
            orthomosaic_path.exists()
            and dsm_path.exists()
            and ept_path.exists()
        ):
            products = {
                "orthomosaic": orthomosaic_path,
                "dsm": dsm_path,
                "point_cloud": ept_path,
            }

        else:
            job.status = "RUNNING"
            job.progress = 100
            job.message = (
                "NodeODM completed. "
                "Downloading and extracting products."
            )

            db.commit()

            download_nodeodm_all(
                job.nodeodm_task_uuid,
                archive_path,
            )

            products = extract_nodeodm_products(
                archive_path,
                processed_root,
            )

            try:
                archive_path.unlink()
            except FileNotFoundError:
                pass

        _register_artifact(
            db=db,
            survey=survey,
            job=job,
            artifact_type="ORTHOMOSAIC",
            name="Orthomosaic",
            path=products["orthomosaic"],
            file_format="TIF",
        )

        _register_artifact(
            db=db,
            survey=survey,
            job=job,
            artifact_type="DSM",
            name="Digital Surface Model",
            path=products["dsm"],
            file_format="TIF",
        )

        _register_artifact(
            db=db,
            survey=survey,
            job=job,
            artifact_type="POINT_CLOUD_EPT",
            name="Entwine Point Cloud",
            path=products["point_cloud"],
            file_format="EPT",
        )

        job.status = "COMPLETED"
        job.progress = 100
        job.completed_at = datetime.now(
            timezone.utc
        )
        job.message = (
            "Orthomosaic, DSM and point-cloud "
            "products are available."
        )

        db.commit()
        db.refresh(job)

        return job

    if status_code in {20, 30}:
        job.status = "RUNNING"
        job.progress = max(
            0,
            min(
                99,
                progress,
            ),
        )

        job.message = (
            f"NodeODM processing in progress "
            f"({job.progress}%)."
        )

        if job.started_at is None:
            job.started_at = datetime.now(
                timezone.utc
            )

        db.commit()
        db.refresh(job)

        return job

    if status_code in {10}:
        job.status = "QUEUED"
        job.progress = max(
            0,
            min(
                99,
                progress,
            ),
        )

        job.message = (
            "NodeODM task is queued."
        )

        db.commit()
        db.refresh(job)

        return job

    if status_code in {50, 60}:
        job.status = "FAILED"
        job.error_message = (
            "NodeODM reported a failed task."
        )
        job.message = (
            "NodeODM processing failed."
        )
        job.completed_at = datetime.now(
            timezone.utc
        )

        db.commit()
        db.refresh(job)

        return job

    job.status = "RUNNING"
    job.progress = max(
        0,
        min(
            99,
            progress,
        ),
    )

    job.message = (
        f"NodeODM task status code "
        f"{status_code}."
    )

    db.commit()
    db.refresh(job)

    return job

@router.post("/{survey_id}/processing")
def create_processing_job(
    survey_id: UUID,
    job_type: str = "ORTHOMOSAIC",
    db: Session = Depends(get_db),
):
    survey = db.get(
        SurveyProject,
        survey_id,
    )

    if survey is None:
        raise HTTPException(
            status_code=404,
            detail="Survey not found.",
        )

    job_type = job_type.upper()

    if job_type not in ALLOWED_JOB_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported job type: {job_type}"
            ),
        )

    active_statement = (
        select(ProcessingJob)
        .where(
            ProcessingJob.survey_id == survey_id,
            ProcessingJob.job_type == job_type,
            ProcessingJob.status.in_(
                ["QUEUED", "RUNNING"]
            ),
        )
        .order_by(
            ProcessingJob.created_at.desc()
        )
    )

    active_job = db.scalars(
        active_statement
    ).first()

    if active_job is not None:
        return _job_response(active_job)

    job = ProcessingJob(
        survey_id=survey.id,
        job_type=job_type,
        status="QUEUED",
        progress=0,
        message="Processing job queued.",
    )

    db.add(job)
    db.commit()
    db.refresh(job)

    if job_type != "ORTHOMOSAIC":
        job.message = (
            f"{job_type} job registered. "
            "Execution for this processing type "
            "is not yet connected."
        )

        db.commit()
        db.refresh(job)

        return _job_response(job)

    try:
        image_files = _find_survey_images(
            survey_id,
            db,
        )

        if not image_files:
            raise RuntimeError(
                "No survey image files are registered."
            )

        image_paths = []

        for image_file in image_files:
            path = Path(
                image_file.storage_path
            )

            if not path.exists():
                raise RuntimeError(
                    "Registered survey image is "
                    f"missing: {path}"
                )

            image_paths.append(
                str(path)
            )

        gcp_file = _find_gcp_file(
            survey_id,
            db,
        )

        gcp_path = None

        if gcp_file is not None:
            candidate = Path(
                gcp_file.storage_path
            )

            if candidate.exists():
                if candidate.suffix.lower() == ".txt":
                    gcp_path = str(candidate)

        job.status = "RUNNING"
        job.progress = 1
        job.started_at = datetime.now(
            timezone.utc
        )
        job.message = (
            f"Submitting {len(image_paths)} "
            "images to NodeODM."
        )

        db.commit()

        node_task = create_nodeodm_task(
            image_paths=image_paths,
            gcp_path=gcp_path,
            name=(
                f"ELIOS-LAND "
                f"{survey.survey_code}"
            ),
        )

        node_task_uuid = node_task.get(
            "uuid"
        )

        if not node_task_uuid:
            raise RuntimeError(
                "NodeODM did not return a task UUID."
            )

        job.nodeodm_task_uuid = (
            node_task_uuid
        )

        job.status = "QUEUED"
        job.progress = 0
        job.message = (
            "NodeODM task created successfully."
        )

        db.commit()
        db.refresh(job)

        return _job_response(job)

    except Exception as exc:
        job.status = "FAILED"
        job.completed_at = datetime.now(
            timezone.utc
        )
        job.error_message = str(exc)
        job.message = (
            "Failed to create NodeODM task."
        )

        db.commit()
        db.refresh(job)

        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

@router.get("/{survey_id}/processing")
def list_processing_jobs(
    survey_id: UUID,
    db: Session = Depends(get_db),
):
    survey = db.get(
        SurveyProject,
        survey_id,
    )

    if survey is None:
        raise HTTPException(
            status_code=404,
            detail="Survey not found.",
        )

    statement = (
        select(ProcessingJob)
        .where(
            ProcessingJob.survey_id == survey_id
        )
        .order_by(
            ProcessingJob.created_at.desc()
        )
    )

    jobs = db.scalars(
        statement
    ).all()

    synced_jobs = []

    for job in jobs:
        if (
            job.job_type == "ORTHOMOSAIC"
            and job.nodeodm_task_uuid
            and job.status not in {
                "FAILED",
                "COMPLETED",
            }
        ):
            try:
                job = _sync_orthomosaic_job(
                    job,
                    survey,
                    db,
                )
            except Exception as exc:
                job.status = "FAILED"
                job.completed_at = datetime.now(
                    timezone.utc
                )
                job.error_message = str(exc)
                job.message = (
                    "Failed while synchronizing "
                    "NodeODM processing."
                )
                db.commit()
                db.refresh(job)

        synced_jobs.append(job)

    return [
        _job_response(job)
        for job in synced_jobs
    ]

@router.get("/{survey_id}/processing/{job_id}")
def get_processing_job(
    survey_id: UUID,
    job_id: UUID,
    db: Session = Depends(get_db),
):
    job = db.get(
        ProcessingJob,
        job_id,
    )

    if (
        job is None
        or job.survey_id != survey_id
    ):
        raise HTTPException(
            status_code=404,
            detail="Processing job not found.",
        )

    survey = db.get(
        SurveyProject,
        survey_id,
    )

    if survey is None:
        raise HTTPException(
            status_code=404,
            detail="Survey not found.",
        )

    if (
        job.job_type == "ORTHOMOSAIC"
        and job.nodeodm_task_uuid
        and job.status not in {
            "FAILED",
        }
    ):
        try:
            job = _sync_orthomosaic_job(
                job,
                survey,
                db,
            )

        except Exception as exc:
            job.status = "FAILED"
            job.completed_at = datetime.now(
                timezone.utc
            )
            job.error_message = str(exc)
            job.message = (
                "Failed while synchronizing "
                "NodeODM processing."
            )

            db.commit()
            db.refresh(job)

    return _job_response(job)
