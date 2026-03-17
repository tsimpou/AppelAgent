'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, PhoneCall, AlertTriangle, Star, Users, Plus, Trash2,
  ChevronDown, ChevronUp, Upload, Trophy, UserCircle,
} from 'lucide-react'
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
  source: string | null
  lead_id: string | null
}
interface Violation {
  id: string
  agent_name: string
  text: string
  reason: string | null
  severity: string
  occurred_at: string
  source?: string | null
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
interface CallFeedback {
  id: string
  call_id: string
  agent_name: string
  score: number
  positives: string[] | null
  improvements: string[] | null
  next_call_goal: string | null
  talk_ratio: number | null
  summary: string | null
  has_violation: boolean
  violation_reason: string | null
  source: string | null
  created_at: string
}
interface VicidialAgent {
  id: string
  username: string
  display_name: string | null
  active: boolean
}

type TabId = 'overview' | 'briefing' | 'banwords' | 'violations' | 'calls' | 'leaderboard' | 'agents'

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

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === 'vicidial_auto_qa')
    return <span className="text-xs bg-purple-800/50 text-purple-300 border border-purple-700 px-1.5 py-0.5 rounded-full">🤖 Auto QA</span>
  return <span className="text-xs bg-red-900/40 text-red-300 border border-red-800 px-1.5 py-0.5 rounded-full">🔴 Live</span>
}

function formatDuration(secs: number | null) {
  if (!secs) return '—'
  return `${Math.floor(secs / 60).toString().padStart(2, '0')}:${(secs % 60).toString().padStart(2, '0')}`
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',    label: '📊 Overview' },
  { id: 'briefing',    label: '📅 Προτάσεις Ημέρας' },
  { id: 'banwords',    label: '🚫 Ban Words' },
  { id: 'violations',  label: '📋 Violations' },
  { id: 'calls',       label: '📞 Calls' },
  { id: 'leaderboard', label: '🏆 Leaderboard' },
  { id: 'agents',      label: '👤 Agents' },
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
  const [isUploadingFile, setIsUploadingFile] = useState(false)
  const [uploadSeverity, setUploadSeverity] = useState<'low' | 'medium' | 'high'>('medium')
  const [uploadResult, setUploadResult] = useState<{ added: number; total: number } | null>(null)

  // Tab: Calls — feedback modal
  const [feedbackModal, setFeedbackModal] = useState<CallFeedback | null>(null)
  const [callFeedbacks, setCallFeedbacks] = useState<CallFeedback[]>([])

  // Tab: Leaderboard
  const [lbPeriod, setLbPeriod] = useState<'today' | 'week' | 'month'>('today')

  // Tab: Agents
  const [vicidialAgents, setVicidialAgents] = useState<VicidialAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('')
  const [agentFeedbacks, setAgentFeedbacks] = useState<CallFeedback[]>([])
  const [agentCalls, setAgentCalls] = useState<Call[]>([])
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
  const [isCoachingStreaming, setIsCoachingStreaming] = useState(false)
  const [coachingText, setCoachingText] = useState('')

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

  const fetchCallFeedbacks = useCallback(async () => {
    const { data } = await supabase
      .from('call_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    setCallFeedbacks(data ?? [])
  }, [])

  const fetchVicidialAgents = useCallback(async () => {
    const { data } = await supabase
      .from('vicidial_agents')
      .select('id, username, display_name, active')
      .eq('active', true)
      .order('display_name')
    setVicidialAgents(data ?? [])
  }, [])

  const fetchAgentData = useCallback(async (agentName: string) => {
    if (!agentName) return
    const [feedbackRes, callsRes] = await Promise.all([
      supabase
        .from('call_feedback')
        .select('*')
        .eq('agent_name', agentName)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('calls')
        .select('*')
        .eq('agent_name', agentName)
        .order('started_at', { ascending: false })
        .limit(50),
    ])
    setAgentFeedbacks(feedbackRes.data ?? [])
    setAgentCalls(callsRes.data ?? [])
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
    if (activeTab === 'calls') fetchCallFeedbacks()
    if (activeTab === 'leaderboard') fetchCallFeedbacks()
    if (activeTab === 'agents') { fetchVicidialAgents(); fetchCallFeedbacks() }
  }, [activeTab, fetchBanWords, fetchBriefingHistory, fetchCallFeedbacks, fetchVicidialAgents])

  useEffect(() => {
    if (selectedAgent) fetchAgentData(selectedAgent)
  }, [selectedAgent, fetchAgentData])

  // ── Stats ────────────────────────────────────────────────────────────
  const today = new Date().toDateString()
  const callsToday = calls.filter((c) => new Date(c.started_at).toDateString() === today)
  const violationsToday = violations.filter((v) => new Date(v.occurred_at).toDateString() === today)
  const avgScore =
    callsToday.length > 0
      ? Math.round(callsToday.reduce((s, c) => s + (c.performance_score ?? 100), 0) / callsToday.length)
      : 100
  const activeAgentsCount = new Set(callsToday.map((c) => c.agent_name)).size

  // ── Leaderboard computation ──────────────────────────────────────────
  const lbCalls = calls.filter((c) => {
    const d = new Date(c.started_at)
    const now = new Date()
    if (lbPeriod === 'today') return d.toDateString() === now.toDateString()
    if (lbPeriod === 'week') {
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7)
      return d >= weekAgo
    }
    const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1)
    return d >= monthAgo
  })

  const lbMap: Record<string, { calls: number; scoreSum: number; violations: number }> = {}
  for (const c of lbCalls) {
    if (!lbMap[c.agent_name]) lbMap[c.agent_name] = { calls: 0, scoreSum: 0, violations: 0 }
    lbMap[c.agent_name].calls += 1
    lbMap[c.agent_name].scoreSum += c.performance_score ?? 100
    lbMap[c.agent_name].violations += c.total_violations ?? 0
  }

  const prevPeriodCalls = calls.filter((c) => {
    const d = new Date(c.started_at)
    const now = new Date()
    if (lbPeriod === 'today') {
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
      return d.toDateString() === yesterday.toDateString()
    }
    if (lbPeriod === 'week') {
      const twoWeeksAgo = new Date(now); twoWeeksAgo.setDate(now.getDate() - 14)
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7)
      return d >= twoWeeksAgo && d < weekAgo
    }
    const twoMonthsAgo = new Date(now); twoMonthsAgo.setMonth(now.getMonth() - 2)
    const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth() - 1)
    return d >= twoMonthsAgo && d < monthAgo
  })

  const prevMap: Record<string, { calls: number; scoreSum: number }> = {}
  for (const c of prevPeriodCalls) {
    if (!prevMap[c.agent_name]) prevMap[c.agent_name] = { calls: 0, scoreSum: 0 }
    prevMap[c.agent_name].calls += 1
    prevMap[c.agent_name].scoreSum += c.performance_score ?? 100
  }

  const leaderboard = Object.entries(lbMap)
    .map(([agent, stats]) => {
      const avgScoreCurr = stats.calls > 0 ? Math.round(stats.scoreSum / stats.calls) : 0
      const prevStats = prevMap[agent]
      const avgScorePrev = prevStats && prevStats.calls > 0 ? Math.round(prevStats.scoreSum / prevStats.calls) : null
      const trend = avgScorePrev === null ? 'stable'
        : avgScoreCurr > avgScorePrev + 2 ? 'up'
        : avgScoreCurr < avgScorePrev - 2 ? 'down'
        : 'stable'
      return { agent, calls: stats.calls, avgScore: avgScoreCurr, violations: stats.violations, trend }
    })
    .sort((a, b) => b.avgScore - a.avgScore)

  // ── Agent score history (last 7 days) ──────────────────────────────
  const agentScoreHistory = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const dateStr = d.toDateString()
    const dayFeedbacks = agentFeedbacks.filter((f) => new Date(f.created_at).toDateString() === dateStr)
    const avg = dayFeedbacks.length > 0
      ? Math.round(dayFeedbacks.reduce((s, f) => s + f.score, 0) / dayFeedbacks.length)
      : null
    return { label: d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit' }), avg }
  })

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
        accumulated += decoder.decode(value, { stream: true })
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
      if (res.ok) { setNewWord(''); await fetchBanWords() }
    } finally {
      setIsAddingWord(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const words = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))
    if (words.length === 0) return
    setIsUploadingFile(true)
    setUploadResult(null)
    try {
      const res = await fetch('/api/ban-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words, severity: uploadSeverity, added_by: 'admin' }),
      })
      const data = await res.json()
      setUploadResult({ added: data.added ?? 0, total: data.total ?? words.length })
      await fetchBanWords()
    } finally {
      setIsUploadingFile(false)
      e.target.value = ''
    }
  }

  const deleteBanWord = async (id: string, word: string) => {
    if (!confirm(`Να διαγραφεί η λέξη "${word}";`)) return
    await fetch(`/api/ban-words?id=${id}`, { method: 'DELETE' })
    await fetchBanWords()
  }

  // ── Coaching stream ──────────────────────────────────────────────────
  const generateCoaching = async () => {
    if (!selectedAgent || agentFeedbacks.length === 0) return
    setIsCoachingStreaming(true)
    setCoachingText('')
    const feedbackSummary = agentFeedbacks.slice(0, 10).map((f, i) =>
      `[${i + 1}] Score: ${f.score}/100 | ${f.summary ?? ''} | Βελτίωση: ${(f.improvements ?? []).join(', ')}`
    ).join('\n')
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: `Coaching για agent ${selectedAgent}:\n${feedbackSummary}`,
          agentText: `Δημιούργησε personalized coaching plan για τον agent ${selectedAgent} βάσει των αξιολογήσεων. Απάντησε στα ελληνικά με συγκεκριμένες συμβουλές βελτίωσης.`,
          customerText: '',
        }),
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setCoachingText(acc)
      }
    } catch (err) {
      console.error('Coaching stream error:', err)
    } finally {
      setIsCoachingStreaming(false)
    }
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
      {/* Feedback Modal */}
      {feedbackModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setFeedbackModal(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">📋 Αξιολόγηση Κλήσης</h2>
              <button onClick={() => setFeedbackModal(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ScoreBadge score={feedbackModal.score} />
              <SourceBadge source={feedbackModal.source} />
              {feedbackModal.has_violation && (
                <span className="bg-red-700/40 text-red-300 border border-red-600 text-xs px-2 py-0.5 rounded-full">⚠️ Παράβαση</span>
              )}
            </div>
            {feedbackModal.summary && <p className="text-sm text-gray-300 bg-gray-800/50 px-3 py-2 rounded-lg">{feedbackModal.summary}</p>}
            {(feedbackModal.positives ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 mb-1">✅ Θετικά</p>
                <ul className="space-y-0.5">{(feedbackModal.positives ?? []).map((p, i) => <li key={i} className="text-sm text-gray-300">• {p}</li>)}</ul>
              </div>
            )}
            {(feedbackModal.improvements ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-yellow-400 mb-1">💡 Βελτίωση</p>
                <ul className="space-y-0.5">{(feedbackModal.improvements ?? []).map((p, i) => <li key={i} className="text-sm text-gray-300">• {p}</li>)}</ul>
              </div>
            )}
            {feedbackModal.next_call_goal && (
              <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-blue-400 mb-0.5">🎯 Στόχος επόμενης κλήσης</p>
                <p className="text-sm text-gray-300">{feedbackModal.next_call_goal}</p>
              </div>
            )}
          </div>
        </div>
      )}

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
          <div className="space-y-4">
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
            <p className="text-xs text-gray-600 text-center">Συμπεριλαμβάνει Live + Auto QA (VICIdial)</p>
          </div>
        )}

        {/* ── TAB 2: Daily Briefing ────────────────────────────────────── */}
        {activeTab === 'briefing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Ενημέρωση —{' '}
                {new Date().toLocaleDateString('el-GR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </h2>
              <button
                onClick={generateBriefing}
                disabled={isBriefingStreaming}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${isBriefingStreaming ? 'animate-spin' : ''}`} />
                🔄 Δημιουργία Briefing
              </button>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 min-h-48">
              {!briefingText && !isBriefingStreaming && (
                <p className="text-gray-500 text-sm text-center mt-10">Πατήστε «Δημιουργία Briefing» για AI ενημέρωση.</p>
              )}
              {isBriefingStreaming && !briefingText && (
                <p className="text-gray-500 text-sm animate-pulse">🤔 Φόρτωση briefing...</p>
              )}
              {briefingText && (
                <p className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {briefingText}
                  {isBriefingStreaming && <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-middle" />}
                </p>
              )}
            </div>
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
                            {new Date(b.created_at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {expandedBriefing !== b.id && (
                            <p className="text-sm text-gray-400 truncate max-w-xl">{b.content.slice(0, 100)}…</p>
                          )}
                        </div>
                        {expandedBriefing === b.id
                          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                      </button>
                      {expandedBriefing === b.id && (
                        <p className="mt-2 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">{b.content}</p>
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

            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Μαζική Εισαγωγή από Αρχείο .txt</h3>
              <p className="text-xs text-gray-500 mb-3">Μία λέξη ανά γραμμή. Γραμμές που ξεκινούν με # αγνοούνται.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={uploadSeverity}
                  onChange={(e) => setUploadSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none"
                >
                  <option value="high">🔴 Υψηλή</option>
                  <option value="medium">🟡 Μέτρια</option>
                  <option value="low">⚪ Χαμηλή</option>
                </select>
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isUploadingFile ? 'bg-gray-700 opacity-50 cursor-not-allowed' : 'bg-green-700 hover:bg-green-600'}`}>
                  <Upload className="w-4 h-4" />
                  {isUploadingFile ? 'Εισαγωγή...' : 'Επιλογή αρχείου .txt'}
                  <input type="file" accept=".txt,text/plain" className="hidden" disabled={isUploadingFile} onChange={handleFileUpload} />
                </label>
                {uploadResult && (
                  <span className="text-xs text-gray-300 bg-gray-800 border border-gray-700 px-3 py-2 rounded-lg">
                    ✅ Προστέθηκαν <strong className="text-green-400">{uploadResult.added}</strong> από{' '}
                    <strong>{uploadResult.total}</strong> λέξεις{' '}
                    {uploadResult.total - uploadResult.added > 0 && (
                      <span className="text-gray-500">({uploadResult.total - uploadResult.added} ήδη υπήρχαν)</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-400">
              <span>Σύνολο: <strong className="text-white">{banWords.length}</strong></span>
              <span>🔴 Υψηλή: <strong className="text-red-400">{banWordCounts.high}</strong></span>
              <span>🟡 Μέτρια: <strong className="text-yellow-400">{banWordCounts.medium}</strong></span>
              <span>⚪ Χαμηλή: <strong className="text-gray-300">{banWordCounts.low}</strong></span>
            </div>

            {banWords.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-12">Δεν υπάρχουν απαγορευμένες λέξεις ακόμα</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {banWords.map((bw) => (
                  <span key={bw.id} className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-full text-sm font-medium ${severityChipClass(bw.severity)}`}>
                    {bw.word}
                    <button onClick={() => deleteBanWord(bw.id, bw.word)} className="hover:opacity-70 transition-opacity ml-0.5" title="Διαγραφή">
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
                    <th className="text-left px-4 py-2">Πηγή</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-600 py-10">Καμία παράβαση καταγεγραμμένη</td></tr>
                  ) : (
                    violations.map((v) => (
                      <tr key={v.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(v.occurred_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2 font-medium whitespace-nowrap">{v.agent_name}</td>
                        <td className="px-4 py-2 max-w-xs truncate text-gray-300">{v.text}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 max-w-xs truncate">{v.reason ?? '—'}</td>
                        <td className="px-4 py-2"><SeverityBadge severity={v.severity} /></td>
                        <td className="px-4 py-2"><SourceBadge source={v.source} /></td>
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
                    <th className="text-left px-4 py-2">Πηγή</th>
                    <th className="text-left px-4 py-2">Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-gray-600 py-10">Καμία κλήση καταγεγραμμένη</td></tr>
                  ) : (
                    calls.map((call) => {
                      const fb = callFeedbacks.find((f) => f.call_id === call.id)
                      return (
                        <tr key={call.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="px-4 py-2 font-medium">{call.agent_name}</td>
                          <td className="px-4 py-2 text-xs text-gray-400 whitespace-nowrap">
                            {new Date(call.started_at).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{formatDuration(call.duration_seconds)}</td>
                          <td className="px-4 py-2 text-center">
                            {call.total_violations > 0
                              ? <span className="text-red-400 font-semibold">{call.total_violations}</span>
                              : <span className="text-green-400">0</span>}
                          </td>
                          <td className="px-4 py-2"><ScoreBadge score={call.performance_score ?? 100} /></td>
                          <td className="px-4 py-2"><SourceBadge source={call.source} /></td>
                          <td className="px-4 py-2">
                            {fb
                              ? <button onClick={() => setFeedbackModal(fb)} className="text-blue-400 hover:text-blue-300 text-xs underline">👁 Προβολή</button>
                              : <span className="text-gray-600 text-xs">—</span>}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 6: Leaderboard ───────────────────────────────────────── */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-semibold">Κατάταξη Agents</h2>
              <div className="ml-auto flex gap-1">
                {(['today', 'week', 'month'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setLbPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${lbPeriod === p ? 'bg-white text-gray-950' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
                  >
                    {p === 'today' ? 'Σήμερα' : p === 'week' ? 'Εβδομάδα' : 'Μήνας'}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left px-4 py-2">Rank</th>
                    <th className="text-left px-4 py-2">Agent</th>
                    <th className="text-right px-4 py-2">Κλήσεις</th>
                    <th className="text-right px-4 py-2">Μέσος Βαθμός</th>
                    <th className="text-right px-4 py-2">Παραβάσεις</th>
                    <th className="text-right px-4 py-2">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-600 py-10">Καμία κλήση για την επιλεγμένη περίοδο</td></tr>
                  ) : (
                    leaderboard.map((row, idx) => (
                      <tr key={row.agent} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="px-4 py-2">
                          {idx === 0 && <span className="text-lg">🥇</span>}
                          {idx === 1 && <span className="text-lg">🥈</span>}
                          {idx === 2 && <span className="text-lg">🥉</span>}
                          {idx >= 3 && <span className="text-gray-500 font-bold">#{idx + 1}</span>}
                        </td>
                        <td className="px-4 py-2 font-medium">{row.agent}</td>
                        <td className="px-4 py-2 text-right text-gray-300">{row.calls}</td>
                        <td className="px-4 py-2 text-right"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-4 py-2 text-right">
                          {row.violations > 0
                            ? <span className="text-red-400">{row.violations}</span>
                            : <span className="text-green-400">0</span>}
                        </td>
                        <td className="px-4 py-2 text-right text-lg">
                          {row.trend === 'up' && <span className="text-green-400" title="Βελτίωση">↑</span>}
                          {row.trend === 'down' && <span className="text-red-400" title="Πτώση">↓</span>}
                          {row.trend === 'stable' && <span className="text-gray-500" title="Σταθερό">→</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 7: Agents ────────────────────────────────────────────── */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <UserCircle className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold">Ανάλυση Agent</h2>
              <select
                value={selectedAgent}
                onChange={(e) => { setSelectedAgent(e.target.value); setCoachingText('') }}
                className="ml-auto bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none min-w-48"
              >
                <option value="">Επιλογή agent...</option>
                {vicidialAgents.length > 0
                  ? vicidialAgents.map((a) => (
                      <option key={a.id} value={a.display_name ?? a.username}>
                        {a.display_name ?? a.username}
                      </option>
                    ))
                  : Array.from(new Set(calls.map((c) => c.agent_name))).map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
              </select>
            </div>

            {!selectedAgent && (
              <p className="text-gray-500 text-sm text-center py-16">Επιλέξτε agent για να δείτε στατιστικά και coaching.</p>
            )}

            {selectedAgent && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'Συνολικές κλήσεις', value: agentCalls.length, color: 'text-blue-400' },
                    {
                      label: 'Μέση βαθμολογία',
                      value: agentFeedbacks.length > 0
                        ? `${Math.round(agentFeedbacks.reduce((s, f) => s + f.score, 0) / agentFeedbacks.length)}/100`
                        : '—',
                      color: 'text-yellow-400',
                    },
                    {
                      label: 'Παραβάσεις',
                      value: agentCalls.reduce((s, c) => s + (c.total_violations ?? 0), 0),
                      color: 'text-red-400',
                    },
                    {
                      label: 'Μέση διάρκεια',
                      value: (() => {
                        const valid = agentCalls.filter((c) => c.duration_seconds)
                        if (!valid.length) return '—'
                        const avg = Math.round(valid.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / valid.length)
                        return formatDuration(avg)
                      })(),
                      color: 'text-green-400',
                    },
                  ].map((s) => (
                    <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                      <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                      <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    </div>
                  ))}
                </div>

                {agentFeedbacks.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-gray-300 mb-4">📈 Βαθμολογία τελευταίων 7 ημερών</h3>
                    <div className="flex items-end gap-2 h-24">
                      {agentScoreHistory.map((day, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-xs text-gray-500">{day.avg ?? '—'}</span>
                          <div
                            className={`w-full rounded-t transition-all ${day.avg === null ? 'bg-gray-800' : day.avg >= 80 ? 'bg-green-600' : day.avg >= 50 ? 'bg-yellow-600' : 'bg-red-600'}`}
                            style={{ height: day.avg ? `${(day.avg / 100) * 80}px` : '4px' }}
                          />
                          <span className="text-xs text-gray-600">{day.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-gray-300">🤖 AI Coaching Tips</h3>
                    <button
                      onClick={generateCoaching}
                      disabled={isCoachingStreaming || agentFeedbacks.length === 0}
                      className="flex items-center gap-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${isCoachingStreaming ? 'animate-spin' : ''}`} />
                      Δημιούργησε Coaching Plan
                    </button>
                  </div>
                  {!coachingText && !isCoachingStreaming && (
                    <p className="text-xs text-gray-600">
                      {agentFeedbacks.length === 0
                        ? 'Δεν υπάρχουν αξιολογήσεις για αυτόν τον agent.'
                        : 'Πατήστε «Δημιούργησε Coaching Plan» για AI ανάλυση.'}
                    </p>
                  )}
                  {isCoachingStreaming && !coachingText && (
                    <p className="text-xs text-gray-400 animate-pulse">🤔 Ανάλυση απόδοσης...</p>
                  )}
                  {coachingText && (
                    <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {coachingText}
                      {isCoachingStreaming && <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-middle" />}
                    </p>
                  )}
                </div>

                {agentFeedbacks.length > 0 && (
                  <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <h3 className="text-sm font-semibold text-gray-300">📋 Τελευταίες {agentFeedbacks.length} Αξιολογήσεις</h3>
                    </div>
                    <div className="divide-y divide-gray-800">
                      {agentFeedbacks.map((fb) => (
                        <div key={fb.id} className="px-4 py-3">
                          <button
                            onClick={() => setExpandedFeedback(expandedFeedback === fb.id ? null : fb.id)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-3">
                              <ScoreBadge score={fb.score} />
                              <span className="text-xs text-gray-400">
                                {new Date(fb.created_at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <SourceBadge source={fb.source} />
                            </div>
                            {expandedFeedback === fb.id
                              ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                              : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                          </button>
                          {expandedFeedback === fb.id && (
                            <div className="mt-3 space-y-2">
                              {fb.summary && <p className="text-sm text-gray-300 bg-gray-800/50 px-3 py-2 rounded-lg">{fb.summary}</p>}
                              {(fb.positives ?? []).length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-green-400 mb-1">✅ Θετικά</p>
                                  {(fb.positives ?? []).map((p, i) => <p key={i} className="text-xs text-gray-300">• {p}</p>)}
                                </div>
                              )}
                              {(fb.improvements ?? []).length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-yellow-400 mb-1">💡 Βελτίωση</p>
                                  {(fb.improvements ?? []).map((p, i) => <p key={i} className="text-xs text-gray-300">• {p}</p>)}
                                </div>
                              )}
                              {fb.next_call_goal && (
                                <p className="text-xs text-blue-300 bg-blue-900/20 border border-blue-800/40 rounded px-2 py-1">
                                  🎯 {fb.next_call_goal}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
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
