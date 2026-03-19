'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, Save, List } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface LiveListRow {
  list_id: string
  list_name: string
  campaign_id: string
  campaign_name: string
  total_count: number
  remaining_count: number
  active: boolean
  last_call_time: string | null
  updated_at: string
}

interface ListAlertRow {
  id: string
  list_id: string
  threshold: number
  notified_at: string | null
  active: boolean
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('el-GR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getRemainingClass(total: number, remaining: number) {
  if (total <= 0) return 'text-zinc-300'
  const ratio = remaining / total
  if (ratio > 0.2) return 'text-green-400'
  if (ratio >= 0.1) return 'text-yellow-400'
  return 'text-red-400'
}

export default function LiveListsTab() {
  const [lists, setLists] = useState<LiveListRow[]>([])
  const [alertsByList, setAlertsByList] = useState<Record<string, ListAlertRow>>({})
  const [thresholdInputs, setThresholdInputs] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingListId, setSavingListId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const inFlightNotificationFor = useRef<Set<string>>(new Set())

  const refreshData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [listsRes, alertsRes] = await Promise.all([
        supabase
          .from('live_lists')
          .select('list_id, list_name, campaign_id, campaign_name, total_count, remaining_count, active, last_call_time, updated_at')
          .eq('active', true)
          .order('remaining_count', { ascending: true }),
        supabase
          .from('list_alerts')
          .select('id, list_id, threshold, notified_at, active')
          .eq('active', true),
      ])

      const nextLists = listsRes.data ?? []
      const nextAlerts = alertsRes.data ?? []

      const firstError = listsRes.error ?? alertsRes.error
      if (firstError) {
        setLoadError(firstError.message)
      } else {
        setLoadError(null)
      }

      const byList: Record<string, ListAlertRow> = {}
      for (const alert of nextAlerts) {
        byList[alert.list_id] = alert
      }

      setLists(nextLists)
      setAlertsByList(byList)
      setThresholdInputs((prev) => {
        const updated = { ...prev }
        for (const list of nextLists) {
          if (updated[list.list_id] === undefined) {
            updated[list.list_id] = byList[list.list_id]?.threshold?.toString() ?? '100'
          }
        }
        return updated
      })
      setLastUpdated(new Date())
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error while loading lists'
      setLoadError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    refreshData()
    const interval = setInterval(refreshData, 30000)
    return () => clearInterval(interval)
  }, [refreshData])

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    const evaluateAlerts = async () => {
      for (const list of lists) {
        const alert = alertsByList[list.list_id]
        if (!alert || !alert.active) continue

        const isBelow = list.remaining_count < alert.threshold
        if (isBelow && !alert.notified_at && !inFlightNotificationFor.current.has(list.list_id)) {
          inFlightNotificationFor.current.add(list.list_id)
          try {
            new Notification(`⚠️ Λίστα ${list.list_name}`, {
              body: `Υπόλοιπο: ${list.remaining_count} εγγραφές`,
            })
            const nowIso = new Date().toISOString()
            await supabase.from('list_alerts').update({ notified_at: nowIso }).eq('id', alert.id)
            setAlertsByList((prev) => ({
              ...prev,
              [list.list_id]: { ...prev[list.list_id], notified_at: nowIso },
            }))
          } finally {
            inFlightNotificationFor.current.delete(list.list_id)
          }
        }

        if (!isBelow && alert.notified_at && !inFlightNotificationFor.current.has(list.list_id)) {
          inFlightNotificationFor.current.add(list.list_id)
          try {
            await supabase.from('list_alerts').update({ notified_at: null }).eq('id', alert.id)
            setAlertsByList((prev) => ({
              ...prev,
              [list.list_id]: { ...prev[list.list_id], notified_at: null },
            }))
          } finally {
            inFlightNotificationFor.current.delete(list.list_id)
          }
        }
      }
    }

    void evaluateAlerts()
  }, [lists, alertsByList])

  const saveThreshold = async (list: LiveListRow) => {
    const raw = thresholdInputs[list.list_id]
    const parsed = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('Το threshold πρέπει να είναι μη αρνητικός ακέραιος αριθμός.')
      return
    }

    setSavingListId(list.list_id)
    try {
      const { data, error } = await supabase
        .from('list_alerts')
        .upsert(
          {
            list_id: list.list_id,
            threshold: parsed,
            active: true,
          },
          { onConflict: 'list_id' }
        )
        .select('id, list_id, threshold, notified_at, active')
        .single()

      if (error) {
        alert(`Αποτυχία αποθήκευσης threshold: ${error.message}`)
        return
      }

      if (data) {
        setAlertsByList((prev) => ({ ...prev, [list.list_id]: data }))
      }
    } finally {
      setSavingListId(null)
    }
  }

  const activeLists = useMemo(() => lists.filter((l) => l.active), [lists])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <List className="w-5 h-5 text-cyan-400" />
          Live Lists
        </h2>
        <div className="text-xs text-zinc-500 flex items-center gap-2">
          <Bell className="w-3.5 h-3.5" />
          {lastUpdated ? `Ανανέωση: ${lastUpdated.toLocaleTimeString('el-GR')}` : 'Σύνδεση...'}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {loadError && (
          <div className="px-4 py-3 border-b border-red-900/40 bg-red-950/30 flex items-center justify-between gap-3">
            <div className="text-xs text-red-200">
              <p className="font-semibold">Αποτυχία φόρτωσης λιστών</p>
              <p className="text-red-300/90 mt-1">{loadError}</p>
            </div>
            <button
              onClick={() => {
                void refreshData()
              }}
              className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-200 border border-red-500/30 hover:bg-red-500/25 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">List Name</th>
                <th className="text-left px-4 py-3">Campaign</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Remaining</th>
                <th className="text-left px-4 py-3">Last Call</th>
                <th className="text-left px-4 py-3">Alert Threshold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {activeLists.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-zinc-600 py-12">
                    Δεν υπάρχουν ενεργές λίστες.
                  </td>
                </tr>
              ) : (
                activeLists.map((list) => {
                  const alert = alertsByList[list.list_id]
                  const inputValue = thresholdInputs[list.list_id] ?? ''
                  return (
                    <tr key={list.list_id} className="hover:bg-zinc-800/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-zinc-100">{list.list_name}</div>
                        <div className="text-[11px] text-zinc-500">{list.list_id}</div>
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        <div>{list.campaign_name}</div>
                        <div className="text-[11px] text-zinc-500">{list.campaign_id}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-200 font-mono">
                        {list.total_count}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        <span className={getRemainingClass(list.total_count, list.remaining_count)}>
                          {list.remaining_count}
                        </span>
                        {list.total_count > 0 && (
                          <span className="text-zinc-600 text-xs ml-2">
                            ({Math.round((list.remaining_count / list.total_count) * 100)}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs whitespace-nowrap">
                        {formatDateTime(list.last_call_time)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0}
                            value={inputValue}
                            onChange={(e) => {
                              const val = e.target.value
                              setThresholdInputs((prev) => ({ ...prev, [list.list_id]: val }))
                            }}
                            className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
                          />
                          <button
                            onClick={() => saveThreshold(list)}
                            disabled={savingListId === list.list_id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-cyan-600/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-600/20 disabled:opacity-50"
                          >
                            <Save className="w-3.5 h-3.5" />
                            Save
                          </button>
                          {alert?.threshold !== undefined && (
                            <span className="text-[11px] text-zinc-500">τρέχον: {alert.threshold}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-zinc-500 flex items-center justify-between">
        <span>Auto-refresh κάθε 30 δευτερόλεπτα</span>
        {isLoading && <span className="animate-pulse">Ανανέωση δεδομένων...</span>}
      </div>
    </div>
  )
}
