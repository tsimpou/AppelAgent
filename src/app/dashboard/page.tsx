'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, PhoneCall, AlertTriangle, Star, Users, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────
interface Call {
  id: string
  agent_name: string
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  total_violations: number
  performance_score: number
}
interface Violation {
  id: string
  agent_name: string
  text: string
  reason: string | null
  severity: string
  occurred_at: string
}
interface BanWord {
  id: string
  word: string
  severity: string
  added_by: string
  created_at: string
}
interface DailyBriefing {
  id: string
  content: string
  created_at: string
}

type TabId = 'overview' | 'briefing' | 'banwords' | 'violations' | 'calls'

// ── Helpers ────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  if (score >= 80)
    return <span className="bg-green-700 text-green-100 text-xs font-semibold px-2 py-0.5 rounded-full">{score} Άριστο</span>
  if (score >= 50)
    return <span className="bg-yellow-700 text-yellow-100 text-xs font-semibold px-2 py-0.5 rounded-full">{score} Μέτριο</span>
  return <span className="bg-red-700 text-red-100 text-xs font-semibold px-2 py-0.5 rounded-full">{score} Χαμηλό</span>
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'high')
    return <span className="bg-red-700/50 text-red-300 border border-red-600 text-xs px-2 py-0.5 rounded-full">Υψηλή</span>
  if (severity === 'low')
    return <span className="bg-gray-700 text-gray-300 border border-gray-600 text-xs px-2 py-0.5 rounded-full">Χαμηλή</span>
  return <span className="bg-yellow-700/50 text-yellow-300 border border-yellow-600 text-xs px-2 py-0.5 rounded-full">Μέτρια</span>
}

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: '📊 Overview' },
  { id: 'briefing', label: '📅 Προτάσεις Ημέρας' },
  { id: 'banwords', label: '🚫 Ban Words' },
  { id: 'violations', label: '📋 Violations' },
  { id: 'calls', label: '📞 Calls' },
]

// ── Main Component ─────────────────────────────────────────────────────
export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [calls, setCalls] = useState<Call[]>([])
  const [violations, setViolations] = useState<Violation[]>([])
  const [banWords, setBanWords] = useState<BanWord[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Tab: Briefing
  const [briefingText, setBriefingText] = useState('')
  const [isBriefingStreaming, setIsBriefingStreaming] = useState(false)
  const [briefingHistory, setBriefingHistory] = useState<DailyBriefing[]>([])
  const [expandedBriefing, setExpandedBriefing] = useState<string | null>(null)

  // Tab: Ban Words
  const [newWord, setNewWord] = useState('')
  const [newWordSeverity, setNewWordSeverity] = useState<'low' | 'medium' | 'high'>('medium')
  const [isAddingWord, setIsAddingWord] = useState(false)

  // ── Data fetching ────────────────────────────────────────────────────
  const fetchCalls = useCallback(async () => {
    const res = await fetch('/api/calls')
    const data = await res.json()
    setCalls(data.calls ?? [])
  }, [])

  const fetchViolations = useCallback(async () => {
    const res = await fetch('/api/violations?limit=100')
    const data = await res.json()
    setViolations(data.violations ?? [])
  }, [])

  const fetchBanWords = useCallback(async () => {
    const res = await fetch('/api/ban-words')
    const data = await res.json()
    setBanWords(data.words ?? [])
  }, [])

  const fetchBriefingHistory = useCallback(async () => {
    const { data } = await supabase
      .from('daily_briefings')
      .select('id, content, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    setBriefingHistory(data ?? [])
  }, [])

  const fetchAllData = useCallback(async () => {
    setIsLoading(true)
    try {
      await Promise.all([fetchCalls(), fetchViolations()])
      setLastUpdated(new Date())
    } finally {
      setIsLoading(false)
    }
  }, [fetchCalls, fetchViolations])

  useEffect(() => {
    fetchAllData()
    const interval = setInterval(fetchAllData, 30000)
    return () => clearInterval(interval)
  }, [fetchAllData])

  useEffect(() => {
    if (activeTab === 'banwords') fetchBanWords()
    if (activeTab === 'briefing') fetchBriefingHistory()
  }, [activeTab, fetchBanWords, fetchBriefingHistory])

  // ── Stats ────────────────────────────────────────────────────────────
  const today = new Date().toDateString()
  const callsToday = calls.filter((c) => new Date(c.started_at).toDateString() === today)
  const violationsToday = violations.filter((v) => new Date(v.occurred_at).toDateString() === today)
  const avgScore =
    callsToday.length > 0
      ? Math.round(callsToday.reduce((s, c) => s + (c.performance_score ?? 100), 0) / callsToday.length)
      : 100
  const activeAgentsCount = new Set(calls.filter((c) => !c.ended_at).map((c) => c.agent_name)).size

  // ── Briefing streaming ───────────────────────────────────────────────
  const generateBriefing = async () => {
    setIsBriefingStreaming(true)
    setBriefingText('')
    try {
      const res = await fetch('/api/daily-briefing')
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        accumulated += chunk
        setBriefingText(accumulated)
      }
      await fetchBriefingHistory()
    } catch (err) {
      console.error('Briefing streaming error:', err)
    } finally {
      setIsBriefingStreaming(false)
    }
  }

  // ── Ban words CRUD ────────────────────────────────────────────────────
  const addBanWord = async () => {
    if (!newWord.trim()) return
    setIsAddingWord(true)
    try {
      const res = await fetch('/api/ban-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: newWord.trim(), severity: newWordSeverity, added_by: 'admin' }),
      })
      if (res.ok) {
        setNewWord('')
        await fetchBanWords()
      }
    } catch (err) {
      console.error('Add ban word error:', err)
    } finally {
      setIsAddingWord(false)
    }
  }

  const deleteBanWord = async (id: string, word: string) => {
    if (!confirm(`Να διαγραφεί η λέξη "${word}";`)) return
    await fetch(`/api/ban-words?id=${id}`, { method: 'DELETE' })
    await fetchBanWords()
  }

  const severityChipClass = (severity: string) => {
    if (severity === 'high') return 'bg-red-800/60 border-red-600 text-red-200'
    if (severity === 'low') return 'bg-gray-700 border-gray-600 text-gray-300'
    return 'bg-yellow-800/50 border-yellow-600 text-yellow-200'
  }

  const banWordCounts = {
    high: banWords.filter((w) => w.severity === 'high').length,
    medium: banWords.filter((w) => w.severity === 'medium').length,
    low: banWords.filter((w) => w.severity === 'low').length,
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="max-w-7xl mx-auto p-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Dashboard Team Leader</h1>
            <p className="text-gray-400 text-sm mt-0.5">Παρακολούθηση σε πραγματικό χρόνο</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-gray-500 text-xs">Ενημ. {lastUpdated.toLocaleTimeString('el-GR')}</span>
            )}
            <button
              onClick={fetchAllData}
              disabled={isLoading}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              Ανανέωση
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b border-gray-800 mb-5 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'text-white border-b-2 border-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB 1: Overview ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Κλήσεις σήμερα', value: callsToday.length, icon: PhoneCall, color: 'text-blue-400', bg: 'bg-blue-900/20 border-blue-800' },
              { label: 'Παραβάσεις σήμερα', value: violationsToday.length, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-900/20 border-red-800' },
              { label: 'Μέση Βαθμολογία', value: `${avgScore}/100`, icon: Star, color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800' },
              { label: 'Ενεργοί Agents', value: activeAgentsCount, icon: Users, color: 'text-green-400', bg: 'bg-green-900/20 border-green-800' },
            ].map((card) => (
              <div key={card.label} className={`rounded-xl border p-4 ${card.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400 text-xs">{card.label}</span>
                  <card.icon className={`w-5 h-5 ${card.color}`} />
                </div>
                <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── TAB 2: Daily Briefing ────────────────────────────────────── */}
        {activeTab === 'briefing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Ενημέρωση Ημέρας —{' '}
                {new Date().toLocaleDateString('el-GR', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </h2>
              <button
                onClick={generateBriefing}
                disabled={isBriefingStreaming}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isBriefingStreaming ? 'animate-spin' : ''}`} />
                🔄 Δημιουργία Νέου Briefing
              </button>
            </div>

            {/* Briefing content card */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 min-h-48">
              {!briefingText && !isBriefingStreaming && (
                <p className="text-gray-500 text-sm text-center mt-10">
                  Πατήστε «Δημιουργία Νέου Briefing» για να παράγετε ενημέρωση με AI.
                </p>
              )}
              {isBriefingStreaming && !briefingText && (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-gray-700 rounded w-3/4" />
                  <div className="h-4 bg-gray-700 rounded w-1/2" />
                  <p className="text-gray-500 text-sm mt-4">🤔 Φόρτωση briefing...</p>
                </div>
              )}
              {briefingText && (
                <div className="relative">
                  <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                    {briefingText}
                    {isBriefingStreaming && (
                      <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-middle" />
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* History */}
            {briefingHistory.length > 0 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-800">
                  <h3 className="text-sm font-semibold text-gray-300">📚 Ιστορικό (τελευταία 5)</h3>
                </div>
                <div className="divide-y divide-gray-800">
                  {briefingHistory.map((b) => (
                    <div key={b.id} className="px-4 py-3">
                      <button
                        onClick={() => setExpandedBriefing(expandedBriefing === b.id ? null : b.id)}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <div>
                          <span className="text-xs text-gray-400">
                            {new Date(b.created_at).toLocaleDateString('el-GR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          {expandedBriefing !== b.id && (
                            <p className="text-sm text-gray-400 truncate max-w-xl">
                              {b.content.slice(0, 100)}…
                            </p>
                          )}
                        </div>
                        {expandedBriefing === b.id ? (
                          <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                      </button>
                      {expandedBriefing === b.id && (
                        <p className="mt-2 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                          {b.content}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: Ban Words ─────────────────────────────────────────── */}
        {activeTab === 'banwords' && (
          <div className="space-y-4">
            {/* Add form */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-3">Προσθήκη Απαγορευμένης Λέξης</h3>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Γράψε απαγορευμένη λέξη..."
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBanWord()}
                  className="flex-1 min-w-48 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                />
                <select
                  value={newWordSeverity}
                  onChange={(e) => setNewWordSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="high">🔴 Υψηλή</option>
                  <option value="medium">🟡 Μέτρια</option>
                  <option value="low">⚪ Χαμηλή</option>
                </select>
                <button
                  onClick={addBanWord}
                  disabled={!newWord.trim() || isAddingWord}
                  className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Προσθήκη
                </button>
              </div>
            </div>

            {/* Stats bar */}
            <div className="flex flex-wrap gap-4 text-sm text-gray-400">
              <span>Σύνολο: <strong className="text-white">{banWords.length}</strong></span>
              <span>🔴 Υψηλή: <strong className="text-red-400">{banWordCounts.high}</strong></span>
              <span>🟡 Μέτρια: <strong className="text-yellow-400">{banWordCounts.medium}</strong></span>
              <span>⚪ Χαμηλή: <strong className="text-gray-300">{banWordCounts.low}</strong></span>
            </div>

            {/* Words grid */}
            {banWords.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-12">
                Δεν υπάρχουν απαγορευμένες λέξεις ακόμα
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {banWords.map((bw) => (
                  <span
                    key={bw.id}
                    className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-full text-sm font-medium ${severityChipClass(bw.severity)}`}
                  >
                    {bw.word}
                    <button
                      onClick={() => deleteBanWord(bw.id, bw.word)}
                      className="hover:opacity-70 transition-opacity ml-0.5"
                      title="Διαγραφή"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: Violations ────────────────────────────────────────── */}
        {activeTab === 'violations' && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h2 className="font-semibold text-sm">Παραβάσεις</h2>
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
                      <td colSpan={5} className="text-center text-gray-600 py-10">
                        Καμία παράβαση καταγεγραμμένη
                      </td>
                    </tr>
                  ) : (
                    violations.map((v) => (
                      <tr key={v.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(v.occurred_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{v.agent_name}</td>
                        <td className="px-4 py-2 max-w-xs truncate text-gray-300">{v.text}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 max-w-xs truncate">{v.reason ?? '—'}</td>
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
        )}

        {/* ── TAB 5: Calls ─────────────────────────────────────────────── */}
        {activeTab === 'calls' && (
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
                      <td colSpan={6} className="text-center text-gray-600 py-10">
                        Καμία κλήση καταγεγραμμένη
                      </td>
                    </tr>
                  ) : (
                    calls.map((call) => (
                      <tr key={call.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2 font-medium">{call.agent_name}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(call.started_at).toLocaleString('el-GR', {
                            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{formatDuration(call.duration_seconds)}</td>
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
        )}

        <div className="mt-4 text-center">
          <a href="/agent" className="text-blue-400 hover:text-blue-300 text-xs underline">
            → Μετάβαση στο Agent UI
          </a>
        </div>
      </div>
    </div>
  )
}
