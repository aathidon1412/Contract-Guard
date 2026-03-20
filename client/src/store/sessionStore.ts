import { create } from 'zustand'

import axiosClient from '../api/axiosClient'

interface SessionStoreState {
  activeSessionId: number | null
  finalYaml: string | null
  migrationGuide: string | null
  diffLines: any[]
  finalizeSession: (sessionId: number) => Promise<void>
  downloadYaml: (sessionId: number) => Promise<string | null>
  downloadGuide: (sessionId: number) => Promise<string | null>
}

interface FinalizeSessionResponse {
  finalYaml?: string
  migrationGuide?: string
  diffLines?: any[]
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  activeSessionId: null,
  finalYaml: null,
  migrationGuide: null,
  diffLines: [],

  finalizeSession: async (sessionId: number) => {
    try {
      const response = await axiosClient.post<FinalizeSessionResponse>(`/sessions/${sessionId}/finalize`)
      set({
        activeSessionId: sessionId,
        finalYaml: response.data.finalYaml ?? null,
        migrationGuide: response.data.migrationGuide ?? null,
        diffLines: response.data.diffLines ?? [],
      })
    } catch (error) {
      console.error(error)
    }
  },

  downloadYaml: async (sessionId: number) => {
    try {
      const response = await axiosClient.get<string>(`/sessions/${sessionId}/download/yaml`, {
        responseType: 'text',
      })

      set({ finalYaml: response.data, activeSessionId: sessionId })
      return response.data
    } catch (error) {
      console.error(error)
      return null
    }
  },

  downloadGuide: async (sessionId: number) => {
    try {
      const response = await axiosClient.get<string>(`/sessions/${sessionId}/download/guide`, {
        responseType: 'text',
      })

      set({ migrationGuide: response.data, activeSessionId: sessionId })
      return response.data
    } catch (error) {
      console.error(error)
      return null
    }
  },
}))
