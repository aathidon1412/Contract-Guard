import { create } from 'zustand'

import axiosClient from '../api/axiosClient'
import type { Repository, Branch } from '../types'

export interface DeleteRepoSummary {
  repo: string
  branches: number
  endpoints: number
  sessions: number
  conflicts: number
}

interface DeleteRepoResponse {
  success: boolean
  message: string
  deleted: DeleteRepoSummary
  note: string
}

interface RepoStoreState {
  repos: Repository[]
  selectedRepo: Repository | null
  loading: boolean
  error: string | null
  fetchRepos: () => Promise<void>
  addRepo: (githubUrl: string) => Promise<void>
  deleteRepo: (id: number) => Promise<DeleteRepoSummary | null>
  removeRepo: (id: number) => Promise<void>
  selectRepo: (repo: Repository | null) => void
  scanRepo: (repoId: number) => Promise<void>
  fetchBranches: (repoId: number) => Promise<void>
}

const normalizeRepository = (repository: Repository): Repository => ({
  ...repository,
  branches: repository.branches ?? [],
})

export const useRepoStore = create<RepoStoreState>((set) => ({
  repos: [],
  selectedRepo: null,
  loading: false,
  error: null,

  fetchRepos: async () => {
    set({ loading: true, error: null })
    try {
      const response = await axiosClient.get<Repository[]>('/repos')
      set({ repos: response.data.map(normalizeRepository), loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Failed to fetch repositories' })
    }
  },

  addRepo: async (githubUrl: string) => {
    set({ loading: true, error: null })
    try {
      const response = await axiosClient.post<Repository>('/repos', { githubUrl })
      const newRepo = normalizeRepository(response.data)

      set((state) => ({
        repos: [newRepo, ...state.repos],
        loading: false,
      }))
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Failed to add repository' })
    }
  },

  deleteRepo: async (id: number) => {
    set({ loading: true, error: null })
    try {
      const response = await axiosClient.delete<DeleteRepoResponse>(`/repos/${id}`)
      set((state) => ({
        repos: state.repos.filter((repo) => repo.id !== id),
        selectedRepo: state.selectedRepo?.id === id ? null : state.selectedRepo,
        loading: false,
      }))
      return response.data.deleted
    } catch (error) {
      set({ loading: false, error: 'Failed to remove repository' })
      return null
    }
  },

  removeRepo: async (id: number) => {
    await useRepoStore.getState().deleteRepo(id)
  },

  selectRepo: (repo: Repository | null) => {
    set({ selectedRepo: repo ? normalizeRepository(repo) : null })
  },

  scanRepo: async (repoId: number) => {
    set({ loading: true, error: null })
    try {
      await axiosClient.post(`/repos/${repoId}/scan`)
      set({ loading: false })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Failed to scan repository' })
    }
  },

  fetchBranches: async (repoId: number) => {
    set({ loading: true, error: null })
    try {
      const response = await axiosClient.get<Branch[]>('/branches', {
        params: { repoId },
      })

      const branches = response.data
      set((state) => {
        const repos = state.repos.map((repo) =>
          repo.id === repoId ? { ...repo, branches } : repo
        )

        const selectedRepo =
          state.selectedRepo?.id === repoId
            ? { ...state.selectedRepo, branches }
            : state.selectedRepo

        return {
          repos,
          selectedRepo,
          loading: false,
        }
      })
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Failed to fetch branches' })
    }
  },
}))
