import { apiFetch } from './client'
export const compareParcel = (parcelId: string) => apiFetch(`/analysis/${parcelId}/compare`, {method:'POST'})
export const getComparison = (parcelId: string) => apiFetch(`/analysis/${parcelId}`)

// ============================================================
// HELIOS-LAND Cadastral Comparison API
// ============================================================

export const getCadastralLayers = () =>
  apiFetch<{ layers: any[] }>('/api/cadastral/layers')

export const runCadastralComparison = (payload: {
  old_layer_id: string
  new_layer_id: string
  survey_id?: string
}) =>
  apiFetch('/api/cadastral/compare', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const getCadastralComparisonRun = (
  runId: string,
) =>
  apiFetch(`/api/cadastral/comparison/${runId}`)

export const getCadastralComparisonGeoJSON = (
  runId: string,
) =>
  apiFetch(
    `/api/cadastral/comparison/${runId}/geojson`,
  )

export const getCadastralReportUrl = (
  runId: string,
) => {
  const base =
    import.meta.env.VITE_API_BASE_URL ||
    'http://localhost:8000'

  return `${base}/api/cadastral/report/${runId}`
}

export const createCadastralVerificationCase = (
  runId: string,
  payload: {
    comparison_id?: string
    officer_name?: string
    review_note?: string
  },
) =>
  apiFetch(
    `/api/cadastral/comparison/${runId}/verification`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  )
