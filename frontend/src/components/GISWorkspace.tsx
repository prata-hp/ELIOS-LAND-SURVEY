import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import Map from 'ol/Map'
import View from 'ol/View'
import Feature from 'ol/Feature'
import GeoJSON from 'ol/format/GeoJSON'
import Draw from 'ol/interaction/Draw'
import Modify from 'ol/interaction/Modify'
import Select from 'ol/interaction/Select'
import Snap from 'ol/interaction/Snap'
import WebGLTileLayer from 'ol/layer/WebGLTile'
import VectorLayer from 'ol/layer/Vector'
import GeoTIFF from 'ol/source/GeoTIFF'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Stroke from 'ol/style/Stroke'
import Fill from 'ol/style/Fill'
import CircleStyle from 'ol/style/Circle'
import {fromLonLat, transform} from 'ol/proj'
import {getArea, getLength} from 'ol/sphere'

import 'ol/ol.css'

import {
  calculateField,
  createFeature,
  createGISLayer,
  deleteFeature,
  exportLayerUrl,
  getGISLayers,
  getLayerGeoJSON,
  getRasterList,
  importCSVPoints,
  importVector,
  measureGeometry,
  updateFeature,
  updateLayerStyle,
  uploadOrthomosaic,
} from '../api/gisWorkspace'

import './GISWorkspace.css'

type MapLayer = {
  id: string
  name: string
  layer_type: string
  geometry_type: string
  crs: number
  visible: boolean
  opacity: number
  feature_count: number
}

const apiBase =
  import.meta.env.VITE_API_BASE_URL ||
  'http://localhost:8000'

const vectorStyle = new Style({
  fill: new Fill({
    color: 'rgba(30, 136, 229, 0.16)',
  }),
  stroke: new Stroke({
    color: '#42a5f5',
    width: 2,
  }),
})

const pointStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({
      color: '#ffca28',
    }),
    stroke: new Stroke({
      color: '#111827',
      width: 2,
    }),
  }),
})

type GISWorkspaceProps = {
  surveyId?: string
}

export default function GISWorkspace({
  surveyId,
}: GISWorkspaceProps) {
  const mapElement = useRef<HTMLDivElement | null>(null)

  const mapRef = useRef<Map | null>(null)
  const rasterLayerRef =
    useRef<WebGLTileLayer | null>(null)

  const vectorLayersRef =
    useRef<Record<string, VectorLayer<any>>>({})

  const drawRef =
    useRef<Draw | null>(null)

  const modifyRef =
    useRef<Modify | null>(null)

  const snapRef =
    useRef<Snap | null>(null)

  const selectRef =
    useRef<Select | null>(null)

  const [layers, setLayers] =
    useState<MapLayer[]>([])

  const [selectedLayerId, setSelectedLayerId] =
    useState<string>('')

  const [selectedFeature, setSelectedFeature] =
    useState<any>(null)

  const [selectedFeatureIds, setSelectedFeatureIds] =
    useState<string[]>([])

  const [mode, setMode] =
    useState<
      'select' |
      'draw' |
      'modify' |
      'measure' |
      'split'
    >('select')

  const [raster, setRaster] =
    useState<any>(null)

  const [processingOrthomosaic, setProcessingOrthomosaic] =
    useState<any>(null)

  const [status, setStatus] =
    useState('Ready')

  const [measureResult, setMeasureResult] =
    useState<any>(null)

  const [showImport, setShowImport] =
    useState(false)

  const [showCreateLayer, setShowCreateLayer] =
    useState(false)

  const [showCalculator, setShowCalculator] =
    useState(false)

  const [importType, setImportType] =
    useState<'GCP' | 'RTK'>('RTK')

  const [importFile, setImportFile] =
    useState<File | null>(null)

  const [delimiter, setDelimiter] =
    useState(';')

  const [xColumn, setXColumn] =
    useState('Easting')

  const [yColumn, setYColumn] =
    useState('Northing')

  const [layerName, setLayerName] =
    useState('RTK Points')

  const [crs, setCrs] =
    useState(32633)

  const [newLayerName, setNewLayerName] =
    useState('Survey Boundaries')

  const [newLayerType, setNewLayerType] =
    useState('SURVEY_BOUNDARY')

  const [calculatorField, setCalculatorField] =
    useState('area_acres')

  const [calculatorExpression, setCalculatorExpression] =
    useState('area_m2 / 4046.856')

  const selectedLayer = useMemo(
    () =>
      layers.find(
        x => x.id === selectedLayerId,
      ),
    [layers, selectedLayerId],
  )

  async function refreshLayers() {
    const result =
      await getGISLayers(surveyId)

    setLayers(result as MapLayer[])

    if (
      result.length &&
      !result.some(
        layer => layer.id === selectedLayerId,
      )
    ) {
      setSelectedLayerId(
        result[0].id,
      )
    }

    if (!result.length) {
      setSelectedLayerId('')
    }
  }

  async function refreshLayer(
    layerId: string,
  ) {
    const geojson =
      await getLayerGeoJSON(
        layerId,
      )

    const source =
      vectorLayersRef.current[
        layerId
      ]?.getSource()

    if (!source) return

    source.clear()

    const features =
      new GeoJSON().readFeatures(
        geojson,
        {
          dataProjection:
            'EPSG:4326',
          featureProjection:
            'EPSG:3857',
        },
      )

    source.addFeatures(features)

    if (
      layerId === selectedLayerId &&
      features.length > 0
    ) {
      const extent =
        source.getExtent()

      const validExtent =
        extent.length === 4 &&
        extent.every(
          (value: number) =>
            Number.isFinite(value),
        ) &&
        extent[0] <= extent[2] &&
        extent[1] <= extent[3]

      if (validExtent) {
        mapRef.current
          ?.getView()
          .fit(
            extent,
            {
              padding: [
                50,
                50,
                50,
                50,
              ],
              maxZoom: 20,
              duration: 400,
            },
          )
      }
    }
  }

  useEffect(() => {
    setLayers([])
    setSelectedLayerId('')
    setSelectedFeature(null)
    setSelectedFeatureIds([])

    if (!surveyId) {
      setStatus(
        'Select a survey before opening the Orthomosaic Workspace',
      )
      return
    }

    refreshLayers()
      .catch(error =>
        setStatus(
          error instanceof Error
            ? error.message
            : 'Failed to load survey GIS layers',
        ),
      )
  }, [surveyId])

  useEffect(() => {
    if (!mapElement.current) return

    const map =
      new Map({
        target:
          mapElement.current,
        view:
          new View({
            projection:
              'EPSG:3857',
            center:
              fromLonLat([
                16.476,
                47.643,
              ]),
            zoom: 16,
          }),
      })

    mapRef.current = map

    const select =
      new Select()

    select.on(
      'select',
      event => {
        const feature =
          event.selected[0]

        if (!feature) {
          setSelectedFeature(null)
          return
        }

        setSelectedFeature(
          feature,
        )
      },
    )

    selectRef.current = select

    map.addInteraction(select)

    return () => {
      map.setTarget(
        undefined,
      )
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current

    if (!map) return

    Object.values(
      vectorLayersRef.current,
    ).forEach(layer =>
      map.removeLayer(layer),
    )

    vectorLayersRef.current = {}

    layers.forEach(layer => {
      const source =
        new VectorSource()

      const vector =
        new VectorLayer({
          source,
          visible:
            layer.visible,
          opacity:
            layer.opacity,
          style:
            layer.geometry_type ===
            'Point'
              ? pointStyle
              : vectorStyle,
        })

      vector.set(
        'layerId',
        layer.id,
      )

      map.addLayer(vector)

      vectorLayersRef.current[
        layer.id
      ] = vector

      refreshLayer(
        layer.id,
      ).catch(() => {})
    })
  }, [layers])

  async function loadRaster(
    rasterInfo: any,
  ) {
    if (!mapRef.current) {
      throw new Error(
        'Map is not initialized',
      )
    }

    setStatus(
      `Loading orthomosaic: ${rasterInfo.name ?? 'GeoTIFF'}...`,
    )

    if (rasterLayerRef.current) {
      mapRef.current.removeLayer(
        rasterLayerRef.current,
      )
      rasterLayerRef.current = null
    }

    setRaster(null)

    try {
      const source =
        new GeoTIFF({
          sources: [
            {
              url:
                `${apiBase}${rasterInfo.public_url}`,
            },
          ],
          sourceOptions: {
            allowFullFile: true,
          },
          convertToRGB: false,
        })

      const layer =
        new WebGLTileLayer({
          source,
          opacity: 1,
        })

      rasterLayerRef.current = layer

      mapRef.current
        .getLayers()
        .insertAt(0, layer)

      const sourceView =
        await source.getView()

      console.log(
        'ELIOS-LAND GeoTIFF view:',
        sourceView,
      )

      const mapView =
        mapRef.current.getView()

      const sourceCenter =
        sourceView?.center

      const sourceProjection =
        sourceView?.projection

      if (
        Array.isArray(sourceCenter) &&
        sourceCenter.length >= 2 &&
        sourceProjection
      ) {
        const mapProjection =
          mapView.getProjection()

        const mapCenter =
          transform(
            sourceCenter,
            sourceProjection,
            mapProjection,
          )

        mapView.setCenter(
          mapCenter,
        )
      } else {
        throw new Error(
          'GeoTIFF did not provide a valid map center/projection',
        )
      }

      mapView.setZoom(19)

      setRaster({
        ...rasterInfo,
        source_type:
          rasterInfo.public_url?.includes(
            '/artifacts/',
          )
            ? 'NodeODM ProcessingArtifact'
            : 'External GeoTIFF',
      })

      setStatus(
        'Orthomosaic rendered successfully',
      )
    } catch (error) {
      if (rasterLayerRef.current) {
        mapRef.current.removeLayer(
          rasterLayerRef.current,
        )
        rasterLayerRef.current = null
      }

      setRaster(null)

      const message =
        error instanceof Error
          ? error.message
          : String(error)

      setStatus(
        `Orthomosaic rendering failed: ${message}`,
      )

      throw error
    }
  }

  async function loadSurveyOrthomosaic() {
    if (!surveyId) {
      setStatus(
        'Select a survey before opening the Orthomosaic Workspace',
      )
      return
    }

    setStatus(
      'Looking for processed orthomosaic...',
    )

    const response = await fetch(
      `${apiBase}/surveys/${surveyId}/artifacts/type/ORTHOMOSAIC`,
    )

    if (!response.ok) {
      throw new Error(
        `Failed to load orthomosaic artifacts (${response.status})`,
      )
    }

    const artifacts = await response.json()

    if (!Array.isArray(artifacts) || artifacts.length === 0) {
      setProcessingOrthomosaic(null)
      setStatus(
        'No processed orthomosaic is available for this survey',
      )
      return
    }

    const artifact =
      artifacts[artifacts.length - 1]

    setProcessingOrthomosaic(
      artifact,
    )

    const infoResponse = await fetch(
      `${apiBase}/surveys/${surveyId}/orthomosaic/info`,
    )

    if (!infoResponse.ok) {
      throw new Error(
        `Failed to load orthomosaic metadata (${infoResponse.status})`,
      )
    }

    const info = await infoResponse.json()

    await loadRaster({
      id: artifact.id,
      name: artifact.name,
      public_url:
        `/surveys/${surveyId}/artifacts/${artifact.id}/file`,
      survey_id: surveyId,
      file_format:
        artifact.file_format,
      size_bytes:
        artifact.size_bytes,
      crs:
        info.crs
          ? Number(
              String(info.crs).replace(
                'EPSG:',
                '',
              ),
            )
          : undefined,
      width:
        info.width,
      height:
        info.height,
      bands:
        info.bands,
      resolution_x:
        info.resolution?.[0],
      resolution_y:
        info.resolution?.[1],
      bounds:
        info.bounds,
      source_type:
        'NodeODM ProcessingArtifact',
    })

    setStatus(
      'NodeODM orthomosaic loaded',
    )
  }

  async function chooseRaster() {
    const rasters =
      await getRasterList(surveyId)

    if (!rasters.length) {
      setStatus(
        'No externally uploaded orthomosaic is available for this survey',
      )
      return
    }

    await loadRaster(
      rasters[0],
    )

    setStatus(
      'External GeoTIFF orthomosaic loaded',
    )
  }

  useEffect(() => {
    if (!surveyId) {
      setProcessingOrthomosaic(null)
      setStatus(
        'Select a survey to load its orthomosaic',
      )
      return
    }

    loadSurveyOrthomosaic().catch(error => {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Failed to load survey orthomosaic',
      )
    })
  }, [surveyId])

  async function uploadRaster(
    file: File,
  ) {
    setStatus(
      'Uploading orthomosaic...',
    )

    const result =
      await uploadOrthomosaic(
        file,
        surveyId,
      )

    await loadRaster(result)

    setStatus(
      'Orthomosaic loaded',
    )
  }

  async function handlePointImport() {
    if (!importFile) return

    setStatus(
      `Importing ${importType} points...`,
    )

    await importCSVPoints(
      importFile,
      {
        layerName,
        layerType:
          importType,
        encoding: 'utf-8',
        delimiter,
        xColumn,
        yColumn,
        crs,
      },
    )

    await refreshLayers()

    setShowImport(false)

    setStatus(
      `${importType} layer imported`,
    )
  }

  async function handleVectorImport(
    file: File,
  ) {
    setStatus(
      'Importing vector layer...',
    )

    await importVector(
      file,
      {
        layerName,
        layerType:
          newLayerType,
        crsOverride:
          crs,
      },
    )

    await refreshLayers()

    setStatus(
      'Vector layer imported',
    )
  }

  async function createBoundaryLayer() {
    await createGISLayer({
      name: newLayerName,
      layer_type:
        newLayerType,
      geometry_type:
        'Polygon',
      crs,
      fields: [
        {
          name: 'parcel_id',
          type: 'text',
        },
        {
          name: 'plot_no',
          type: 'text',
        },
        {
          name: 'parcel_name',
          type: 'text',
        },
        {
          name: 'status',
          type: 'text',
        },
        {
          name: 'remarks',
          type: 'text',
        },
      ],
    })

    await refreshLayers()

    setShowCreateLayer(false)

    setStatus(
      'Survey boundary layer created',
    )
  }

  function removeInteractions() {
    const map =
      mapRef.current

    if (!map) return

    if (drawRef.current) {
      map.removeInteraction(
        drawRef.current,
      )
      drawRef.current = null
    }

    if (modifyRef.current) {
      map.removeInteraction(
        modifyRef.current,
      )
      modifyRef.current = null
    }

    if (snapRef.current) {
      map.removeInteraction(
        snapRef.current,
      )
      snapRef.current = null
    }
  }

  function startDraw() {
    const map =
      mapRef.current

    const layer =
      vectorLayersRef.current[
        selectedLayerId
      ]

    if (!map || !layer) {
      setStatus(
        'Select a vector layer first',
      )
      return
    }

    removeInteractions()

    const source =
      layer.getSource()

    if (!source) return

    const draw =
      new Draw({
        source,
        type:
          selectedLayer
            ?.geometry_type ===
          'Point'
            ? 'Point'
            : 'Polygon',
      })

    draw.on(
      'drawend',
      async event => {
        const feature =
          event.feature

        const format =
          new GeoJSON()

        const geojson =
          format.writeFeatureObject(
            feature,
            {
              dataProjection:
                'EPSG:4326',
              featureProjection:
                'EPSG:3857',
            },
          )

        const properties =
          {
            parcel_id:
              `PAR-${Date.now()}`,
            status:
              'Draft',
          }

        const result =
          await createFeature({
            layer_id:
              selectedLayerId,
            geometry:
              geojson.geometry,
            properties,
          })

        feature.setId(
          result.id,
        )

        setSelectedFeature(
          feature,
        )

        setStatus(
          'Feature created',
        )
      },
    )

    map.addInteraction(draw)

    drawRef.current =
      draw

    const snap =
      new Snap({
        source,
      })

    map.addInteraction(snap)

    snapRef.current =
      snap

    setMode('draw')
  }

  function startModify() {
    const map =
      mapRef.current

    const layer =
      vectorLayersRef.current[
        selectedLayerId
      ]

    if (!map || !layer) return

    removeInteractions()

    const source =
      layer.getSource()

    if (!source) return

    const modify =
      new Modify({
        source,
      })

    modify.on(
      'modifyend',
      async event => {
        const format =
          new GeoJSON()

        for (
          const feature
          of event.features.getArray()
        ) {
          const id =
            feature.get(
              'feature_id',
            ) ||
            feature.getId()

          if (!id) continue

          const geojson =
            format.writeFeatureObject(
              feature,
              {
                dataProjection:
                  'EPSG:4326',
                featureProjection:
                  'EPSG:3857',
              },
            )

          await updateFeature(
            String(id),
            {
              geometry:
                geojson.geometry,
              properties:
                feature.getProperties(),
            },
          )
        }

        setStatus(
          'Geometry saved',
        )
      },
    )

    map.addInteraction(
      modify,
    )

    modifyRef.current =
      modify

    const snap =
      new Snap({
        source,
      })

    map.addInteraction(snap)

    snapRef.current =
      snap

    setMode('modify')
  }

  async function deleteSelected() {
    if (!selectedFeature) return

    const id =
      selectedFeature.get(
        'feature_id',
      ) ||
      selectedFeature.getId()

    if (!id) return

    await deleteFeature(
      String(id),
    )

    selectedFeature.setId(
      undefined,
    )

    const layer =
      vectorLayersRef.current[
        selectedLayerId
      ]

    layer
      ?.getSource()
      ?.removeFeature(
        selectedFeature,
      )

    setSelectedFeature(
      null,
    )

    setStatus(
      'Feature deleted',
    )
  }

  async function measureSelected() {
    if (!selectedFeature) return

    const format =
      new GeoJSON()

    const geojson =
      format.writeFeatureObject(
        selectedFeature,
        {
          dataProjection:
            'EPSG:4326',
          featureProjection:
            'EPSG:3857',
        },
      )

    const result =
      await measureGeometry(
        geojson.geometry,
      )

    setMeasureResult(
      result,
    )

    setStatus(
      'Measurement complete',
    )
  }

  async function runCalculator() {
    if (!selectedLayerId) return

    await calculateField({
      layer_id:
        selectedLayerId,
      field:
        calculatorField,
      expression:
        calculatorExpression,
      feature_ids:
        selectedFeatureIds.length
          ? selectedFeatureIds
          : undefined,
    })

    await refreshLayer(
      selectedLayerId,
    )

    setShowCalculator(
      false,
    )

    setStatus(
      'Field calculator completed',
    )
  }

  async function toggleLayer(
    layer: MapLayer,
  ) {
    const vector =
      vectorLayersRef.current[
        layer.id
      ]

    const visible =
      !layer.visible

    vector?.setVisible(
      visible,
    )

    await updateLayerStyle(
      layer.id,
      {
        visible,
      },
    )

    setLayers(
      current =>
        current.map(item =>
          item.id === layer.id
            ? {
                ...item,
                visible,
              }
            : item,
        ),
    )
  }

  function selectFeatureFromTable(
    featureId: string,
  ) {
    const layer =
      vectorLayersRef.current[
        selectedLayerId
      ]

    const feature =
      layer
        ?.getSource()
        ?.getFeatureById(
          featureId,
        )

    if (!feature) return

    setSelectedFeature(
      feature,
    )

    setSelectedFeatureIds([
      featureId,
    ])

    const geometry =
      feature.getGeometry()

    if (geometry) {
      mapRef.current
        ?.getView()
        .fit(
          geometry.getExtent(),
          {
            padding: [
              100, 100, 100, 100
            ],
            maxZoom: 20,
            duration: 300,
          },
        )
    }
  }

  async function handleLayerFile(
    file: File,
  ) {
    const extension =
      file.name
        .split('.')
        .pop()
        ?.toLowerCase()

    if (
      extension === 'csv'
    ) {
      setImportFile(file)
      setShowImport(true)
      return
    }

    await handleVectorImport(
      file,
    )
  }

  return (
    <div className="gis-workspace">
      <div className="gis-toolbar">
        <div>
          <div className="gis-kicker">
            GIS WORKSPACE
          </div>

          <h1>
            Orthomosaic Workspace
          </h1>

          <div className="gis-status">
            {status}
          </div>
        </div>

        <div className="gis-toolbar-actions">
          <label className="gis-button">
            Load Orthomosaic
            <input
              type="file"
              accept=".tif,.tiff"
              hidden
              onChange={event => {
                const file =
                  event.target.files?.[0]

                if (file) {
                  uploadRaster(
                    file,
                  ).catch(error =>
                    setStatus(
                      error.message,
                    ),
                  )
                }
              }}
            />
          </label>

          <button
            className="gis-button"
            onClick={() =>
              chooseRaster().catch(
                error =>
                  setStatus(
                    error.message,
                  ),
              )
            }
          >
            Use Uploaded Raster
          </button>

          <label className="gis-button">
            Import Layer
            <input
              type="file"
              hidden
              accept=".csv,.geojson,.json,.gpkg,.zip,.shp"
              onChange={event => {
                const file =
                  event.target.files?.[0]

                if (file) {
                  handleLayerFile(
                    file,
                  ).catch(error =>
                    setStatus(
                      error.message,
                    ),
                  )
                }
              }}
            />
          </label>

          <button
            className="gis-button primary"
            onClick={() =>
              setShowCreateLayer(true)
            }
          >
            + Create Layer
          </button>
        </div>
      </div>

      <div className="gis-layout">
        <aside className="gis-panel left-panel">
          <div className="panel-title">
            Layers
          </div>

          <div className="layer-list">
            <div className="layer-row raster-row">
              <span>▣</span>
              <span>
                {raster?.name ||
                  'Orthomosaic'}
              </span>
              <span className="layer-meta">
                {raster?.crs
                  ? `EPSG:${raster.crs}`
                  : 'Not loaded'}
              </span>
            </div>

            {layers.map(layer => (
              <div
                key={layer.id}
                className={
                  `layer-row ${
                    selectedLayerId ===
                    layer.id
                      ? 'active'
                      : ''
                  }`
                }
              >
                <input
                  type="checkbox"
                  checked={
                    layer.visible
                  }
                  onChange={() =>
                    toggleLayer(
                      layer,
                    )
                  }
                />

                <button
                  className="layer-name"
                  onClick={() =>
                    setSelectedLayerId(
                      layer.id,
                    )
                  }
                >
                  {layer.name}
                </button>

                <span className="layer-count">
                  {layer.feature_count}
                </span>
              </div>
            ))}
          </div>

          {selectedLayer && (
            <div className="layer-info">
              <div className="panel-title">
                Active Layer
              </div>

              <strong>
                {selectedLayer.name}
              </strong>

              <span>
                {selectedLayer.layer_type}
              </span>

              <span>
                {selectedLayer.geometry_type}
              </span>

              <span>
                EPSG:
                {selectedLayer.crs}
              </span>
            </div>
          )}

          <div className="panel-title">
            Tools
          </div>

          <div className="tool-grid">
            <button
              onClick={() =>
                setMode('select')
              }
            >
              Select
            </button>

            <button
              onClick={startDraw}
            >
              Add
            </button>

            <button
              onClick={startModify}
            >
              Edit
            </button>

            <button
              onClick={deleteSelected}
            >
              Delete
            </button>

            <button
              onClick={measureSelected}
            >
              Measure
            </button>

            <button
              onClick={() =>
                setShowCalculator(
                  true,
                )
              }
            >
              Field Calculator
            </button>
          </div>

          <div className="panel-title">
            Export
          </div>

          {selectedLayer && (
            <div className="export-grid">
              {[
                'geojson',
                'gpkg',
                'shp',
                'kml',
                'csv',
              ].map(format => (
                <a
                  key={format}
                  href={exportLayerUrl(
                    selectedLayer.id,
                    format,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  {format.toUpperCase()}
                </a>
              ))}
            </div>
          )}
        </aside>

        <main
          ref={mapElement}
          className="gis-map"
        />

        <aside className="gis-panel right-panel">
          <div className="panel-title">
            Survey
          </div>

          <div className="survey-status">
            <span>
              Orthomosaic
            </span>

            <strong>
              {raster
                ? 'Loaded'
                : 'Not loaded'}
            </strong>
          </div>

          <div className="survey-status">
            <span>
              GCP
            </span>

            <strong>
              {
                layers.find(
                  x =>
                    x.layer_type ===
                    'GCP',
                )?.feature_count ??
                0
              }
            </strong>
          </div>

          <div className="survey-status">
            <span>
              RTK
            </span>

            <strong>
              {
                layers.find(
                  x =>
                    x.layer_type ===
                    'RTK',
                )?.feature_count ??
                0
              }
            </strong>
          </div>

          {raster && (
            <div className="raster-card">
              <div className="panel-title">
                Raster Information
              </div>

              <span>
                CRS:
                EPSG:{raster.crs}
              </span>

              <span>
                Size:
                {raster.width} ×
                {raster.height}
              </span>

              <span>
                Bands:
                {raster.bands}
              </span>

              <span>
                Resolution:
                {raster.resolution_x}
              </span>
            </div>
          )}

          {selectedFeature && (
            <div className="feature-card">
              <div className="panel-title">
                Selected Feature
              </div>

              {Object.entries(
                selectedFeature
                  .getProperties(),
              )
                .filter(
                  ([key]) =>
                    key !==
                    'geometry',
                )
                .slice(0, 12)
                .map(
                  ([key, value]) => (
                    <div
                      className="attribute-row"
                      key={key}
                    >
                      <span>
                        {key}
                      </span>

                      <strong>
                        {String(
                          value ?? '',
                        )}
                      </strong>
                    </div>
                  ),
                )}
            </div>
          )}

          {measureResult && (
            <div className="feature-card">
              <div className="panel-title">
                Measurement
              </div>

              <div className="attribute-row">
                <span>Area</span>
                <strong>
                  {measureResult.area_m2.toFixed(
                    2,
                  )}{' '}
                  m²
                </strong>
              </div>

              <div className="attribute-row">
                <span>
                  Perimeter
                </span>
                <strong>
                  {measureResult.perimeter_m.toFixed(
                    2,
                  )}{' '}
                  m
                </strong>
              </div>
            </div>
          )}

          {selectedLayer && (
            <div className="feature-table">
              <div className="panel-title">
                Features
              </div>

              {(
                vectorLayersRef
                  .current[
                  selectedLayer.id
                ]
                  ?.getSource()
                  ?.getFeatures() ||
                []
              ).map((feature: any) => {
                const id =
                  String(
                    feature.get(
                      'feature_id',
                    ) ||
                      feature.getId() ||
                      '',
                  )

                return (
                  <button
                    key={id}
                    className={
                      `feature-row ${
                        selectedFeatureIds.includes(
                          id,
                        )
                          ? 'selected'
                          : ''
                      }`
                    }
                    onClick={() =>
                      selectFeatureFromTable(
                        id,
                      )
                    }
                  >
                    {String(
                      feature.get(
                        'parcel_id',
                      ) ||
                        feature.get(
                          'Name',
                        ) ||
                        id.slice(
                          0,
                          8,
                        ),
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </aside>
      </div>

      {showImport && (
        <div className="gis-modal-backdrop">
          <div className="gis-modal">
            <h2>
              Import Point Layer
            </h2>

            <label>
              Point type
              <select
                value={importType}
                onChange={event =>
                  setImportType(
                    event.target
                      .value as
                      | 'GCP'
                      | 'RTK',
                  )
                }
              >
                <option value="RTK">
                  RTK Points
                </option>

                <option value="GCP">
                  GCP Points
                </option>
              </select>
            </label>

            <label>
              Layer name
              <input
                value={layerName}
                onChange={event =>
                  setLayerName(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <label>
              Encoding
              <input
                value="UTF-8"
                readOnly
              />
            </label>

            <label>
              Delimiter
              <select
                value={delimiter}
                onChange={event =>
                  setDelimiter(
                    event.target
                      .value,
                  )
                }
              >
                <option value=";">
                  Semicolon ;
                </option>

                <option value=",">
                  Comma ,
                </option>

                <option value="\t">
                  Tab
                </option>
              </select>
            </label>

            <label>
              X / Easting
              <input
                value={xColumn}
                onChange={event =>
                  setXColumn(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <label>
              Y / Northing
              <input
                value={yColumn}
                onChange={event =>
                  setYColumn(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <label>
              CRS
              <input
                type="number"
                value={crs}
                onChange={event =>
                  setCrs(
                    Number(
                      event.target
                        .value,
                    ),
                  )
                }
              />
            </label>

            <div className="modal-actions">
              <button
                onClick={() =>
                  setShowImport(
                    false,
                  )
                }
              >
                Cancel
              </button>

              <button
                className="primary"
                onClick={() =>
                  handlePointImport().catch(
                    error =>
                      setStatus(
                        error.message,
                      ),
                  )
                }
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateLayer && (
        <div className="gis-modal-backdrop">
          <div className="gis-modal">
            <h2>
              Create Vector Layer
            </h2>

            <label>
              Layer name
              <input
                value={newLayerName}
                onChange={event =>
                  setNewLayerName(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <label>
              Layer type
              <select
                value={newLayerType}
                onChange={event =>
                  setNewLayerType(
                    event.target
                      .value,
                  )
                }
              >
                <option value="SURVEY_BOUNDARY">
                  Survey Boundary
                </option>

                <option value="CADASTRAL_OLD">
                  Old Cadastre
                </option>

                <option value="CADASTRAL_NEW">
                  New Cadastre
                </option>
              </select>
            </label>

            <label>
              CRS
              <input
                type="number"
                value={crs}
                onChange={event =>
                  setCrs(
                    Number(
                      event.target
                        .value,
                    ),
                  )
                }
              />
            </label>

            <div className="modal-actions">
              <button
                onClick={() =>
                  setShowCreateLayer(
                    false,
                  )
                }
              >
                Cancel
              </button>

              <button
                className="primary"
                onClick={() =>
                  createBoundaryLayer().catch(
                    error =>
                      setStatus(
                        error.message,
                      ),
                  )
                }
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showCalculator && (
        <div className="gis-modal-backdrop">
          <div className="gis-modal">
            <h2>
              Field Calculator
            </h2>

            <p className="muted">
              Leave feature selection
              empty to calculate for
              the whole layer.
            </p>

            <label>
              Field
              <input
                value={
                  calculatorField
                }
                onChange={event =>
                  setCalculatorField(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <label>
              Expression
              <input
                value={
                  calculatorExpression
                }
                onChange={event =>
                  setCalculatorExpression(
                    event.target
                      .value,
                  )
                }
              />
            </label>

            <div className="calculator-help">
              Examples:
              <br />
              <code>
                area_m2 / 4046.856
              </code>
              <br />
              <code>
                round(area_m2, 2)
              </code>
              <br />
              <code>
                abs(area_difference)
              </code>
            </div>

            <div className="modal-actions">
              <button
                onClick={() =>
                  setShowCalculator(
                    false,
                  )
                }
              >
                Cancel
              </button>

              <button
                className="primary"
                onClick={() =>
                  runCalculator().catch(
                    error =>
                      setStatus(
                        error.message,
                      ),
                  )
                }
              >
                Calculate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
