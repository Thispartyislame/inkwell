import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CustomerFilter, GarmentFilter } from '@shared/ipc'
import { api } from './api'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } }
})

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.settings.get() })
export const useAppInfo = () => useQuery({ queryKey: ['app-info'], queryFn: () => api.app.info() })
export const useCustomers = (f: CustomerFilter) => useQuery({ queryKey: ['customers', f], queryFn: () => api.customers.list(f) })
export const useCustomer = (id: number) => useQuery({ queryKey: ['customer', id], queryFn: () => api.customers.get(id), enabled: id > 0, refetchOnMount: 'always' })
export const useTags = () => useQuery({ queryKey: ['customer-tags'], queryFn: () => api.customers.tags() })
export const useGarments = (f: GarmentFilter) => useQuery({ queryKey: ['garments', f], queryFn: () => api.garments.list(f) })
export const useGarment = (id: number) => useQuery({ queryKey: ['garment', id], queryFn: () => api.garments.get(id), enabled: id > 0 })
export const useMatrices = (all = false) => useQuery({ queryKey: ['matrices', all], queryFn: () => api.pricing.listMatrices(all) })
export const useMatrix = (id: number) => useQuery({ queryKey: ['matrix', id], queryFn: () => api.pricing.getMatrix(id), enabled: id > 0 })
export const useRules = () => useQuery({ queryKey: ['rules'], queryFn: () => api.pricing.getRules() })
export const useFees = (all = false) => useQuery({ queryKey: ['fees', all], queryFn: () => api.pricing.listFees(all) })
export const useInks = (all = false) => useQuery({ queryKey: ['inks', all], queryFn: () => api.pricing.listInks(all) })
export const useBackups = () => useQuery({ queryKey: ['backups'], queryFn: () => api.backup.list() })

/** Invalidate one or more query key prefixes after a change. */
export function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}
