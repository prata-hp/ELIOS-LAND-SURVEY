from __future__ import annotations
from dotenv import load_dotenv
load_dotenv()

import hashlib
import json
import math
import os
import shutil
import tempfile
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any

import geopandas as gpd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from pyproj import CRS, Transformer
from shapely import wkb, wkt
from shapely.geometry import (
    GeometryCollection,
    MultiPolygon,
    Point,
    Polygon,
    mapping,
    shape,
)
from shapely.validation import make_valid
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

router = APIRouter(
    prefix="/api/cadastral",
    tags=["Cadastral Comparison"],
)

AREA_TOLERANCE_PERCENT = float(
    os.getenv("CADASTRAL_AREA_TOLERANCE_PERCENT", "2.0")
)

BOUNDARY_TOLERANCE_METERS = float(
    os.getenv("CADASTRAL_BOUNDARY_TOLERANCE_METERS", "0.50")
)

OVERLAP_TOLERANCE_PERCENT = float(
    os.getenv("CADASTRAL_OVERLAP_TOLERANCE_PERCENT", "95.0")
)

MATCH_OVERLAP_PERCENT = float(
    os.getenv("CADASTRAL_MATCH_OVERLAP_PERCENT", "20.0")
)

def database_url() -> str:
    value = (
        os.getenv("DATABASE_URL")
        or os.getenv("DATABASE_URI")
        or os.getenv("POSTGRES_URL")
    )

    if not value:
        raise RuntimeError("Database URL is not configured.")

    return (
        value
        .replace("+psycopg", "")
        .replace("+asyncpg", "")
    )

def db():
    return psycopg.connect(
        database_url(),
        row_factory=dict_row,
    )

def json_safe(value: Any):
    try:
        return json.loads(
            json.dumps(
                value,
                default=lambda x: str(x),
            )
        )
    except Exception:
        return {}

def parse_uuid(value: str | None):
    if not value:
        return None

    try:
        return uuid.UUID(value)
    except Exception:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid UUID: {value}",
        )

def choose_local_crs(gdf: gpd.GeoDataFrame) -> str:
    geographic = gdf.to_crs("EPSG:4326")

    centroid = geographic.geometry.union_all().centroid

    lon = float(centroid.x)
    lat = float(centroid.y)

    if -80 <= lat <= 84:
        zone = int((lon + 180) / 6) + 1

        if lat >= 0:
            epsg = 32600 + zone
        else:
            epsg = 32700 + zone

        return f"EPSG:{epsg}"

    return "EPSG:6933"

def polygonal_geometry(geom):
    if geom is None:
        return None

    if geom.is_empty:
        return None

    original_valid = geom.is_valid

    if not original_valid:
        geom = make_valid(geom)

    if geom is None or geom.is_empty:
        return None

    if isinstance(geom, Polygon):
        return MultiPolygon([geom])

    if isinstance(geom, MultiPolygon):
        return geom

    if isinstance(geom, GeometryCollection):
        polygons = []

        for item in geom.geoms:
            if isinstance(item, Polygon):
                polygons.append(item)
            elif isinstance(item, MultiPolygon):
                polygons.extend(list(item.geoms))

        if polygons:
            return MultiPolygon(polygons)

    return None

def geometry_status(original, normalized):
    if normalized is None:
        return "INVALID"

    if not original.is_valid:
        return "FIXED"

    return "VALID"

def boundary_sample_points(geom, count=60):
    boundary = geom.boundary

    lines = []

    if hasattr(boundary, "geoms"):
        for item in boundary.geoms:
            if item.length > 0:
                lines.append(item)
    else:
        if boundary.length > 0:
            lines.append(boundary)

    if not lines:
        return []

    total = sum(line.length for line in lines)

    points = []

    for line in lines:
        share = max(
            1,
            int(round(count * line.length / total))
        )

        for i in range(share):
            distance = (
                line.length * i / max(1, share - 1)
            )

            points.append(
                line.interpolate(distance)
            )

    return points

def boundary_metrics(old_geom, new_geom):
    old_points = boundary_sample_points(old_geom)
    new_boundary = new_geom.boundary

    if not old_points:
        return 0.0, 0.0

    distances = [
        float(new_boundary.distance(point))
        for point in old_points
    ]

    mean_value = sum(distances) / len(distances)

    reverse_points = boundary_sample_points(new_geom)
    old_boundary = old_geom.boundary

    reverse_distances = [
        float(old_boundary.distance(point))
        for point in reverse_points
    ]

    all_distances = distances + reverse_distances

    maximum = max(all_distances) if all_distances else 0.0

    mean = (
        sum(all_distances) / len(all_distances)
        if all_distances
        else 0.0
    )

    return mean, maximum

def projected_geometry(geom, source_crs, target_crs):
    transformer = Transformer.from_crs(
        source_crs,
        target_crs,
        always_xy=True,
    )

    return transform(
        transformer.transform,
        geom,
    )

def geometry_metrics(old_geom, new_geom, projected_crs):
    old_p = projected_geometry(
        old_geom,
        "EPSG:4326",
        projected_crs,
    )

    new_p = projected_geometry(
        new_geom,
        "EPSG:4326",
        projected_crs,
    )

    old_area = float(old_p.area)
    new_area = float(new_p.area)

    old_perimeter = float(old_p.length)
    new_perimeter = float(new_p.length)

    intersection = old_p.intersection(new_p)
    union = old_p.union(new_p)

    intersection_area = float(intersection.area)
    union_area = float(union.area)

    overlap = (
        intersection_area / union_area * 100
        if union_area > 0
        else 0.0
    )

    area_difference = new_area - old_area

    area_change_percent = (
        area_difference / old_area * 100
        if old_area > 0
        else 0.0
    )

    centroid_shift = float(
        old_p.centroid.distance(new_p.centroid)
    )

    boundary_mean, boundary_max = boundary_metrics(
        old_p,
        new_p,
    )

    return {
        "old_area": old_area,
        "new_area": new_area,
        "area_difference": area_difference,
        "area_change_percent": area_change_percent,
        "old_perimeter": old_perimeter,
        "new_perimeter": new_perimeter,
        "perimeter_difference": (
            new_perimeter - old_perimeter
        ),
        "intersection_area": intersection_area,
        "union_area": union_area,
        "overlap_percent": overlap,
        "centroid_shift": centroid_shift,
        "boundary_mean_difference": boundary_mean,
        "boundary_max_difference": boundary_max,
    }

def classify_change(
    metrics,
    split=False,
    merge=False,
):
    if split:
        return "PARCEL_SPLIT"

    if merge:
        return "PARCEL_MERGE"

    if (
        abs(metrics["area_change_percent"])
        <= AREA_TOLERANCE_PERCENT
        and
        metrics["boundary_max_difference"]
        <= BOUNDARY_TOLERANCE_METERS
        and
        metrics["overlap_percent"]
        >= OVERLAP_TOLERANCE_PERCENT
    ):
        return "NO_SIGNIFICANT_CHANGE"

    if (
        metrics["boundary_max_difference"]
        > BOUNDARY_TOLERANCE_METERS
    ):
        return "BOUNDARY_SHIFT"

    if metrics["area_difference"] > 0:
        return "AREA_INCREASE"

    if metrics["area_difference"] < 0:
        return "AREA_DECREASE"

    return "REQUIRES_REVIEW"

def confidence_score(metrics, direct_id=False):
    overlap = min(
        1.0,
        max(0.0, metrics["overlap_percent"] / 100),
    )

    value = (
        overlap * 0.70
        + (0.30 if direct_id else 0.0)
    )

    return round(min(1.0, value), 4)

def read_vector_file(path: Path, filename: str):
    suffix = path.suffix.lower()

    if suffix == ".zip":
        extract_dir = path.parent / "shapefile_extracted"
        extract_dir.mkdir(exist_ok=True)

        shutil.unpack_archive(
            str(path),
            str(extract_dir),
        )

        shp_files = list(
            extract_dir.rglob("*.shp")
        )

        if not shp_files:
            raise ValueError(
                "ZIP does not contain a Shapefile (.shp)."
            )

        path = shp_files[0]
        suffix = ".shp"

    if suffix == ".gpkg":
        import fiona

        layers = fiona.listlayers(str(path))

        if not layers:
            raise ValueError(
                "GeoPackage contains no vector layers."
            )

        return gpd.read_file(
            str(path),
            layer=layers[0],
        )

    if suffix in {
        ".geojson",
        ".json",
        ".shp",
    }:
        return gpd.read_file(str(path))

    raise ValueError(
        "Supported formats: GeoJSON, GeoPackage, "
        "Shapefile ZIP."
    )

def import_layer(
    file_path: Path,
    filename: str,
    layer_type: str,
    name: str,
    survey_id=None,
    crs_override=None,
):
    layer_type = layer_type.upper()

    if layer_type not in {"OLD", "NEW"}:
        raise ValueError(
            "layer_type must be OLD or NEW."
        )

    gdf = read_vector_file(
        file_path,
        filename,
    )

    if gdf.empty:
        raise ValueError(
            "The cadastral file contains no features."
        )

    if gdf.crs is None:
        if crs_override:
            gdf = gdf.set_crs(
                crs_override,
                allow_override=True,
            )
        elif filename.lower().endswith(
            (".geojson", ".json")
        ):
            gdf = gdf.set_crs(
                "EPSG:4326",
                allow_override=True,
            )
        else:
            raise ValueError(
                "Input has no CRS. Supply crs_override."
            )

    original_crs = str(gdf.crs)

    gdf = gdf.to_crs("EPSG:4326")

    local_crs = choose_local_crs(gdf)

    metric_gdf = gdf.to_crs(local_crs)

    warnings = []

    clean_features = []

    seen = set()

    for index, row in gdf.iterrows():
        original = row.geometry

        normalized = polygonal_geometry(original)

        status = geometry_status(
            original,
            normalized,
        )

        if normalized is None:
            warnings.append(
                f"Feature {index}: invalid/non-polygon geometry."
            )
            continue

        digest = hashlib.sha1(
            normalized.wkb
        ).hexdigest()

        if digest in seen:
            warnings.append(
                f"Feature {index}: duplicate geometry skipped."
            )
            continue

        seen.add(digest)

        attrs = {
            str(k): json_safe(v)
            for k, v in row.items()
            if k != "geometry"
        }

        clean_features.append(
            {
                "index": int(index)
                if isinstance(index, (int, float))
                else str(index),
                "geometry": normalized,
                "attributes": attrs,
                "validation_status": status,
            }
        )

    if not clean_features:
        raise ValueError(
            "No valid polygon features remained after validation."
        )

    with db() as conn:
        with conn.cursor() as cur:

            layer_id = uuid.uuid4()

            cur.execute(
                """
                INSERT INTO cadastral_layers
                (
                    id,
                    name,
                    layer_type,
                    source,
                    source_format,
                    crs,
                    survey_id,
                    import_warnings
                )
                VALUES
                (
                    %s,%s,%s,%s,%s,%s,%s,%s
                )
                """,
                (
                    layer_id,
                    name,
                    layer_type,
                    filename,
                    Path(filename).suffix.lower(),
                    original_crs,
                    survey_id,
                    Jsonb(warnings),
                ),
            )

            target_table = (
                "old_parcels"
                if layer_type == "OLD"
                else "new_parcels"
            )

            inserted = []

            for sequence, feature in enumerate(
                clean_features
            ):
                geometry = feature["geometry"]

                metric_geometry = projected_geometry(
                    geometry,
                    "EPSG:4326",
                    local_crs,
                )

                area = float(
                    metric_geometry.area
                )

                perimeter = float(
                    metric_geometry.length
                )

                attrs = feature["attributes"]

                parcel_id = (
                    attrs.get("parcel_id")
                    or attrs.get("parcelId")
                    or attrs.get("plot_id")
                    or attrs.get("plotId")
                    or attrs.get("id")
                    or f"{layer_type}-{sequence + 1:04d}"
                )

                parcel_uuid = uuid.uuid4()

                if target_table == "old_parcels":
                    cur.execute(
                        """
                        INSERT INTO old_parcels
                        (
                            id,
                            layer_id,
                            parcel_id,
                            geometry,
                            source,
                            crs,
                            area,
                            perimeter,
                            attributes,
                            validation_status,
                            validation_message,
                            local_crs
                        )
                        VALUES
                        (
                            %s,%s,%s,
                            ST_SetSRID(ST_GeomFromText(%s),4326),
                            %s,%s,%s,%s,%s,%s,%s,%s
                        )
                        """,
                        (
                            parcel_uuid,
                            layer_id,
                            str(parcel_id),
                            geometry.wkt,
                            filename,
                            original_crs,
                            area,
                            perimeter,
                            Jsonb(attrs),
                            feature["validation_status"],
                            (
                                "Geometry repaired by make_valid."
                                if feature[
                                    "validation_status"
                                ] == "FIXED"
                                else None
                            ),
                            local_crs,
                        ),
                    )

                else:
                    cur.execute(
                        """
                        INSERT INTO new_parcels
                        (
                            id,
                            layer_id,
                            parcel_id,
                            geometry,
                            source,
                            crs,
                            survey_id,
                            area,
                            perimeter,
                            attributes,
                            validation_status,
                            validation_message,
                            local_crs
                        )
                        VALUES
                        (
                            %s,%s,%s,
                            ST_SetSRID(ST_GeomFromText(%s),4326),
                            %s,%s,%s,%s,%s,%s,%s,%s,%s
                        )
                        """,
                        (
                            parcel_uuid,
                            layer_id,
                            str(parcel_id),
                            geometry.wkt,
                            filename,
                            original_crs,
                            survey_id,
                            area,
                            perimeter,
                            Jsonb(attrs),
                            feature["validation_status"],
                            (
                                "Geometry repaired by make_valid."
                                if feature[
                                    "validation_status"
                                ] == "FIXED"
                                else None
                            ),
                            local_crs,
                        ),
                    )

                inserted.append(
                    {
                        "id": str(parcel_uuid),
                        "parcel_id": str(parcel_id),
                        "area": area,
                        "perimeter": perimeter,
                        "validation_status": feature[
                            "validation_status"
                        ],
                    }
                )

            conn.commit()

    return {
        "layer_id": str(layer_id),
        "layer_type": layer_type,
        "name": name,
        "source": filename,
        "source_crs": original_crs,
        "normalized_crs": "EPSG:4326",
        "measurement_crs": local_crs,
        "parcel_count": len(inserted),
        "warnings": warnings,
        "parcels": inserted,
    }

@router.get("/layers")
def get_layers():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    l.id,
                    l.name,
                    l.layer_type,
                    l.source,
                    l.source_format,
                    l.crs,
                    l.survey_id,
                    l.created_at,
                    COUNT(
                        CASE
                            WHEN l.layer_type='OLD'
                            THEN o.id
                            ELSE n.id
                        END
                    ) AS parcel_count
                FROM cadastral_layers l
                LEFT JOIN old_parcels o
                    ON o.layer_id=l.id
                LEFT JOIN new_parcels n
                    ON n.layer_id=l.id
                GROUP BY l.id
                ORDER BY l.created_at DESC
                """
            )

            rows = cur.fetchall()

    return {
        "layers": [
            {
                **row,
                "id": str(row["id"]),
                "survey_id": (
                    str(row["survey_id"])
                    if row["survey_id"]
                    else None
                ),
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                ),
                "parcel_count": int(
                    row["parcel_count"] or 0
                ),
            }
            for row in rows
        ]
    }

@router.post("/import")
async def import_cadastral(
    file: UploadFile = File(...),
    layer_type: str = Form(...),
    name: str = Form(...),
    survey_id: str | None = Form(None),
    crs_override: str | None = Form(None),
):
    suffix = Path(
        file.filename or ""
    ).suffix.lower()

    if suffix not in {
        ".geojson",
        ".json",
        ".gpkg",
        ".zip",
        ".shp",
    }:
        raise HTTPException(
            status_code=400,
            detail=(
                "Supported formats: GeoJSON, "
                "GeoPackage, Shapefile ZIP."
            ),
        )

    parsed_survey_id = parse_uuid(survey_id)

    temp_dir = Path(
        tempfile.mkdtemp(
            prefix="helios_cadastral_"
        )
    )

    try:
        target = (
            temp_dir
            / (
                file.filename
                or f"cadastral{suffix}"
            )
        )

        with target.open("wb") as output:
            while True:
                chunk = await file.read(1024 * 1024)

                if not chunk:
                    break

                output.write(chunk)

        try:
            result = import_layer(
                target,
                file.filename or target.name,
                layer_type,
                name,
                parsed_survey_id,
                crs_override,
            )

        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            )

        return {
            "success": True,
            **result,
        }

    finally:
        shutil.rmtree(
            temp_dir,
            ignore_errors=True,
        )

def load_parcels(layer_id, layer_type):
    table = (
        "old_parcels"
        if layer_type == "OLD"
        else "new_parcels"
    )

    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                    id,
                    parcel_id,
                    ST_AsBinary(geometry) AS geometry,
                    area,
                    perimeter
                FROM {table}
                WHERE layer_id=%s
                ORDER BY parcel_id
                """,
                (layer_id,),
            )

            rows = cur.fetchall()

    result = []

    for row in rows:
        result.append(
            {
                "id": row["id"],
                "parcel_id": row["parcel_id"],
                "geometry": wkb.loads(
                    bytes(row["geometry"])
                ),
                "area": float(row["area"] or 0),
                "perimeter": float(
                    row["perimeter"] or 0
                ),
            }
        )

    return result

def run_comparison(
    old_layer_id,
    new_layer_id,
    survey_id=None,
):
    old = load_parcels(
        old_layer_id,
        "OLD",
    )

    new = load_parcels(
        new_layer_id,
        "NEW",
    )

    if not old:
        raise ValueError(
            "Old cadastral layer contains no parcels."
        )

    if not new:
        raise ValueError(
            "New cadastral layer contains no parcels."
        )

    all_geometry = [
        item["geometry"]
        for item in old + new
    ]

    combined = unary_union(all_geometry)

    centroid = combined.centroid

    lon = centroid.x
    lat = centroid.y

    if -80 <= lat <= 84:
        zone = int((lon + 180) / 6) + 1
        projected_crs = (
            f"EPSG:{32600 + zone}"
            if lat >= 0
            else f"EPSG:{32700 + zone}"
        )
    else:
        projected_crs = "EPSG:6933"

    new_geometries = [
        item["geometry"]
        for item in new
    ]

    tree = STRtree(new_geometries)

    candidates = defaultdict(list)

    new_by_id = {
        str(item["parcel_id"]): item
        for item in new
    }

    used_pairs = set()

    for old_item in old:
        pid = str(old_item["parcel_id"])

        new_item = new_by_id.get(pid)

        if new_item:
            pair = (
                old_item["id"],
                new_item["id"],
            )

            candidates[
                old_item["id"]
            ].append(
                (
                    new_item,
                    True,
                )
            )

            used_pairs.add(pair)

    for old_item in old:
        old_geom = old_item["geometry"]

        candidate_indexes = tree.query(
            old_geom
        )

        for index in candidate_indexes:
            new_item = new[int(index)]

            pair = (
                old_item["id"],
                new_item["id"],
            )

            if pair in used_pairs:
                continue

            intersection = (
                old_geom.intersection(
                    new_item["geometry"]
                )
            )

            if intersection.is_empty:
                continue

            old_projected = projected_geometry(
                old_geom,
                "EPSG:4326",
                projected_crs,
            )

            new_projected = projected_geometry(
                new_item["geometry"],
                "EPSG:4326",
                projected_crs,
            )

            intersection_projected = (
                old_projected.intersection(
                    new_projected
                )
            )

            intersection_area = (
                intersection_projected.area
            )

            if intersection_area <= 0:
                continue

            old_ratio = (
                intersection_area
                / old_projected.area
                * 100
            )

            new_ratio = (
                intersection_area
                / new_projected.area
                * 100
            )

            if max(
                old_ratio,
                new_ratio,
            ) >= MATCH_OVERLAP_PERCENT:
                candidates[
                    old_item["id"]
                ].append(
                    (
                        new_item,
                        False,
                    )
                )

                used_pairs.add(pair)

    old_to_new = defaultdict(list)
    new_to_old = defaultdict(list)

    for old_id, items in candidates.items():
        for new_item, direct in items:
            old_to_new[old_id].append(
                new_item["id"]
            )

            new_to_old[
                new_item["id"]
            ].append(old_id)

    comparisons = []

    matched_old = set()
    matched_new = set()

    for old_item in old:
        pairs = candidates.get(
            old_item["id"],
            [],
        )

        for new_item, direct in pairs:

            matched_old.add(
                old_item["id"]
            )

            matched_new.add(
                new_item["id"]
            )

            split = (
                len(
                    old_to_new[
                        old_item["id"]
                    ]
                ) > 1
            )

            merge = (
                len(
                    new_to_old[
                        new_item["id"]
                    ]
                ) > 1
            )

            metrics = geometry_metrics(
                old_item["geometry"],
                new_item["geometry"],
                projected_crs,
            )

            change_type = classify_change(
                metrics,
                split=split,
                merge=merge,
            )

            comparisons.append(
                {
                    "old": old_item,
                    "new": new_item,
                    "metrics": metrics,
                    "change_type": change_type,
                    "confidence": confidence_score(
                        metrics,
                        direct_id=direct,
                    ),
                }
            )

    for old_item in old:
        if old_item["id"] in matched_old:
            continue

        comparisons.append(
            {
                "old": old_item,
                "new": None,
                "metrics": None,
                "change_type": "REMOVED_PARCEL",
                "confidence": 1.0,
            }
        )

    for new_item in new:
        if new_item["id"] in matched_new:
            continue

        comparisons.append(
            {
                "old": None,
                "new": new_item,
                "metrics": None,
                "change_type": "NEW_PARCEL",
                "confidence": 1.0,
            }
        )

    run_id = uuid.uuid4()

    summary = {
        "old_parcels": len(old),
        "new_parcels": len(new),
        "matched_parcels": len(
            [
                x
                for x in comparisons
                if x["old"] and x["new"]
            ]
        ),
        "changed_parcels": 0,
        "unchanged_parcels": 0,
        "splits": 0,
        "merges": 0,
        "new_parcels": 0,
        "removed_parcels": 0,
        "area_increase": 0,
        "area_decrease": 0,
        "old_total_area": sum(
            x["area"]
            for x in old
        ),
        "new_total_area": sum(
            x["area"]
            for x in new
        ),
    }

    summary[
        "total_area_difference"
    ] = (
        summary["new_total_area"]
        - summary["old_total_area"]
    )

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                INSERT INTO comparison_runs
                (
                    id,
                    old_layer_id,
                    new_layer_id,
                    survey_id,
                    status,
                    thresholds
                )
                VALUES
                (
                    %s,%s,%s,%s,'COMPLETED',%s
                )
                """,
                (
                    run_id,
                    old_layer_id,
                    new_layer_id,
                    survey_id,
                    Jsonb(
                        {
                            "area_tolerance_percent":
                                AREA_TOLERANCE_PERCENT,
                            "boundary_tolerance_meters":
                                BOUNDARY_TOLERANCE_METERS,
                            "overlap_tolerance_percent":
                                OVERLAP_TOLERANCE_PERCENT,
                            "match_overlap_percent":
                                MATCH_OVERLAP_PERCENT,
                        }
                    ),
                ),
            )

            for comparison in comparisons:

                old_item = comparison["old"]
                new_item = comparison["new"]
                metrics = comparison["metrics"]

                comparison_id = uuid.uuid4()

                if metrics:
                    values = (
                        metrics["old_area"],
                        metrics["new_area"],
                        metrics["area_difference"],
                        metrics[
                            "area_change_percent"
                        ],
                        metrics["old_perimeter"],
                        metrics["new_perimeter"],
                        metrics[
                            "perimeter_difference"
                        ],
                        metrics[
                            "intersection_area"
                        ],
                        metrics["union_area"],
                        metrics["overlap_percent"],
                        metrics["centroid_shift"],
                        metrics[
                            "boundary_mean_difference"
                        ],
                        metrics[
                            "boundary_max_difference"
                        ],
                    )
                else:
                    values = (
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                        None,
                    )

                cur.execute(
                    """
                    INSERT INTO parcel_comparisons
                    (
                        id,
                        old_parcel_id,
                        new_parcel_id,
                        old_area,
                        new_area,
                        area_difference,
                        area_change_percent,
                        old_perimeter,
                        new_perimeter,
                        perimeter_difference,
                        intersection_area,
                        union_area,
                        overlap_percent,
                        centroid_shift,
                        boundary_mean_difference,
                        boundary_max_difference,
                        change_type,
                        confidence,
                        review_status
                    )
                    VALUES
                    (
                        %s,%s,%s,
                        %s,%s,%s,%s,
                        %s,%s,%s,
                        %s,%s,%s,
                        %s,%s,%s,
                        %s,%s,'PENDING'
                    )
                    """,
                    (
                        comparison_id,
                        old_item["id"]
                        if old_item
                        else None,
                        new_item["id"]
                        if new_item
                        else None,
                        *values,
                        comparison[
                            "change_type"
                        ],
                        comparison[
                            "confidence"
                        ],
                    ),
                )

                comparison[
                    "comparison_id"
                ] = comparison_id

                ctype = comparison[
                    "change_type"
                ]

                if ctype == "NO_SIGNIFICANT_CHANGE":
                    summary[
                        "unchanged_parcels"
                    ] += 1
                else:
                    summary[
                        "changed_parcels"
                    ] += 1

                if ctype == "PARCEL_SPLIT":
                    summary["splits"] += 1

                if ctype == "PARCEL_MERGE":
                    summary["merges"] += 1

                if ctype == "NEW_PARCEL":
                    summary["new_parcels"] += 1

                if ctype == "REMOVED_PARCEL":
                    summary["removed_parcels"] += 1

                if ctype == "AREA_INCREASE":
                    summary["area_increase"] += 1

                if ctype == "AREA_DECREASE":
                    summary["area_decrease"] += 1

            cur.execute(
                """
                UPDATE comparison_runs
                SET summary=%s
                WHERE id=%s
                """,
                (
                    Jsonb(summary),
                    run_id,
                ),
            )

            conn.commit()

    return {
        "run_id": str(run_id),
        "summary": summary,
        "projected_crs": projected_crs,
        "comparisons": [
            {
                "id": str(c["comparison_id"]),
                "old_parcel_code": c["old"]["parcel_id"] if c["old"] else None,
                "new_parcel_code": c["new"]["parcel_id"] if c["new"] else None,
                "old_area": c["metrics"]["old_area"] if c["metrics"] else (c["old"]["area"] if c["old"] else None),
                "new_area": c["metrics"]["new_area"] if c["metrics"] else (c["new"]["area"] if c["new"] else None),
                "area_difference": c["metrics"]["area_difference"] if c["metrics"] else None,
                "area_change_percent": c["metrics"]["area_change_percent"] if c["metrics"] else None,
                "old_perimeter": c["metrics"]["old_perimeter"] if c["metrics"] else (c["old"]["perimeter"] if c["old"] else None),
                "new_perimeter": c["metrics"]["new_perimeter"] if c["metrics"] else (c["new"]["perimeter"] if c["new"] else None),
                "perimeter_difference": c["metrics"]["perimeter_difference"] if c["metrics"] else None,
                "intersection_area": c["metrics"]["intersection_area"] if c["metrics"] else None,
                "union_area": c["metrics"]["union_area"] if c["metrics"] else None,
                "overlap_percent": c["metrics"]["overlap_percent"] if c["metrics"] else None,
                "centroid_shift": c["metrics"]["centroid_shift"] if c["metrics"] else None,
                "boundary_mean_difference": c["metrics"]["boundary_mean_difference"] if c["metrics"] else None,
                "boundary_max_difference": c["metrics"]["boundary_max_difference"] if c["metrics"] else None,
                "change_type": c["change_type"],
                "confidence": c["confidence"],
            }
            for c in comparisons
        ],
    }

@router.post("/compare")
def compare_cadastral(payload: dict):
    try:
        old_layer_id = parse_uuid(
            payload.get("old_layer_id")
        )

        new_layer_id = parse_uuid(
            payload.get("new_layer_id")
        )

        survey_id = parse_uuid(
            payload.get("survey_id")
        )

        if not old_layer_id or not new_layer_id:
            raise HTTPException(
                status_code=400,
                detail=(
                    "old_layer_id and "
                    "new_layer_id are required."
                ),
            )

        return run_comparison(
            old_layer_id,
            new_layer_id,
            survey_id,
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        )

@router.get("/comparison/{run_id}")
def get_comparison(run_id: str):
    parsed = parse_uuid(run_id)

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT *
                FROM comparison_runs
                WHERE id=%s
                """,
                (parsed,),
            )

            run = cur.fetchone()

            if not run:
                raise HTTPException(
                    status_code=404,
                    detail="Comparison run not found.",
                )

            cur.execute(
                """
                SELECT
                    pc.*,
                    o.parcel_id AS old_parcel_code,
                    n.parcel_id AS new_parcel_code
                FROM parcel_comparisons pc
                LEFT JOIN old_parcels o
                    ON o.id=pc.old_parcel_id
                LEFT JOIN new_parcels n
                    ON n.id=pc.new_parcel_id
                WHERE pc.id IN
                (
                    SELECT pc2.id
                    FROM parcel_comparisons pc2
                    WHERE pc2.created_at >=
                    (
                        SELECT created_at
                        FROM comparison_runs
                        WHERE id=%s
                    )
                )
                ORDER BY pc.created_at
                """,
                (parsed,),
            )

            rows = cur.fetchall()

    return {
        "run_id": str(parsed),
        "summary": run["summary"] or {},
        "thresholds": run["thresholds"] or {},
        "comparisons": [
            {
                **row,
                "id": str(row["id"]),
                "old_parcel_id": (
                    str(row["old_parcel_id"])
                    if row["old_parcel_id"]
                    else None
                ),
                "new_parcel_id": (
                    str(row["new_parcel_id"])
                    if row["new_parcel_id"]
                    else None
                ),
            }
            for row in rows
        ],
    }

@router.get("/comparison/{run_id}/geojson")
def comparison_geojson(run_id: str):
    parsed = parse_uuid(run_id)

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    old_layer_id,
                    new_layer_id
                FROM comparison_runs
                WHERE id=%s
                """,
                (parsed,),
            )

            run = cur.fetchone()

            if not run:
                raise HTTPException(
                    status_code=404,
                    detail="Comparison run not found.",
                )

            cur.execute(
                """
                SELECT
                    id,
                    parcel_id,
                    ST_AsGeoJSON(geometry) AS geometry
                FROM old_parcels
                WHERE layer_id=%s
                """,
                (run["old_layer_id"],),
            )

            old_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                    id,
                    parcel_id,
                    ST_AsGeoJSON(geometry) AS geometry
                FROM new_parcels
                WHERE layer_id=%s
                """,
                (run["new_layer_id"],),
            )

            new_rows = cur.fetchall()

            cur.execute(
                """
                SELECT
                    pc.id,
                    pc.old_parcel_id,
                    pc.new_parcel_id,
                    pc.change_type,
                    pc.area_difference,
                    pc.area_change_percent,
                    pc.overlap_percent,
                    pc.centroid_shift,
                    pc.boundary_mean_difference,
                    pc.boundary_max_difference,
                    ST_AsGeoJSON(o.geometry)
                        AS old_geometry,
                    ST_AsGeoJSON(n.geometry)
                        AS new_geometry
                FROM parcel_comparisons pc
                LEFT JOIN old_parcels o
                    ON o.id=pc.old_parcel_id
                LEFT JOIN new_parcels n
                    ON n.id=pc.new_parcel_id
                WHERE pc.created_at >=
                (
                    SELECT created_at
                    FROM comparison_runs
                    WHERE id=%s
                )
                """,
                (parsed,),
            )

            comparison_rows = cur.fetchall()

    features = []

    for row in old_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(
                    row["geometry"]
                ),
                "properties": {
                    "side": "OLD",
                    "parcel_id": row[
                        "parcel_id"
                    ],
                },
            }
        )

    for row in new_rows:
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(
                    row["geometry"]
                ),
                "properties": {
                    "side": "NEW",
                    "parcel_id": row[
                        "parcel_id"
                    ],
                },
            }
        )

    for row in comparison_rows:
        old_geometry = (
            shape(
                json.loads(
                    row["old_geometry"]
                )
            )
            if row["old_geometry"]
            else None
        )

        new_geometry = (
            shape(
                json.loads(
                    row["new_geometry"]
                )
            )
            if row["new_geometry"]
            else None
        )

        if old_geometry and new_geometry:
            try:
                change_geometry = (
                    old_geometry.symmetric_difference(
                        new_geometry
                    )
                )
            except Exception:
                change_geometry = old_geometry

        else:
            change_geometry = (
                old_geometry
                or new_geometry
            )

        if (
            change_geometry is None
            or change_geometry.is_empty
        ):
            continue

        features.append(
            {
                "type": "Feature",
                "geometry": mapping(
                    change_geometry
                ),
                "properties": {
                    "side": "CHANGE",
                    "comparison_id": str(
                        row["id"]
                    ),
                    "change_type": row[
                        "change_type"
                    ],
                    "area_difference": row[
                        "area_difference"
                    ],
                    "area_change_percent": row[
                        "area_change_percent"
                    ],
                    "overlap_percent": row[
                        "overlap_percent"
                    ],
                    "centroid_shift": row[
                        "centroid_shift"
                    ],
                    "boundary_mean_difference": row[
                        "boundary_mean_difference"
                    ],
                    "boundary_max_difference": row[
                        "boundary_max_difference"
                    ],
                },
            }
        )

    return {
        "type": "FeatureCollection",
        "features": features,
    }

def generate_report(run_id):
    parsed = parse_uuid(run_id)

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT *
                FROM comparison_runs
                WHERE id=%s
                """,
                (parsed,),
            )

            run = cur.fetchone()

            if not run:
                raise HTTPException(
                    status_code=404,
                    detail="Comparison run not found.",
                )

            cur.execute(
                """
                SELECT
                    pc.*,
                    o.parcel_id AS old_code,
                    n.parcel_id AS new_code
                FROM parcel_comparisons pc
                LEFT JOIN old_parcels o
                    ON o.id=pc.old_parcel_id
                LEFT JOIN new_parcels n
                    ON n.id=pc.new_parcel_id
                WHERE pc.created_at >=
                (
                    SELECT created_at
                    FROM comparison_runs
                    WHERE id=%s
                )
                ORDER BY pc.created_at
                """,
                (parsed,),
            )

            comparisons = cur.fetchall()

    report_dir = (
        Path(__file__).resolve().parents[2]
        / "storage"
        / "cadastral_reports"
    )

    report_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    pdf_path = (
        report_dir
        / f"cadastral_comparison_{parsed}.pdf"
    )

    map_path = (
        report_dir
        / f"cadastral_comparison_{parsed}.png"
    )

    old_geometries = []
    new_geometries = []

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    ST_AsBinary(geometry) AS geometry
                FROM old_parcels
                WHERE layer_id=%s
                """,
                (run["old_layer_id"],),
            )

            old_geometries = [
                wkb.loads(bytes(row["geometry"]))
                for row in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT
                    ST_AsBinary(geometry) AS geometry
                FROM new_parcels
                WHERE layer_id=%s
                """,
                (run["new_layer_id"],),
            )

            new_geometries = [
                wkb.loads(bytes(row["geometry"]))
                for row in cur.fetchall()
            ]

    fig, ax = plt.subplots(
        figsize=(11, 7)
    )

    for geom in old_geometries:
        if hasattr(geom, "geoms"):
            for poly in geom.geoms:
                x, y = poly.exterior.xy
                ax.plot(
                    x,
                    y,
                    linewidth=1.8,
                    label="Old Cadastre",
                )
        else:
            x, y = geom.exterior.xy
            ax.plot(
                x,
                y,
                linewidth=1.8,
                label="Old Cadastre",
            )

    for geom in new_geometries:
        if hasattr(geom, "geoms"):
            for poly in geom.geoms:
                x, y = poly.exterior.xy
                ax.plot(
                    x,
                    y,
                    linestyle="--",
                    linewidth=1.8,
                    label="New Cadastre",
                )
        else:
            x, y = geom.exterior.xy
            ax.plot(
                x,
                y,
                linestyle="--",
                linewidth=1.8,
                label="New Cadastre",
            )

    handles, labels = ax.get_legend_handles_labels()

    unique = dict(
        zip(labels, handles)
    )

    ax.legend(
        unique.values(),
        unique.keys(),
    )

    ax.set_title(
        "HELIOS-LAND — Cadastral Comparison"
    )

    ax.set_aspect("equal")

    ax.grid(
        True,
        alpha=0.2,
    )

    fig.tight_layout()

    fig.savefig(
        map_path,
        dpi=180,
    )

    plt.close(fig)

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
        Image,
    )

    styles = getSampleStyleSheet()

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    story = []

    story.append(
        Paragraph(
            "HELIOS-LAND",
            styles["Title"],
        )
    )

    story.append(
        Paragraph(
            "Cadastral Resurvey Comparison Report",
            styles["Heading1"],
        )
    )

    story.append(
        Paragraph(
            f"Comparison Run: {parsed}",
            styles["Normal"],
        )
    )

    story.append(Spacer(1, 8))

    summary = run["summary"] or {}

    summary_data = [
        ["Metric", "Value"],
        [
            "Old parcels",
            str(summary.get("old_parcels", 0)),
        ],
        [
            "New parcels",
            str(summary.get("new_parcels", 0)),
        ],
        [
            "Matched",
            str(summary.get("matched_parcels", 0)),
        ],
        [
            "Changed",
            str(summary.get("changed_parcels", 0)),
        ],
        [
            "Unchanged",
            str(summary.get("unchanged_parcels", 0)),
        ],
        [
            "Old total area",
            f"{summary.get('old_total_area', 0):.2f} m²",
        ],
        [
            "New total area",
            f"{summary.get('new_total_area', 0):.2f} m²",
        ],
        [
            "Area difference",
            f"{summary.get('total_area_difference', 0):+.2f} m²",
        ],
    ]

    table = Table(
        summary_data,
        colWidths=[80 * mm, 80 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                (
                    "BACKGROUND",
                    (0, 0),
                    (-1, 0),
                    colors.HexColor("#17324d"),
                ),
                (
                    "TEXTCOLOR",
                    (0, 0),
                    (-1, 0),
                    colors.white,
                ),
                (
                    "GRID",
                    (0, 0),
                    (-1, -1),
                    0.5,
                    colors.grey,
                ),
                (
                    "FONTNAME",
                    (0, 0),
                    (-1, 0),
                    "Helvetica-Bold",
                ),
                (
                    "PADDING",
                    (0, 0),
                    (-1, -1),
                    5,
                ),
            ]
        )
    )

    story.append(table)

    story.append(Spacer(1, 10))

    if map_path.exists():
        story.append(
            Image(
                str(map_path),
                width=175 * mm,
                height=110 * mm,
            )
        )

    story.append(
        Spacer(1, 10)
    )

    story.append(
        Paragraph(
            "Parcel-wise comparison",
            styles["Heading2"],
        )
    )

    rows = [
        [
            "Old ID",
            "New ID",
            "Old Area",
            "New Area",
            "Difference",
            "Change",
        ]
    ]

    for row in comparisons:

        rows.append(
            [
                row["old_code"] or "—",
                row["new_code"] or "—",
                (
                    f"{row['old_area']:.2f}"
                    if row["old_area"] is not None
                    else "—"
                ),
                (
                    f"{row['new_area']:.2f}"
                    if row["new_area"] is not None
                    else "—"
                ),
                (
                    f"{row['area_difference']:+.2f}"
                    if row["area_difference"] is not None
                    else "—"
                ),
                row["change_type"],
            ]
        )

    parcel_table = Table(
        rows,
        repeatRows=1,
        colWidths=[
            25 * mm,
            25 * mm,
            28 * mm,
            28 * mm,
            28 * mm,
            40 * mm,
        ],
    )

    parcel_table.setStyle(
        TableStyle(
            [
                (
                    "BACKGROUND",
                    (0, 0),
                    (-1, 0),
                    colors.HexColor("#17324d"),
                ),
                (
                    "TEXTCOLOR",
                    (0, 0),
                    (-1, 0),
                    colors.white,
                ),
                (
                    "GRID",
                    (0, 0),
                    (-1, -1),
                    0.4,
                    colors.grey,
                ),
                (
                    "FONTSIZE",
                    (0, 0),
                    (-1, -1),
                    7,
                ),
                (
                    "PADDING",
                    (0, 0),
                    (-1, -1),
                    4,
                ),
            ]
        )
    )

    story.append(parcel_table)

    story.append(
        Spacer(1, 12)
    )

    story.append(
        Paragraph(
            "Analytical results are calculated using configured "
            "geospatial thresholds and are intended for survey "
            "review. They do not by themselves constitute a "
            "legal cadastral determination.",
            styles["Normal"],
        )
    )

    doc.build(story)

    return pdf_path

@router.get("/report/{run_id}")
def report(run_id: str):
    path = generate_report(run_id)

    return FileResponse(
        path=str(path),
        media_type="application/pdf",
        filename=path.name,
    )

@router.post(
    "/comparison/{run_id}/verification"
)
def create_verification_case(
    run_id: str,
    payload: dict,
):
    parsed_run = parse_uuid(run_id)

    comparison_id = parse_uuid(
        payload.get("comparison_id")
    )

    with db() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT id
                FROM comparison_runs
                WHERE id=%s
                """,
                (parsed_run,),
            )

            if not cur.fetchone():
                raise HTTPException(
                    status_code=404,
                    detail="Comparison run not found.",
                )

            case_id = uuid.uuid4()

            cur.execute(
                """
                INSERT INTO cadastral_verification_cases
                (
                    id,
                    comparison_run_id,
                    comparison_id,
                    status,
                    officer_name,
                    review_note
                )
                VALUES
                (
                    %s,%s,%s,'PENDING',%s,%s
                )
                """,
                (
                    case_id,
                    parsed_run,
                    comparison_id,
                    payload.get("officer_name"),
                    payload.get("review_note"),
                ),
            )

            conn.commit()

    return {
        "success": True,
        "case_id": str(case_id),
        "status": "PENDING",
    }

@router.get("/verification-cases")
def get_verification_cases():
    with db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    comparison_run_id,
                    comparison_id,
                    status,
                    officer_name,
                    review_note,
                    created_at,
                    reviewed_at
                FROM cadastral_verification_cases
                ORDER BY created_at DESC
                """
            )

            rows = cur.fetchall()

    return {
        "cases": [
            {
                **row,
                "id": str(row["id"]),
                "comparison_run_id": str(
                    row["comparison_run_id"]
                ),
                "comparison_id": (
                    str(row["comparison_id"])
                    if row["comparison_id"]
                    else None
                ),
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                ),
                "reviewed_at": (
                    row["reviewed_at"].isoformat()
                    if row["reviewed_at"]
                    else None
                ),
            }
            for row in rows
        ]
    }

@router.post(
    "/analysis/{parcel_id}/compare"
)
def legacy_compare(parcel_id: str):
    return {
        "message": (
            "Use POST /api/cadastral/compare "
            "with old_layer_id and new_layer_id."
        ),
        "parcel_id": parcel_id,
    }
