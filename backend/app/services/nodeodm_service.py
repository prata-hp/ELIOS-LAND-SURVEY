import json
import shutil
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

NODEODM_URL = "http://localhost:3000"

def _multipart_field(boundary: str, name: str, value: str) -> bytes:
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"\r\n'
        "\r\n"
        f"{value}\r\n"
    ).encode()

def _multipart_file(
    boundary: str,
    field_name: str,
    file_path: Path,
    content_type: str = "application/octet-stream",
) -> bytes:
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; '
        f'filename="{file_path.name}"\r\n'
        f"Content-Type: {content_type}\r\n"
        "\r\n"
    ).encode()

    return header + file_path.read_bytes() + b"\r\n"

def get_nodeodm_info() -> dict:
    url = f"{NODEODM_URL}/info"

    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))

def create_nodeodm_task(
    image_paths: list[str],
    gcp_path: str | None = None,
    name: str | None = None,
) -> dict:
    if not image_paths:
        raise ValueError("At least one image is required.")

    boundary = "----ELIOSLANDBoundary"
    body_parts: list[bytes] = []

    body_parts.append(
        _multipart_field(
            boundary,
            "name",
            name or "ELIOS-LAND Survey",
        )
    )

    options = [
        {
            "name": "no-gpu",
            "value": True,
        },
        {
            "name": "max-concurrency",
            "value": 4,
        },
        {
            "name": "feature-quality",
            "value": "medium",
        },
        {
            "name": "pc-quality",
            "value": "medium",
        },
        {
            "name": "dsm",
            "value": True,
        },
        {
            "name": "dtm",
            "value": False,
        },
        {
            "name": "pc-ept",
            "value": False,
        },
        {
            "name": "gltf",
            "value": False,
        },
        {
            "name": "cog",
            "value": False,
        },
    ]

    if gcp_path is not None:
        gcp_file = Path(gcp_path)

        if not gcp_file.exists():
            raise FileNotFoundError(
                f"GCP file not found: {gcp_file}"
            )

        if gcp_file.suffix.lower() != ".txt":
            raise ValueError(
                "NodeODM GCP file must use the .txt extension."
            )

        options.insert(
            0,
            {
                "name": "gcp",
                "value": gcp_file.name,
            },
        )

    body_parts.append(
        _multipart_field(
            boundary,
            "options",
            json.dumps(options),
        )
    )

    for image_path in image_paths:
        path = Path(image_path)

        if not path.exists():
            raise FileNotFoundError(
                f"Image not found: {path}"
            )

        body_parts.append(
            _multipart_file(
                boundary=boundary,
                field_name="images",
                file_path=path,
            )
        )

    if gcp_path is not None:
        gcp_file = Path(gcp_path)

        body_parts.append(
            _multipart_file(
                boundary=boundary,
                field_name="images",
                file_path=gcp_file,
                content_type="text/plain",
            )
        )

    body_parts.append(
        f"--{boundary}--\r\n".encode()
    )

    body = b"".join(body_parts)

    request = urllib.request.Request(
        f"{NODEODM_URL}/task/new",
        data=body,
        method="POST",
        headers={
            "Content-Type": (
                f"multipart/form-data; boundary={boundary}"
            )
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=120,
        ) as response:
            return json.loads(
                response.read().decode("utf-8")
            )

    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(
            "utf-8",
            errors="replace",
        )

        raise RuntimeError(
            f"NodeODM rejected task: "
            f"HTTP {exc.code}: {detail}"
        ) from exc

def get_nodeodm_task_info(task_uuid: str) -> dict:
    url = f"{NODEODM_URL}/task/{task_uuid}/info"

    with urllib.request.urlopen(
        url,
        timeout=30,
    ) as response:
        return json.loads(
            response.read().decode("utf-8")
        )

def get_nodeodm_task_output(
    task_uuid: str,
    line: int = 0,
) -> str:
    url = (
        f"{NODEODM_URL}/task/{task_uuid}"
        f"/output?line={line}"
    )

    with urllib.request.urlopen(
        url,
        timeout=30,
    ) as response:
        return response.read().decode(
            "utf-8",
            errors="replace",
        )

def download_nodeodm_all(
    task_uuid: str,
    destination: str | Path,
) -> Path:
    destination = Path(destination)
    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    url = (
        f"{NODEODM_URL}/task/{task_uuid}"
        "/download/all.zip"
    )

    try:
        with urllib.request.urlopen(
            url,
            timeout=600,
        ) as response:

            content_type = (
                response.headers.get(
                    "Content-Type",
                    "",
                )
                .lower()
            )

            data = response.read()

    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(
            "utf-8",
            errors="replace",
        )

        raise RuntimeError(
            f"NodeODM all.zip download failed: "
            f"HTTP {exc.code}: {detail}"
        ) from exc

    if "application/zip" not in content_type:
        raise RuntimeError(
            "NodeODM returned a non-ZIP response "
            f"for all.zip: {content_type}"
        )

    if not data.startswith(b"PK"):
        raise RuntimeError(
            "NodeODM all.zip response is not a valid ZIP archive."
        )

    destination.write_bytes(data)

    return destination

def extract_nodeodm_products(
    archive_path: str | Path,
    output_root: str | Path,
) -> dict[str, Path]:
    archive_path = Path(archive_path)
    output_root = Path(output_root)

    output_root.mkdir(
        parents=True,
        exist_ok=True,
    )

    orthomosaic_dir = (
        output_root / "orthomosaic"
    )

    elevation_dir = (
        output_root / "elevation"
    )

    point_cloud_dir = (
        output_root / "point_cloud"
    )

    orthomosaic_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    elevation_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    point_cloud_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    orthomosaic_destination = (
        orthomosaic_dir / "orthomosaic.tif"
    )

    dsm_destination = (
        elevation_dir / "dsm.tif"
    )

    with zipfile.ZipFile(
        archive_path,
        "r",
    ) as archive:

        names = set(
            archive.namelist()
        )

        orthophoto_source = (
            "odm_orthophoto/"
            "odm_orthophoto.tif"
        )

        dsm_source = (
            "odm_dem/"
            "dsm.tif"
        )

        if orthophoto_source not in names:
            raise RuntimeError(
                "NodeODM archive does not contain "
                f"{orthophoto_source}"
            )

        if dsm_source not in names:
            raise RuntimeError(
                "NodeODM archive does not contain "
                f"{dsm_source}"
            )

        with archive.open(
            orthophoto_source,
            "r",
        ) as source, open(
            orthomosaic_destination,
            "wb",
        ) as destination:
            shutil.copyfileobj(
                source,
                destination,
            )

        with archive.open(
            dsm_source,
            "r",
        ) as source, open(
            dsm_destination,
            "wb",
        ) as destination:
            shutil.copyfileobj(
                source,
                destination,
            )

        laz_members = [
            name
            for name in names
            if name.startswith(
                "entwine_pointcloud/ept-data/"
            )
            and name.lower().endswith(".laz")
        ]

        if not laz_members:
            raise RuntimeError(
                "NodeODM archive does not contain "
                "Entwine LAZ point-cloud tiles."
            )

        ept_destination = (
            point_cloud_dir / "entwine_pointcloud"
        )

        ept_destination.mkdir(
            parents=True,
            exist_ok=True,
        )

        for member in names:
            if not member.startswith(
                "entwine_pointcloud/"
            ):
                continue

            if member.endswith("/"):
                continue

            relative_path = Path(
                member
            ).relative_to(
                "entwine_pointcloud"
            )

            destination = (
                ept_destination
                / relative_path
            )

            destination.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            with archive.open(
                member,
                "r",
            ) as source, open(
                destination,
                "wb",
            ) as target:
                shutil.copyfileobj(
                    source,
                    target,
                )

    return {
        "orthomosaic": orthomosaic_destination,
        "dsm": dsm_destination,
        "point_cloud": ept_destination,
    }
