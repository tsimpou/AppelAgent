'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  PhoneCall,
  AlertTriangle,
  Star,
  Users,
} from 'lucide-react'

interface Call {
  id: string
  agent_name: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  total_violations: number
  performance_score: number
  sentiment: string
}

interface Violation {
  id: string
  call_id: string
  agent_name: string
  text: string
  reason: string | null
  severity: string
  occurred_at: string
}

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  const m = Math.floor(secs / 60)
    .toString()
    .padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function ScoreBadge({ score }: { score: number }) {
  if (score >= 80)
    return (
      <span className="bg-green-700 text-green-100 text-xs font-semibold px-2 py-0.5 rounded-full">
        {score} Άριστο
      </span>
    )
  if (score >= 50)
    return (
      <span className="bg-yellow-700 text-yellow-100 text-xs font-semibold px-2 py-0.5 rounded-full">
        {score} Μέτριο
      </span>
    )
  return (
    <span className="bg-red-700 text-red-100 text-xs font-semibold px-2 py-0.5 rounded-full">
      {score} Χαμηλό
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'high')
    return (
      <span className="bg-red-700/50 text-red-300 border border-red-600 text-xs px-2 py-0.5 rounded-full">
        Υψηλή
      </span>
    )
  if (severity === 'low')
    return (
      <span className="bg-gray-700 text-gray-300 border border-gray-600 text-xs px-2 py-0.5 rounded-full">
        Χαμηλή
      </span>
    )
  return (
    <span className="bg-yellow-700/50 text-yellow-300 border border-yellow-600 text-xs px-2 py-0.5 rounded-full">
      Μέτρια
    </span>
  )
}

export default function DashboardPage() {
  const [calls, setCalls] = useState<Call[]>([])
  const [violations, setViolations] = useState<Violation[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [callsRes, violationsRes] = await Promise.all([
        fetch('/api/calls'),
        fetch('/api/violations?limit=50'),
      ])
      const callsData = await callsRes.json()
      const violationsData = await violationsRes.json()
      setCalls(callsData.calls ?? [])
      setViolations(violationsData.violations ?? [])
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Dashboard fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Stats
  const today = new Date().toDateString()
  const callsToday = calls.filter((c) => new Date(c.started_at).toDateString() === today)
  const violationsToday = violations.filter(
    (v) => new Date(v.occurred_at).toDateString() === today
  )
  const avgScore =
    callsToday.length > 0
      ? Math.round(callsToday.reduce((sum, c) => sum + (c.performance_score ?? 100), 0) / callsToday.length)
      : 100
  const activeAgents = new Set(
    calls.filter((c) => !c.ended_at).map((c) => c.agent_name)
  ).size

  const statCards = [
    {
      label: 'Κλήσεις σήμερα',
      value: callsToday.length,
      icon: PhoneCall,
      color: 'text-blue-400',
      bg: 'bg-blue-900/20 border-blue-800',
    },
    {
      label: 'Παραβάσεις σήμερα',
      value: violationsToday.length,
      icon: AlertTriangle,
      color: 'text-red-400',
      bg: 'bg-red-900/20 border-red-800',
    },
    {
      label: 'Μέση Βαθμολογία',
      value: `${avgScore}/100`,
      icon: Star,
      color: 'text-yellow-400',
      bg: 'bg-yellow-900/20 border-yellow-800',
    },
    {
      label: 'Ενεργοί Πράκτορες',
      value: activeAgents,
      icon: Users,
      color: 'text-green-400',
      bg: 'bg-green-900/20 border-green-800',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Dashboard Team Leader</h1>
            <p className="text-gray-400 text-sm mt-0.5">Παρακολούθηση σε πραγματικό χρόνο</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-gray-500 text-xs">
                Ενημ. {lastUpdated.toLocaleTimeString('el-GR')}
              </span>
            )}
            <button
              onClick={fetchData}
              disabled={isLoading}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Ανανέωση
            </button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border p-4 ${card.bg}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-400 text-xs">{card.label}</span>
                <card.icon className={`w-5 h-5 ${card.color}`} />
              </div>
              <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Violations table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="font-semibold text-sm">Πρόσφατες Παραβάσεις</h2>
            <span className="ml-auto text-xs text-gray-500">{violations.length} εγγραφές</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left px-4 py-2">Ώρα</th>
                  <th className="text-left px-4 py-2">Agent</th>
                  <th className="text-left px-4 py-2">Κείμενο</th>
                  <th className="text-left px-4 py-2">Λόγος</th>
                  <th className="text-left px-4 py-2">Σοβαρότητα</th>
                </tr>
              </thead>
              <tbody>
                {violations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-600 py-8">
                      Καμία παράβαση καταγεγραμμένη
                    </td>
                  </tr>
                ) : (
                  violations.map((v) => (
                    <tr key={v.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(v.occurred_at).toLocaleTimeString('el-GR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2 font-medium whitespace-nowrap">{v.agent_name}</td>
                      <td className="px-4 py-2 max-w-xs truncate text-gray-300">{v.text}</td>
                      <td className="px-4 py-2 text-xs text-gray-400 max-w-xs truncate">
                        {v.reason ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        <SeverityBadge severity={v.severity} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Calls table */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-blue-400" />
            <h2 className="font-semibold text-sm">Ιστορικό Κλήσεων</h2>
            <span className="ml-auto text-xs text-gray-500">{calls.length} εγγραφές</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left px-4 py-2">Agent</th>
                  <th className="text-left px-4 py-2">Έναρξη</th>
                  <th className="text-left px-4 py-2">Διάρκεια</th>
                  <th className="text-left px-4 py-2">Παραβάσεις</th>
                  <th className="text-left px-4 py-2">Score</th>
                  <th className="text-left px-4 py-2">Κατάσταση</th>
                </tr>
              </thead>
              <tbody>
                {calls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-600 py-8">
                      Καμία κλήση καταγεγραμμένη
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => (
                    <tr key={call.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="px-4 py-2 font-medium">{call.agent_name}</td>
                      <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(call.started_at).toLocaleString('el-GR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {formatDuration(call.duration_seconds)}
                      </td>
                      <td className="px-4 py-2 text-center">
                        {call.total_violations > 0 ? (
                          <span className="text-red-400 font-semibold">{call.total_violations}</span>
                        ) : (
                          <span className="text-green-400">0</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <ScoreBadge score={call.performance_score ?? 100} />
                      </td>
                      <td className="px-4 py-2">
                        {call.ended_at ? (
                          <span className="text-xs text-gray-500">Ολοκληρώθηκε</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-green-400">
                            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                            Ενεργή
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="mt-4 text-center">
          <a href="/agent" className="text-blue-400 hover:text-blue-300 text-sm underline">
            → Μετάβαση στο Agent UI
          </a>
        </div>
      </div>
    </div>
  )
}
