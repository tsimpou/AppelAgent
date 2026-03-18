'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, PhoneCall, AlertTriangle, Users, Plus, Trash2,
  ChevronDown, ChevronUp, Upload, Trophy,
  Headphones, LayoutDashboard, CalendarDays, ShieldAlert,
  ExternalLink, Bot, Sparkles, X, Radio,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import LiveWallboardTab from '@/components/LiveWallboardTab'
import { useLiveWallboard, type LiveAgent as LiveAgentWallboard } from '@/hooks/useLiveWallboard'

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
  recording_url: string | null
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

type TabId = 'overview' | 'briefing' | 'banwords' | 'violations' | 'calls' | 'leaderboard' | 'agents' | 'live'

// ── Helpers ────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80
      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
      : score >= 50
      ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
      : 'bg-red-500/10 text-red-400 border border-red-500/20'
  const label = score >= 80 ? 'Άριστο' : score >= 50 ? 'Μέτριο' : 'Χαμηλό'
  return (
    <span className={`${cls} text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap`}>
      {label} {score}
    </span>
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  if (severity === 'high')
    return <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium px-2.5 py-1 rounded-full">Υψηλή</span>
  if (severity === 'low')
    return <span className="bg-zinc-700/50 text-zinc-400 border border-zinc-600/20 text-xs font-medium px-2.5 py-1 rounded-full">Χαμηλή</span>
  return <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-xs font-medium px-2.5 py-1 rounded-full">Μέτρια</span>
}

function SourceBadge({ source }: { source: string | null | undefined }) {
  if (source === 'vicidial_auto_qa')
    return <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2.5 py-1 rounded-full font-medium">Auto QA</span>
  return <span className="text-xs bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2.5 py-1 rounded-full font-medium">Live</span>
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
  const [agentViolations, setAgentViolations] = useState<Violation[]>([])
  const [liveAgentStatus, setLiveAgentStatus] = useState<{ status: string; lead_id: string | null; calls_today: number; campaign_name: string } | null>(null)
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null)
  const [isCoachingStreaming, setIsCoachingStreaming] = useState(false)
  const [coachingText, setCoachingText] = useState('')

  // ── Live Wallboard data (shared across tabs) ────────────────────────
  const { agents: liveAgents, groupStats: liveGroupStats } = useLiveWallboard()

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
    const [feedbackRes, callsRes, violationsRes, liveRes] = await Promise.all([
      supabase
        .from('call_feedback')
        .select('*')
        .eq('agent_name', agentName)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('calls')
        .select('*')
        .eq('agent_name', agentName)
        .order('started_at', { ascending: false })
        .limit(100),
      supabase
        .from('violations')
        .select('*')
        .eq('agent_name', agentName)
        .order('occurred_at', { ascending: false })
        .limit(100),
      supabase
        .from('live_agents')
        .select('status, lead_id, calls_today, campaign_name')
        .eq('full_name', agentName)
        .maybeSingle(),
    ])
    setAgentFeedbacks(feedbackRes.data ?? [])
    setAgentCalls(callsRes.data ?? [])
    setAgentViolations(violationsRes.data ?? [])
    setLiveAgentStatus(liveRes.data ?? null)
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
    if (severity === 'high') return 'bg-red-500/10 border-red-500/30 text-red-400'
    if (severity === 'low') return 'bg-zinc-700/50 border-zinc-600/50 text-zinc-400'
    return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
  }

  const banWordCounts = {
    high: banWords.filter((w) => w.severity === 'high').length,
    medium: banWords.filter((w) => w.severity === 'medium').length,
    low: banWords.filter((w) => w.severity === 'low').length,
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex">
      {/* Feedback Modal */}
      {feedbackModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setFeedbackModal(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg text-white">Αξιολόγηση Κλήσης</h2>
              <button onClick={() => setFeedbackModal(null)} className="text-zinc-500 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <ScoreBadge score={feedbackModal.score} />
              <SourceBadge source={feedbackModal.source} />
              {feedbackModal.has_violation && (
                <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold px-2.5 py-1 rounded-full">Παράβαση</span>
              )}
            </div>
            {feedbackModal.summary && <p className="text-sm text-zinc-300 bg-zinc-800/50 px-3 py-2 rounded-xl">{feedbackModal.summary}</p>}
            {(feedbackModal.positives ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 mb-1">Θετικά</p>
                <ul className="space-y-0.5">{(feedbackModal.positives ?? []).map((p, i) => <li key={i} className="text-sm text-zinc-300">• {p}</li>)}</ul>
              </div>
            )}
            {(feedbackModal.improvements ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-yellow-400 mb-1">Βελτίωση</p>
                <ul className="space-y-0.5">{(feedbackModal.improvements ?? []).map((p, i) => <li key={i} className="text-sm text-zinc-300">• {p}</li>)}</ul>
              </div>
            )}
            {feedbackModal.next_call_goal && (
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2">
                <p className="text-xs font-semibold text-indigo-400 mb-0.5">Στόχος επόμενης κλήσης</p>
                <p className="text-sm text-zinc-300">{feedbackModal.next_call_goal}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Sidebar ── */}
      <aside className="fixed left-0 top-0 bottom-0 w-60 bg-zinc-950 border-r border-zinc-800 flex flex-col z-40">
        <div className="h-16 flex items-center px-5 border-b border-zinc-800 gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Headphones className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Agent Assist</p>
            <p className="text-[10px] text-zinc-500">Manager Dashboard</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {[
            { id: 'overview',    icon: LayoutDashboard, label: 'Overview' },
            { id: 'briefing',    icon: CalendarDays,    label: 'Προτάσεις Ημέρας' },
            { id: 'banwords',    icon: ShieldAlert,     label: 'Ban Words' },
            { id: 'violations',  icon: AlertTriangle,   label: 'Violations' },
            { id: 'calls',       icon: PhoneCall,       label: 'Κλήσεις' },
            { id: 'leaderboard', icon: Trophy,          label: 'Leaderboard' },
            { id: 'agents',      icon: Users,           label: 'Agents' },
            { id: 'live',        icon: Radio,           label: 'Live Wallboard' },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as TabId)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all ${
                activeTab === id
                  ? 'bg-indigo-600/10 text-indigo-400 font-medium'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${id === 'live' ? 'text-red-400' : ''}`} />
              {label}
              {id === 'violations' && violationsToday.length > 0 && (
                <span className="ml-auto bg-red-500/20 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {violationsToday.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-zinc-800 space-y-2">
          <div className="flex items-center gap-2 px-3 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
            {activeAgentsCount} agents ενεργοί
          </div>
          <a href="/agent"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-zinc-500 hover:text-white hover:bg-zinc-800 transition-all">
            <ExternalLink className="w-3.5 h-3.5" /> Agent View
          </a>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="ml-60 min-h-screen bg-zinc-950 flex flex-col">
        {/* Page header */}
        <div className="h-16 border-b border-zinc-800 flex items-center px-8 gap-4 shrink-0">
          <h1 className="text-lg font-semibold text-white">
            {activeTab === 'overview' && 'Overview'}
            {activeTab === 'briefing' && 'Προτάσεις Ημέρας'}
            {activeTab === 'banwords' && 'Ban Words'}
            {activeTab === 'violations' && 'Violations'}
            {activeTab === 'calls' && 'Ιστορικό Κλήσεων'}
            {activeTab === 'leaderboard' && 'Leaderboard'}
            {activeTab === 'agents' && 'Agents'}
            {activeTab === 'live' && 'Live Wallboard'}
          </h1>
          <div className="flex-1" />
          {lastUpdated && (
            <span className="text-xs text-zinc-600">Ανανέωση κάθε 30s</span>
          )}
          <button
            onClick={fetchAllData}
            disabled={isLoading}
            className="text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="p-8 flex-1">

        {/* ── TAB 0: Live Wallboard ────────────────────────────────────── */}
        {activeTab === 'live' && <LiveWallboardTab />}

        {/* ── TAB 1: Overview ──────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'ΚΛΗΣΕΙΣ ΣΗΜΕΡΑ', value: callsToday.length, sub: 'live + auto QA' },
                { label: 'ΠΑΡΑΒΑΣΕΙΣ', value: violationsToday.length, sub: 'σήμερα' },
                { label: 'ΜΕΣΟΣ ΒΑΘΜΟΣ', value: `${avgScore}/100`, sub: 'performance' },
                { label: 'ΕΝΕΡΓΟΙ AGENTS', value: activeAgentsCount, sub: 'με κλήσεις σήμερα' },
              ].map(({ label, value, sub }) => (
                <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 mb-2">{label}</p>
                  <p className="text-3xl font-bold text-white mb-1">{value}</p>
                  <p className="text-xs text-zinc-600">{sub}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl">
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Πρόσφατες Παραβάσεις</h2>
                  <button onClick={() => setActiveTab('violations')} className="text-xs text-zinc-500 hover:text-indigo-400 transition-colors">Όλες →</button>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {violationsToday.slice(0, 5).map((v) => (
                    <div key={v.id} className="px-5 py-3 flex items-center gap-3">
                      <div className="w-1.5 h-1.5 bg-red-500 rounded-full shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-300 truncate">{v.agent_name}</p>
                        <p className="text-xs text-zinc-600 truncate">{v.text}</p>
                      </div>
                      <SeverityBadge severity={v.severity} />
                    </div>
                  ))}
                  {violationsToday.length === 0 && (
                    <div className="px-5 py-6 text-center text-xs text-zinc-600">Καμία παράβαση σήμερα</div>
                  )}
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl">
                <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-white">Top Agents Σήμερα</h2>
                  <button onClick={() => setActiveTab('leaderboard')} className="text-xs text-zinc-500 hover:text-indigo-400 transition-colors">Leaderboard →</button>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {leaderboard.slice(0, 5).map((row, i) => (
                    <div key={row.agent} className="px-5 py-3 flex items-center gap-3">
                      <span className="text-sm w-6 text-center">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : <span className="text-zinc-600 font-medium text-xs">#{i+1}</span>}
                      </span>
                      <div className="w-7 h-7 bg-indigo-600/20 rounded-lg flex items-center justify-center text-xs font-bold text-indigo-400">
                        {row.agent.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm text-zinc-300 flex-1">{row.agent}</span>
                      <ScoreBadge score={row.avgScore} />
                    </div>
                  ))}
                  {leaderboard.length === 0 && (
                    <div className="px-5 py-6 text-center text-xs text-zinc-600">Καμία κλήση σήμερα</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 2: Daily Briefing ────────────────────────────────────── */}
        {activeTab === 'briefing' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                {new Date().toLocaleDateString('el-GR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </h2>
              <button
                onClick={generateBriefing}
                disabled={isBriefingStreaming}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-xl transition-all duration-150 flex items-center gap-2 text-sm"
              >
                <Sparkles className={`w-4 h-4 ${isBriefingStreaming ? 'animate-spin' : ''}`} />
                Δημιουργία Briefing
              </button>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 min-h-48">
              {!briefingText && !isBriefingStreaming && (
                <p className="text-zinc-600 text-sm text-center mt-8">Πατήστε «Δημιουργία Briefing» για AI ενημέρωση.</p>
              )}
              {isBriefingStreaming && !briefingText && (
                <p className="text-zinc-500 text-sm animate-pulse">Φόρτωση briefing...</p>
              )}
              {briefingText && (
                <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">
                  {briefingText}
                  {isBriefingStreaming && <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-middle" />}
                </p>
              )}
            </div>
            {briefingHistory.length > 0 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-zinc-800">
                  <h3 className="text-sm font-semibold text-white">Ιστορικό (τελευταία 5)</h3>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {briefingHistory.map((b) => (
                    <div key={b.id} className="px-5 py-3">
                      <button
                        onClick={() => setExpandedBriefing(expandedBriefing === b.id ? null : b.id)}
                        className="w-full flex items-center justify-between text-left hover:opacity-80 transition-opacity"
                      >
                        <div>
                          <span className="text-xs text-zinc-400">
                            {new Date(b.created_at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {expandedBriefing !== b.id && (
                            <p className="text-sm text-zinc-500 truncate max-w-xl">{b.content.slice(0, 100)}…</p>
                          )}
                        </div>
                        {expandedBriefing === b.id
                          ? <ChevronUp className="w-4 h-4 text-zinc-500 shrink-0" />
                          : <ChevronDown className="w-4 h-4 text-zinc-500 shrink-0" />}
                      </button>
                      {expandedBriefing === b.id && (
                        <p className="mt-2 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{b.content}</p>
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
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Προσθήκη Απαγορευμένης Λέξης</h3>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Γράψε απαγορευμένη λέξη..."
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBanWord()}
                  className="flex-1 min-w-48 bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all"
                />
                <select
                  value={newWordSeverity}
                  onChange={(e) => setNewWordSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                >
                  <option value="high">Υψηλή</option>
                  <option value="medium">Μέτρια</option>
                  <option value="low">Χαμηλή</option>
                </select>
                <button
                  onClick={addBanWord}
                  disabled={!newWord.trim() || isAddingWord}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-xl transition-all duration-150 flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Προσθήκη
                </button>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-1">Μαζική Εισαγωγή από Αρχείο .txt</h3>
              <p className="text-xs text-zinc-500 mb-4">Μία λέξη ανά γραμμή. Γραμμές που ξεκινούν με # αγνοούνται.</p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={uploadSeverity}
                  onChange={(e) => setUploadSeverity(e.target.value as 'low' | 'medium' | 'high')}
                  className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                >
                  <option value="high">Υψηλή</option>
                  <option value="medium">Μέτρια</option>
                  <option value="low">Χαμηλή</option>
                </select>
                <label className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl text-sm font-medium transition-all ${isUploadingFile ? 'bg-zinc-700 opacity-50 cursor-not-allowed' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'}`}>
                  <Upload className="w-4 h-4" />
                  {isUploadingFile ? 'Εισαγωγή...' : 'Επιλογή αρχείου .txt'}
                  <input type="file" accept=".txt,text/plain" className="hidden" disabled={isUploadingFile} onChange={handleFileUpload} />
                </label>
                {uploadResult && (
                  <span className="text-xs text-zinc-300 bg-zinc-800 border border-zinc-700 px-3 py-2 rounded-xl">
                    Προστέθηκαν <strong className="text-green-400">{uploadResult.added}</strong> από{' '}
                    <strong>{uploadResult.total}</strong> λέξεις{' '}
                    {uploadResult.total - uploadResult.added > 0 && (
                      <span className="text-zinc-500">({uploadResult.total - uploadResult.added} ήδη υπήρχαν)</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
              <span>Σύνολο: <strong className="text-white">{banWords.length}</strong></span>
              <span>Υψηλή: <strong className="text-red-400">{banWordCounts.high}</strong></span>
              <span>Μέτρια: <strong className="text-yellow-400">{banWordCounts.medium}</strong></span>
              <span>Χαμηλή: <strong className="text-zinc-300">{banWordCounts.low}</strong></span>
            </div>

            {banWords.length === 0 ? (
              <p className="text-zinc-600 text-sm text-center py-12">Δεν υπάρχουν απαγορευμένες λέξεις ακόμα</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {banWords.map((bw) => (
                  <span key={bw.id} className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-full text-sm font-medium ${severityChipClass(bw.severity)}`}>
                    {bw.word}
                    <button onClick={() => deleteBanWord(bw.id, bw.word)} className="hover:opacity-70 transition-opacity ml-0.5">
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <h2 className="font-semibold text-sm text-white">Παραβάσεις</h2>
              <span className="ml-auto text-xs text-zinc-500">{violations.length} εγγραφές</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Ώρα</th>
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Agent</th>
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Κείμενο</th>
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Λόγος</th>
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Σοβαρότητα</th>
                    <th className="text-left py-3 px-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Πηγή</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {violations.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-zinc-600 py-10 text-sm">Καμία παράβαση καταγεγραμμένη</td></tr>
                  ) : (
                    violations.map((v) => (
                      <tr key={v.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="py-3 px-4 text-xs text-zinc-400 whitespace-nowrap">
                          {new Date(v.occurred_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4 font-medium whitespace-nowrap text-zinc-200">{v.agent_name}</td>
                        <td className="py-3 px-4 max-w-xs truncate text-zinc-300">{v.text}</td>
                        <td className="py-3 px-4 text-xs text-zinc-400 max-w-xs truncate">{v.reason ?? '—'}</td>
                        <td className="py-3 px-4"><SeverityBadge severity={v.severity} /></td>
                        <td className="py-3 px-4"><SourceBadge source={v.source} /></td>
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
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-sm">Ιστορικό Κλήσεων</h2>
              <span className="ml-auto text-xs text-zinc-500">{calls.length} εγγραφές</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                    <th className="text-left px-5 py-3">Agent</th>
                    <th className="text-left px-5 py-3">Έναρξη</th>
                    <th className="text-left px-5 py-3">Διάρκεια</th>
                    <th className="text-left px-5 py-3">Παραβάσεις</th>
                    <th className="text-left px-5 py-3">Score</th>
                    <th className="text-left px-5 py-3">Πηγή</th>
                    <th className="text-left px-5 py-3">Feedback</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {calls.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-zinc-600 py-12">Καμία κλήση καταγεγραμμένη</td></tr>
                  ) : (
                    calls.map((call) => {
                      const fb = callFeedbacks.find((f) => f.call_id === call.id)
                      return (
                        <tr key={call.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="px-5 py-3 font-medium">{call.agent_name}</td>
                          <td className="px-5 py-3 text-xs text-zinc-400 whitespace-nowrap">
                            {new Date(call.started_at).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-zinc-300">{formatDuration(call.duration_seconds)}</td>
                          <td className="px-5 py-3 text-center">
                            {call.total_violations > 0
                              ? <span className="text-red-400 font-semibold">{call.total_violations}</span>
                              : <span className="text-green-400">0</span>}
                          </td>
                          <td className="px-5 py-3"><ScoreBadge score={call.performance_score ?? 100} /></td>
                          <td className="px-5 py-3"><SourceBadge source={call.source} /></td>
                          <td className="px-5 py-3">
                            {fb
                              ? <button onClick={() => setFeedbackModal(fb)} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium transition-colors">Προβολή</button>
                              : <span className="text-zinc-600 text-xs">—</span>}
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
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Trophy className="w-5 h-5 text-yellow-400" />
              <h2 className="text-lg font-semibold">Κατάταξη Agents</h2>
              <div className="ml-auto flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                {(['today', 'week', 'month'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setLbPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${lbPeriod === p ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {p === 'today' ? 'Σήμερα' : p === 'week' ? 'Εβδομάδα' : 'Μήνας'}
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-800">
                    <th className="text-left px-5 py-3">Rank</th>
                    <th className="text-left px-5 py-3">Agent</th>
                    <th className="text-right px-5 py-3">Κλήσεις</th>
                    <th className="text-right px-5 py-3">Μέσος Βαθμός</th>
                    <th className="text-right px-5 py-3">Παραβάσεις</th>
                    <th className="text-right px-5 py-3">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {leaderboard.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-zinc-600 py-12">Καμία κλήση για την επιλεγμένη περίοδο</td></tr>
                  ) : (
                    leaderboard.map((row, idx) => (
                      <tr
                        key={row.agent}
                        className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                        onClick={() => { setSelectedAgent(row.agent); setActiveTab('agents') }}
                      >
                        <td className="px-5 py-3">
                          {idx === 0 && <span className="text-lg">🥇</span>}
                          {idx === 1 && <span className="text-lg">🥈</span>}
                          {idx === 2 && <span className="text-lg">🥉</span>}
                          {idx >= 3 && <span className="text-zinc-500 font-bold">#{idx + 1}</span>}
                        </td>
                        <td className="px-5 py-3 font-medium">{row.agent}</td>
                        <td className="px-5 py-3 text-right text-zinc-300">{row.calls}</td>
                        <td className="px-5 py-3 text-right"><ScoreBadge score={row.avgScore} /></td>
                        <td className="px-5 py-3 text-right">
                          {row.violations > 0
                            ? <span className="text-red-400">{row.violations}</span>
                            : <span className="text-green-400">0</span>}
                        </td>
                        <td className="px-5 py-3 text-right text-base">
                          {row.trend === 'up' && <span className="text-green-400" title="Βελτίωση">↑</span>}
                          {row.trend === 'down' && <span className="text-red-400" title="Πτώση">↓</span>}
                          {row.trend === 'stable' && <span className="text-zinc-500" title="Σταθερό">→</span>}
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
        {activeTab === 'agents' && (() => {
          const recordedCalls  = agentCalls.filter((c) => c.recording_url)
          const totalViolations = agentCalls.reduce((s, c) => s + (c.total_violations ?? 0), 0)
          const avgScore = agentFeedbacks.length > 0
            ? Math.round(agentFeedbacks.reduce((s, f) => s + f.score, 0) / agentFeedbacks.length)
            : null
          const liveScore = agentFeedbacks[0]?.score ?? null
          const validDur = agentCalls.filter((c) => c.duration_seconds)
          const avgDur = validDur.length > 0
            ? Math.round(validDur.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / validDur.length)
            : null

          // Problem analysis
          const violationReasons = agentViolations.reduce<Record<string, number>>((acc, v) => {
            const key = v.reason ?? 'Άγνωστη παράβαση'
            acc[key] = (acc[key] ?? 0) + 1
            return acc
          }, {})
          const topProblems = Object.entries(violationReasons).sort((a, b) => b[1] - a[1]).slice(0, 5)

          const liveStatusColors: Record<string, string> = {
            INCALL: 'bg-red-500/10 border-red-500/30 text-red-300',
            READY:  'bg-green-500/10 border-green-500/30 text-green-300',
            PAUSED: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
            DISPO:  'bg-blue-500/10 border-blue-500/30 text-blue-300',
          }

          return (
            <div className="space-y-5">

              {/* Header + selector */}
              <div className="flex items-center gap-3 flex-wrap">
                <Users className="w-5 h-5 text-indigo-400" />
                <h2 className="text-lg font-semibold">Ανάλυση Agent</h2>
                <select
                  value={selectedAgent}
                  onChange={(e) => { setSelectedAgent(e.target.value); setCoachingText(''); setLiveAgentStatus(null) }}
                  className="ml-auto bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/40 min-w-56"
                >
                  <option value="">Επιλογή agent...</option>
                  {liveAgents.length > 0 && (
                    <optgroup label={`🟢 Live Σύνδεδεμένοι (${liveAgents.length})`}>
                      {liveAgents.map((a) => {
                        const statusIcon = a.status === 'INCALL' ? '🔴' : a.status === 'READY' ? '🟢' : a.status === 'PAUSED' ? '🟡' : '🔵'
                        return (
                          <option key={a.user_vicidial} value={a.full_name}>
                            {statusIcon} {a.full_name} — {a.campaign_name} ({a.calls_today} κλ.)
                          </option>
                        )
                      })}
                    </optgroup>
                  )}
                  <optgroup label="📜 Ιστορικό">
                    {Array.from(new Set(calls.map((c) => c.agent_name)))
                      .filter((name) => !liveAgents.some((a) => a.full_name === name))
                      .map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                  </optgroup>
                </select>
              </div>

              {!selectedAgent && (
                <p className="text-zinc-500 text-sm text-center py-16">Επιλέξτε agent για να δείτε στατιστικά και coaching.</p>
              )}

              {selectedAgent && (
                <>
                  {/* Live status banner */}
                  {liveAgentStatus && (
                    <div className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl border text-sm ${liveStatusColors[liveAgentStatus.status] ?? 'bg-zinc-800/50 border-zinc-700 text-zinc-300'}`}>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${liveAgentStatus.status === 'INCALL' ? 'bg-red-500 animate-pulse' : liveAgentStatus.status === 'READY' ? 'bg-green-500' : liveAgentStatus.status === 'PAUSED' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
                      <span className="font-medium">LIVE —</span>
                      <span>
                        {liveAgentStatus.status === 'INCALL' ? 'Σε κλήση' : liveAgentStatus.status === 'READY' ? 'Διαθέσιμος' : liveAgentStatus.status === 'PAUSED' ? 'Παύση' : liveAgentStatus.status === 'DISPO' ? 'Αποτέλεσμα' : liveAgentStatus.status}
                      </span>
                      {liveAgentStatus.lead_id && liveAgentStatus.lead_id !== '0' && (
                        <span className="text-xs opacity-80">
                          Lead:{' '}
                          <a href={`http://10.1.0.21/vicidial/admin_modify_lead.php?lead_id=${encodeURIComponent(liveAgentStatus.lead_id)}`} target="_blank" rel="noopener noreferrer" className="underline font-mono">
                            #{liveAgentStatus.lead_id}
                          </a>
                        </span>
                      )}
                      <span className="text-xs opacity-80">{liveAgentStatus.campaign_name}</span>
                      <span className="ml-auto text-xs opacity-80">{liveAgentStatus.calls_today} κλήσεις σήμερα</span>
                    </div>
                  )}

                  {/* Stat cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
                    {[
                      { label: 'ΣΥΝΟΛΙΚΕΣ ΚΛΗΣΕΙΣ', value: agentCalls.length, color: 'text-indigo-400' },
                      { label: 'ΜΕ ΗΧΟΓΡΑΦΗΣΗ', value: recordedCalls.length, color: 'text-blue-400' },
                      { label: 'ΜΕΣΗ ΒΑΘΜΟΛΟΓΙΑ', value: avgScore !== null ? `${avgScore}` : '—', color: avgScore !== null ? (avgScore >= 80 ? 'text-green-400' : avgScore >= 50 ? 'text-yellow-400' : 'text-red-400') : 'text-zinc-500' },
                      { label: 'LIVE SCORE', value: liveScore !== null ? `${liveScore}` : '—', color: liveScore !== null ? (liveScore >= 80 ? 'text-green-400' : liveScore >= 50 ? 'text-yellow-400' : 'text-red-400') : 'text-zinc-500', sub: 'τελευταία κλήση' },
                      { label: 'ΠΑΡΑΒΑΣΕΙΣ', value: totalViolations, color: totalViolations > 0 ? 'text-red-400' : 'text-green-400' },
                      { label: 'ΜΕΣΗ ΔΙΑΡΚΕΙΑ', value: avgDur !== null ? formatDuration(avgDur) : '—', color: 'text-green-400' },
                    ].map((s) => (
                      <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">{s.label}</p>
                        <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                        {'sub' in s && s.sub && <p className="text-[10px] text-zinc-600 mt-0.5">{s.sub}</p>}
                      </div>
                    ))}
                  </div>

                  {/* Score bar chart */}
                  {agentFeedbacks.length > 0 && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                      <h3 className="text-sm font-semibold text-zinc-300 mb-4">Βαθμολογία τελευταίων 7 ημερών</h3>
                      <div className="flex items-end gap-2 h-24">
                        {agentScoreHistory.map((day, i) => (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <span className="text-xs text-zinc-500">{day.avg ?? '—'}</span>
                            <div
                              className={`w-full rounded-t transition-all ${day.avg === null ? 'bg-zinc-800' : day.avg >= 80 ? 'bg-green-600' : day.avg >= 50 ? 'bg-yellow-600' : 'bg-red-600'}`}
                              style={{ height: day.avg ? `${(day.avg / 100) * 80}px` : '4px' }}
                            />
                            <span className="text-xs text-zinc-600">{day.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Call history table */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        Κλήσεις ({agentCalls.length} σύνολο · {recordedCalls.length} με ηχογράφηση)
                      </h3>
                      {agentCalls.length > 0 && (
                        <span className="text-xs text-zinc-500">
                          Score range:{' '}
                          <span className="text-white font-mono">
                            {Math.min(...agentFeedbacks.map(f => f.score))} – {Math.max(...agentFeedbacks.map(f => f.score))}
                          </span>
                        </span>
                      )}
                    </div>
                    {agentCalls.length === 0 ? (
                      <p className="text-zinc-600 text-sm text-center py-10">Δεν υπάρχουν κλήσεις</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-zinc-800">
                              {['Ημερομηνία', 'Lead ID', 'Ηχογράφηση', 'Score', 'Παραβάσεις', 'Διάρκεια', 'Πηγή'].map((h) => (
                                <th key={h} className="text-left py-2.5 px-4 text-[10px] font-medium uppercase tracking-widest text-zinc-500">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/40">
                            {agentCalls.map((call) => {
                              const fb = agentFeedbacks.find((f) => f.call_id === call.id)
                              const score = fb?.score ?? call.performance_score ?? null
                              return (
                                <tr key={call.id} className="hover:bg-zinc-800/20 transition-colors">
                                  <td className="py-2.5 px-4 text-zinc-400 whitespace-nowrap">
                                    {new Date(call.started_at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                    {' '}
                                    <span className="text-zinc-600">{new Date(call.started_at).toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit' })}</span>
                                  </td>
                                  <td className="py-2.5 px-4">
                                    {call.lead_id && call.lead_id !== '0' ? (
                                      <a
                                        href={`http://10.1.0.21/vicidial/admin_modify_lead.php?lead_id=${encodeURIComponent(call.lead_id)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-400 hover:text-indigo-300 font-mono transition-colors"
                                      >
                                        #{call.lead_id}
                                      </a>
                                    ) : <span className="text-zinc-700">—</span>}
                                  </td>
                                  <td className="py-2.5 px-4">
                                    {call.recording_url ? (
                                      <a href={call.recording_url} target="_blank" rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                        🎵 Άκου
                                      </a>
                                    ) : (
                                      <span className="text-zinc-700">—</span>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4">
                                    {score !== null ? <ScoreBadge score={score} /> : <span className="text-zinc-700">—</span>}
                                  </td>
                                  <td className="py-2.5 px-4">
                                    <span className={`font-bold ${(call.total_violations ?? 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                      {call.total_violations ?? 0}
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-zinc-400 font-mono">{formatDuration(call.duration_seconds)}</td>
                                  <td className="py-2.5 px-4"><SourceBadge source={call.source} /></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Problems panel */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Top violation reasons */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <h3 className="text-sm font-semibold">Κύρια Προβλήματα</h3>
                        <span className="ml-auto text-xs text-zinc-500">{agentViolations.length} παραβάσεις σύνολο</span>
                      </div>
                      {topProblems.length === 0 ? (
                        <p className="text-xs text-green-400 flex items-center gap-2">✅ Καμία παράβαση καταγράφηκε</p>
                      ) : (
                        <div className="space-y-2.5">
                          {topProblems.map(([reason, count], i) => (
                            <div key={i} className="flex items-start gap-3">
                              <span className={`text-xs font-bold shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${i === 0 ? 'bg-red-500/20 text-red-400' : i === 1 ? 'bg-orange-500/20 text-orange-400' : 'bg-zinc-700 text-zinc-400'}`}>
                                {i + 1}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-zinc-300 line-clamp-2">{reason}</p>
                                <div className="flex items-center gap-2 mt-1">
                                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${i === 0 ? 'bg-red-500' : i === 1 ? 'bg-orange-500' : 'bg-zinc-500'}`}
                                      style={{ width: `${(count / (topProblems[0][1])) * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-zinc-500 shrink-0">{count}×</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* AI Coaching */}
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Bot className="w-4 h-4 text-indigo-400" />
                          <h3 className="text-sm font-semibold">AI Coaching Plan</h3>
                        </div>
                        <button
                          onClick={generateCoaching}
                          disabled={isCoachingStreaming || agentFeedbacks.length === 0}
                          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors"
                        >
                          <Sparkles className={`w-3 h-3 ${isCoachingStreaming ? 'animate-pulse' : ''}`} />
                          Δημιούργησε Plan
                        </button>
                      </div>
                      <div className="overflow-y-auto max-h-52">
                        {!coachingText && !isCoachingStreaming && (
                          <p className="text-xs text-zinc-600">
                            {agentFeedbacks.length === 0
                              ? 'Δεν υπάρχουν αξιολογήσεις για αυτόν τον agent.'
                              : 'Πατήστε «Δημιούργησε Plan» για AI ανάλυση.'}
                          </p>
                        )}
                        {isCoachingStreaming && !coachingText && (
                          <p className="text-xs text-zinc-400 animate-pulse">Ανάλυση απόδοσης...</p>
                        )}
                        {coachingText && (
                          <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">
                            {coachingText}
                            {isCoachingStreaming && <span className="inline-block w-0.5 h-4 bg-white animate-pulse ml-0.5 align-middle" />}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Call feedback list */}
                  {agentFeedbacks.length > 0 && (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="px-5 py-3.5 border-b border-zinc-800">
                        <h3 className="text-sm font-semibold">Αξιολογήσεις Κλήσεων ({agentFeedbacks.length})</h3>
                      </div>
                      <div className="divide-y divide-zinc-800/50">
                        {agentFeedbacks.map((fb) => {
                          const matchedCall = agentCalls.find((c) => c.id === fb.call_id)
                          return (
                            <div key={fb.id} className="px-5 py-3">
                              <button
                                onClick={() => setExpandedFeedback(expandedFeedback === fb.id ? null : fb.id)}
                                className="w-full flex items-center justify-between text-left"
                              >
                                <div className="flex items-center gap-3 flex-wrap">
                                  <ScoreBadge score={fb.score} />
                                  <span className="text-xs text-zinc-400">
                                    {new Date(fb.created_at).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  {matchedCall?.lead_id && matchedCall.lead_id !== '0' && (
                                    <a
                                      href={`http://10.1.0.21/vicidial/admin_modify_lead.php?lead_id=${encodeURIComponent(matchedCall.lead_id)}`}
                                      target="_blank" rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-[10px] text-indigo-400 font-mono hover:underline"
                                    >
                                      Lead #{matchedCall.lead_id}
                                    </a>
                                  )}
                                  {matchedCall?.recording_url && (
                                    <a href={matchedCall.recording_url} target="_blank" rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                                      🎵 Rec
                                    </a>
                                  )}
                                  {fb.has_violation && (
                                    <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-0.5 rounded-full">⚠ Παράβαση</span>
                                  )}
                                  <SourceBadge source={fb.source} />
                                </div>
                                <ChevronDown className={`w-4 h-4 text-zinc-400 shrink-0 transition-transform ${expandedFeedback === fb.id ? 'rotate-180' : ''}`} />
                              </button>
                              {expandedFeedback === fb.id && (
                                <div className="mt-3 space-y-2">
                                  {fb.summary && <p className="text-sm text-zinc-300 bg-zinc-800/50 px-3 py-2 rounded-xl">{fb.summary}</p>}
                                  {fb.violation_reason && (
                                    <p className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 px-3 py-2 rounded-xl">⚠ {fb.violation_reason}</p>
                                  )}
                                  {(fb.positives ?? []).length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-green-400 mb-1">Θετικά</p>
                                      {(fb.positives ?? []).map((p, i) => <p key={i} className="text-xs text-zinc-300">• {p}</p>)}
                                    </div>
                                  )}
                                  {(fb.improvements ?? []).length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-yellow-400 mb-1">Βελτίωση</p>
                                      {(fb.improvements ?? []).map((p, i) => <p key={i} className="text-xs text-zinc-300">• {p}</p>)}
                                    </div>
                                  )}
                                  {fb.next_call_goal && (
                                    <p className="text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-3 py-2">
                                      🎯 {fb.next_call_goal}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })()}
      </div>
    </main>
  </div>
  )
}
