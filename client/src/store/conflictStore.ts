import { create } from 'zustand'

import axiosClient from '../api/axiosClient'
import type { Conflict, CrossBranchScenario, ConflictSession } from '../types'

interface ConflictStoreState {
  session: ConflictSession | null
  conflicts: Conflict[]
  scenarios: CrossBranchScenario[]
  loading: boolean
  currentPopup: CrossBranchScenario | null
  startSession: (repoId: number, mainBranchId: number, branchIds: number[]) => Promise<void>
  fetchSession: (sessionId: number) => Promise<void>
  resolveConflict: (conflictId: number, resolution: string) => Promise<void>
  resolveScenario: (scenarioId: number, option: string) => Promise<void>
  resolveAllConflicts: (resolution: string) => Promise<void>
  nextPopup: () => void
  isSessionComplete: () => boolean
}

const isScenarioUnresolved = (scenario: CrossBranchScenario) =>
  scenario.popupRequired && scenario.status !== 'resolved'

const getFirstPopup = (scenarios: CrossBranchScenario[]) =>
  scenarios.find(isScenarioUnresolved) ?? null

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  session: null,
  conflicts: [],
  scenarios: [],
  loading: false,
  currentPopup: null,

  startSession: async (repoId: number, mainBranchId: number, branchIds: number[]) => {
    set({ loading: true })
    try {
      const response = await axiosClient.post<ConflictSession>('/sessions', {
        repoId,
        mainBranchId,
        branchIds,
      })

      const session = response.data
      set({
        session,
        conflicts: session.conflicts ?? [],
        scenarios: session.scenarios ?? [],
        currentPopup: getFirstPopup(session.scenarios ?? []),
        loading: false,
      })
    } catch (error) {
      console.error(error)
      set({ loading: false })
    }
  },

  fetchSession: async (sessionId: number) => {
    set({ loading: true })
    try {
      const response = await axiosClient.get<ConflictSession>(`/sessions/${sessionId}`)
      const session = response.data
      set({
        session,
        conflicts: session.conflicts ?? [],
        scenarios: session.scenarios ?? [],
        currentPopup: getFirstPopup(session.scenarios ?? []),
        loading: false,
      })
    } catch (error) {
      console.error(error)
      set({ loading: false })
    }
  },

  resolveConflict: async (conflictId: number, resolution: string) => {
    try {
      const response = await axiosClient.patch<Conflict>(`/conflicts/${conflictId}/resolve`, {
        resolution,
      })
      const updatedConflict = response.data

      set((state) => ({
        conflicts: state.conflicts.map((conflict) =>
          conflict.id === conflictId
            ? { ...conflict, ...updatedConflict, resolution, status: 'resolved' as const }
            : conflict
        ),
      }))
    } catch (error) {
      console.error(error)
    }
  },

  resolveScenario: async (scenarioId: number, option: string) => {
    try {
      const response = await axiosClient.patch<CrossBranchScenario>(`/scenarios/${scenarioId}/resolve`, {
        option,
      })
      const updatedScenario = response.data

      set((state) => {
        const scenarios: CrossBranchScenario[] = state.scenarios.map((scenario) =>
          scenario.id === scenarioId
            ? {
                ...scenario,
                ...updatedScenario,
                chosenOption: option,
                status: 'resolved' as const,
              }
            : scenario
        )

        return {
          scenarios,
          currentPopup:
            state.currentPopup?.id === scenarioId
              ? getFirstPopup(scenarios)
              : state.currentPopup,
        }
      })
    } catch (error) {
      console.error(error)
    }
  },

  resolveAllConflicts: async (resolution: string) => {
    const sessionId = get().session?.id
    if (!sessionId) {
      return
    }

    try {
      await axiosClient.post('/conflicts/bulk-resolve', {
        sessionId,
        resolution,
      })

      set((state) => ({
        conflicts: state.conflicts.map((conflict) => ({
          ...conflict,
          resolution,
          status: 'resolved',
        })),
      }))
    } catch (error) {
      console.error(error)
    }
  },

  nextPopup: () => {
    set((state) => {
      const unresolved = state.scenarios.filter(isScenarioUnresolved)
      if (unresolved.length === 0) {
        return { currentPopup: null }
      }

      if (!state.currentPopup) {
        return { currentPopup: unresolved[0] }
      }

      const index = unresolved.findIndex((scenario) => scenario.id === state.currentPopup?.id)
      const nextIndex = index >= 0 && index < unresolved.length - 1 ? index + 1 : 0

      return { currentPopup: unresolved[nextIndex] }
    })
  },

  isSessionComplete: () => {
    const { conflicts, scenarios } = get()
    const allConflictsResolved = conflicts.every((conflict) => conflict.status === 'resolved')
    const allScenariosResolved = scenarios.every((scenario) => scenario.status === 'resolved')
    return allConflictsResolved && allScenariosResolved
  },
}))
