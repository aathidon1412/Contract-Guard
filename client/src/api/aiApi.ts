import axiosClient from './axiosClient'
import type { Conflict, CrossBranchScenario } from '../types'

interface AIStatusResponse {
  available: boolean
  model: string
  modelLoaded: boolean
  message: string
  url: string
}

interface ExplanationResponse {
  explanation: string
}

interface SuggestionResponse {
  suggestion: string
  reason: string
}

interface MigrationGuideResponse {
  guide: string
}

export const getAIStatus = async (): Promise<AIStatusResponse> => {
  const response = await axiosClient.get<AIStatusResponse>('/ai/status')
  return response.data
}

export const explainConflict = async (
  conflict: Conflict
): Promise<ExplanationResponse> => {
  const response = await axiosClient.post<ExplanationResponse>(
    '/ai/explain/conflict',
    { conflict },
    { timeout: 120000 }
  )
  return response.data
}

export const explainScenario = async (
  scenario: CrossBranchScenario
): Promise<ExplanationResponse> => {
  const response = await axiosClient.post<ExplanationResponse>(
    '/ai/explain/scenario',
    { scenario },
    { timeout: 120000 }
  )
  return response.data
}

export const suggestResolution = async (
  conflict: Conflict
): Promise<SuggestionResponse> => {
  const response = await axiosClient.post<SuggestionResponse>(
    '/ai/suggest',
    { conflict },
    { timeout: 120000 }
  )
  return response.data
}

export const generateMigrationGuide = async (
  conflicts: Conflict[],
  scenarios: CrossBranchScenario[]
): Promise<MigrationGuideResponse> => {
  const response = await axiosClient.post<MigrationGuideResponse>(
    '/ai/migration-guide',
    { conflicts, scenarios },
    { timeout: 180000 }
  )
  return response.data
}
