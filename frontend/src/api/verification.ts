import { apiFetch } from './client'
export const getCases = () => apiFetch('/cases')
export const createCase = (payload: unknown) => apiFetch('/cases', {method:'POST', body:JSON.stringify(payload)})

export const getCadastralVerificationCases = () =>
  apiFetch('/api/cadastral/verification-cases')

export const createCadastralVerification = (
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
