CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cadastral_layers (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    layer_type VARCHAR(20) NOT NULL,
    source VARCHAR(500),
    source_format VARCHAR(50),
    crs VARCHAR(100),
    survey_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cadastral_layers_type
ON cadastral_layers(layer_type);

CREATE TABLE IF NOT EXISTS old_parcels (
    id UUID PRIMARY KEY,
    layer_id UUID NOT NULL REFERENCES cadastral_layers(id) ON DELETE CASCADE,
    parcel_id VARCHAR(255) NOT NULL,
    geometry geometry(MultiPolygon, 4326),
    source VARCHAR(500),
    crs VARCHAR(100),
    area DOUBLE PRECISION,
    perimeter DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_old_parcels_layer
ON old_parcels(layer_id);

CREATE INDEX IF NOT EXISTS idx_old_parcels_geometry
ON old_parcels
USING GIST(geometry);

CREATE TABLE IF NOT EXISTS new_parcels (
    id UUID PRIMARY KEY,
    layer_id UUID NOT NULL REFERENCES cadastral_layers(id) ON DELETE CASCADE,
    parcel_id VARCHAR(255) NOT NULL,
    geometry geometry(MultiPolygon, 4326),
    source VARCHAR(500),
    crs VARCHAR(100),
    survey_id UUID NULL,
    area DOUBLE PRECISION,
    perimeter DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_new_parcels_layer
ON new_parcels(layer_id);

CREATE INDEX IF NOT EXISTS idx_new_parcels_geometry
ON new_parcels
USING GIST(geometry);

CREATE TABLE IF NOT EXISTS parcel_comparisons (
    id UUID PRIMARY KEY,

    old_parcel_id UUID NULL REFERENCES old_parcels(id) ON DELETE SET NULL,
    new_parcel_id UUID NULL REFERENCES new_parcels(id) ON DELETE SET NULL,

    old_area DOUBLE PRECISION,
    new_area DOUBLE PRECISION,

    area_difference DOUBLE PRECISION,
    area_change_percent DOUBLE PRECISION,

    old_perimeter DOUBLE PRECISION,
    new_perimeter DOUBLE PRECISION,
    perimeter_difference DOUBLE PRECISION,

    intersection_area DOUBLE PRECISION,
    union_area DOUBLE PRECISION,
    overlap_percent DOUBLE PRECISION,

    centroid_shift DOUBLE PRECISION,

    boundary_mean_difference DOUBLE PRECISION,
    boundary_max_difference DOUBLE PRECISION,

    change_type VARCHAR(50),
    confidence DOUBLE PRECISION,

    review_status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    review_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parcel_comparisons_old
ON parcel_comparisons(old_parcel_id);

CREATE INDEX IF NOT EXISTS idx_parcel_comparisons_new
ON parcel_comparisons(new_parcel_id);

CREATE INDEX IF NOT EXISTS idx_parcel_comparisons_change_type
ON parcel_comparisons(change_type);
