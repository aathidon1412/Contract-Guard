import { create } from 'zustand'

import axiosClient from '../api/axiosClient'
import type { Conflict, CrossBranchScenario, ConflictSession } from '../types'

type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Easy'

interface DetectedConflict {
  id: string
  type: string
  severity: Severity
  endpoint: string
  method: string
  fieldName: string
  mainValue: string
  branchValue: string
  branchName: string
  lineMain: number
  lineBranch: number
  status: 'unresolved' | 'resolved'
  resolution?: string
}

interface ConsolidationConflict {
  id: string
  scenarioType: string
  fieldName: string
  endpoint: string
  method: string
  branchAName: string
  branchBName: string
  branchAAction: string
  branchBAction: string
  description: string
  subOptions: Array<{
    value: string
    label: string
    description?: string
    consequence?: string
    recommended?: boolean
  }>
  autoResolvable: boolean
  autoResolution: string | null
}

interface Stats {
  total: number
  resolved: number
  unresolved: number
  criticalUnresolved: number
  percentComplete: number
}

interface ConflictStoreState {
  session: ConflictSession | null
  conflicts: DetectedConflict[]
  consolidationConflicts: ConsolidationConflict[]
  groupedConflicts: Record<Severity, DetectedConflict[]>
  stats: Stats
  showConsolidationPopup: boolean
  currentScenario: ConsolidationConflict | null
  scenarioQueue: ConsolidationConflict[]
  loading: boolean

  detectConflicts: (repoId: number, mainBranchId: number, branchIds: number[]) => Promise<void>
  resolveConflict: (conflictId: string | number, resolution: string) => Promise<void>
  resolveConsolidation: (id: string | number, option: string) => Promise<void>
  bulkResolve: (sessionId: number, resolution: string, severity?: Severity) => Promise<void>
  updateBulkResolved: (severity: Severity | undefined, resolution: string, branchName?: string) => void
  skipScenario: () => void
  getProgress: () => { percentComplete: number; criticalCleared: boolean; allResolved: boolean }
}

const emptyGrouped = () => ({ Critical: [], High: [], Medium: [], Low: [], Easy: [] } as Record<Severity, DetectedConflict[]>)

export const useConflictStore = create<ConflictStoreState>((set, get) => ({
  session: null,
  conflicts: [],
  consolidationConflicts: [],
  groupedConflicts: emptyGrouped(),
  stats: { total: 0, resolved: 0, unresolved: 0, criticalUnresolved: 0, percentComplete: 0 },
  showConsolidationPopup: false,
  currentScenario: null,
  scenarioQueue: [],
  loading: false,
  loadingIds: new Set<string>(),

  detectConflicts: async (repoId: number, mainBranchId: number, branchIds: number[]) => {
    set({ loading: true })
    try {
      const resp = await axiosClient.post('/conflicts/detect', { repoId, mainBranchId, branchIds })
      const data = resp.data

      // After detection, fetch session conflicts from server to get DB ids
      const sessionId = data.sessionId
      const sessionResp = await axiosClient.get(`/conflicts/session/${sessionId}`)
      const sessionData = sessionResp.data

      // flatten grouped conflicts returned by server
      const grouped = sessionData.conflictsGrouped || {}
      const flat: DetectedConflict[] = []
      for (const key of Object.keys(grouped)) {
        for (const c of grouped[key]) {
          flat.push({
            id: String(c.id),
            type: c.type,
            severity: (c.impactLevel === 'CRITICAL' ? 'Critical' : c.impactLevel === 'HIGH' ? 'High' : c.impactLevel === 'MEDIUM' ? 'Medium' : c.impactLevel === 'LOW' ? 'Low' : 'Easy') as Severity,
            endpoint: c.endpoint,
            method: c.method,
            fieldName: c.fieldName,
            mainValue: c.mainValue,
            branchValue: c.branchValue,
            branchName: c.branchName,
            lineMain: c.lineMain,
            lineBranch: c.lineBranch,
            status: c.status,
            resolution: c.resolution,
          })
        }
      }

      const consolidation = sessionData.consolidationConflicts || []
      const queue = consolidation.map((s: any) => ({
        id: String(s.id),
        scenarioType: s.scenarioType,
        fieldName: s.fieldName,
        endpoint: s.affectedEndpoint,
        method: '',
        branchAName: s.involvedBranches?.[0] ?? 'A',
        branchBName: s.involvedBranches?.[1] ?? 'B',
        branchAAction: '',
        branchBAction: '',
        description: '',
        subOptions: [],
        autoResolvable: s.autoResolved ?? false,
        autoResolution: null,
      })) as ConsolidationConflict[]

      const groupedConflicts = emptyGrouped()
      for (const c of flat) groupedConflicts[c.severity].push(c)

      const total = flat.length
      const resolved = flat.filter((f) => f.status === 'resolved').length
      const unresolved = total - resolved

      set({
        session: sessionData.session ?? null,
        conflicts: flat,
        consolidationConflicts: queue,
        groupedConflicts,
        stats: { total, resolved, unresolved, criticalUnresolved: data.criticalCount ?? 0, percentComplete: total === 0 ? 0 : Math.round((resolved / total) * 100) },
        showConsolidationPopup: queue.length > 0,
        scenarioQueue: queue,
        currentScenario: queue.length > 0 ? queue[0] : null,
        loading: false,
      })
    } catch (err) {
      console.error(err)
      set({ loading: false })
    }
  },

  // Backwards-compatible alias expected by some components
  startSession: async (repoId: number, mainBranchId: number, branchIds: number[]) => {
    // delegate to detectConflicts
    await get().detectConflicts(repoId, mainBranchId, branchIds);
  },

  resolveConflict: async (conflictId: string | number, resolution: string) => {
    const idStr = String(conflictId)
    // set loading for this id
    set((state) => {
      const ids = new Set(state.loadingIds)
      ids.add(idStr)
      return { loadingIds: ids }
    })

    try {
      const resp = await axiosClient.patch(`/conflicts/${conflictId}/resolve`, { conflictId: Number(conflictId), resolution, resolvedBy: 'user' })
      const updated = resp.data

      let updatedConflict: DetectedConflict | undefined = undefined

      set((state) => {
        const conflicts = state.conflicts.map((c) => {
          if (String(c.id) === idStr) {
            updatedConflict = { ...c, status: 'resolved', resolution }
            return updatedConflict
          }
          return c
        })

        const grouped = emptyGrouped()
        for (const f of conflicts) grouped[f.severity].push(f)
        const total = conflicts.length
        const resolved = conflicts.filter((f) => f.status === 'resolved').length
        const unresolved = total - resolved
        const criticalUnresolved = grouped['Critical'].filter((f) => f.status === 'unresolved').length

        const ids = new Set(state.loadingIds)
        ids.delete(idStr)

        return { conflicts, groupedConflicts: grouped, stats: { total, resolved, unresolved, criticalUnresolved, percentComplete: total === 0 ? 0 : Math.round((resolved / total) * 100) }, loadingIds: ids }
      })

      return updatedConflict
    } catch (err) {
      console.error(err)
      // remove from loadingIds
      set((state) => {
        const ids = new Set(state.loadingIds)
        ids.delete(idStr)
        return { loadingIds: ids }
      })
      throw err
    }
  },

  undoResolveConflict: async (conflictId: string | number) => {
    const idStr = String(conflictId)
    // mark loading
    set((state) => {
      const ids = new Set(state.loadingIds)
      ids.add(idStr)
      return { loadingIds: ids }
    })

    try {
      await axiosClient.patch(`/conflicts/${conflictId}/resolve`, { conflictId: Number(conflictId), resolution: null, status: 'unresolved' })

      set((state) => {
        const conflicts = state.conflicts.map((c) => (String(c.id) === idStr ? { ...c, status: 'unresolved', resolution: undefined } : c))
        const grouped = emptyGrouped()
        for (const f of conflicts) grouped[f.severity].push(f)
        const total = conflicts.length
        const resolved = conflicts.filter((f) => f.status === 'resolved').length
        const unresolved = total - resolved
        const criticalUnresolved = grouped['Critical'].filter((f) => f.status === 'unresolved').length

        const ids = new Set(state.loadingIds)
        ids.delete(idStr)

        return { conflicts, groupedConflicts: grouped, stats: { total, resolved, unresolved, criticalUnresolved, percentComplete: total === 0 ? 0 : Math.round((resolved / total) * 100) }, loadingIds: ids }
      })
    } catch (err) {
      console.error(err)
      set((state) => {
        const ids = new Set(state.loadingIds)
        ids.delete(idStr)
        return { loadingIds: ids }
      })
      throw err
    }
  },

  resolveConsolidation: async (id: string | number, option: string) => {
    try {
      await axiosClient.patch(`/conflicts/consolidation/${id}/resolve`, { consolidationId: Number(id), chosenOption: option })
      set((state) => {
        const queue = state.scenarioQueue.filter((s) => String(s.id) !== String(id))
        return {
          scenarioQueue: queue,
          currentScenario: queue.length > 0 ? queue[0] : null,
          showConsolidationPopup: queue.length > 0,
        }
      })
    } catch (err) {
      console.error(err)
    }
  },

  bulkResolve: async (sessionId: number, resolution: string, severity?: Severity, branchName?: string) => {
    try {
      await axiosClient.post(`/conflicts/session/${sessionId}/bulk-resolve`, { resolution, severity, branchName })
      set((state) => {
        const conflicts = state.conflicts.map((c) => {
          if (!severity || c.severity === severity) return { ...c, status: 'resolved', resolution }
          return c
        })
        const grouped = emptyGrouped()
        for (const f of conflicts) grouped[f.severity].push(f)
        const total = conflicts.length
        const resolved = conflicts.filter((f) => f.status === 'resolved').length
        const unresolved = total - resolved
        const criticalUnresolved = grouped['Critical'].filter((f) => f.status === 'unresolved').length
        return { conflicts, groupedConflicts: grouped, stats: { total, resolved, unresolved, criticalUnresolved, percentComplete: total === 0 ? 0 : Math.round((resolved / total) * 100) } }
      })
    } catch (err) {
      console.error(err)
    }
  },

  updateBulkResolved: (severity: Severity | undefined, resolution: string, branchName?: string) => {
    set((state) => {
      const conflicts = state.conflicts.map((c) => {
        const matchesSeverity = severity ? c.severity === severity : true
        const matchesBranch = branchName ? c.branchName === branchName : true
        const isUnresolved = c.status === 'unresolved'

        if (isUnresolved && matchesSeverity && matchesBranch) {
          return { ...c, status: 'resolved', resolution }
        }
        return c
      })

      const grouped = emptyGrouped()
      for (const f of conflicts) grouped[f.severity].push(f)

      const total = conflicts.length
      const resolved = conflicts.filter((f) => f.status === 'resolved').length
      const unresolved = total - resolved
      const criticalUnresolved = grouped['Critical'].filter((f) => f.status === 'unresolved').length

      return { conflicts, groupedConflicts: grouped, stats: { total, resolved, unresolved, criticalUnresolved, percentComplete: total === 0 ? 0 : Math.round((resolved / total) * 100) } }
    })
  },

  skipScenario: () => {
    set((state) => {
      const q = [...state.scenarioQueue]
      if (q.length <= 1) return { scenarioQueue: q, currentScenario: q[0] ?? null }
      const current = q.shift()!
      q.push(current)
      return { scenarioQueue: q, currentScenario: q[0] ?? null }
    })
  },

  getProgress: () => {
    const { stats } = get()
    const criticalCleared = stats.criticalUnresolved === 0
    const allResolved = stats.unresolved === 0
    return { percentComplete: stats.percentComplete, criticalCleared, allResolved }
  },
}))
