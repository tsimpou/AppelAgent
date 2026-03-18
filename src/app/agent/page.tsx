'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  Headphones, Plug, LogOut, RefreshCw, PhoneIncoming,
  Loader2, Mic, MessageSquare, Sparkles,
  AlertTriangle, CheckCircle, ClipboardCheck, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { startMicroSIPCapture, stopCapture, type CaptureResult } from '@/lib/audioCapture'

type AppState = 'selecting' | 'standby' | 'incall'

interface LiveAgent {
  user_vicidial: string
  full_name: string
  campaign_id: string
  campaign_name: string
  status: 'INCALL' | 'READY' | 'PAUSED' | 'DISPO' | string
  lead_id: string | null
  phone_number: string | null
  lead_first_name: string | null
  lead_last_name: string | null
  calls_today: number
  updated_at: string
}

type TranscriptEntry = {
  speaker: 'agent' | 'customer'
  text: string
  timestamp: string
}

type ViolationEntry = {
  text: string
  words: string[]
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80
      ? 'bg-green-500/10 text-green-400 border border-green-500/20'
      : score >= 50
      ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
      : 'bg-red-500/10 text-red-400 border border-red-500/20'
  const label = score >= 80 ? 'Αριστο' : score >= 50 ? 'Μετριο' : 'Χαμηλο'
  return (
    <span className={`${cls} text-xs font-semibold px-2.5 py-1 rounded-full`}>
      {label} {score}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    INCALL: 'bg-red-500 animate-pulse',
    READY:  'bg-green-500',
    PAUSED: 'bg-yellow-500',
    DISPO:  'bg-blue-500',
  }
  const labels: Record<string, string> = {
    INCALL: 'Se Klisi',
    READY:  'Diathesimos',
    PAUSED: 'Paysi',
    DISPO:  'Apotelesma',
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] ?? 'bg-zinc-500'}`} />
      {labels[status] ?? status}
    </span>
  )
}

export default function AgentPage() {
  // App state machine
  const [appState, setAppState]               = useState<AppState>('selecting')
  const [selectedAgent, setSelectedAgent]     = useState<LiveAgent | null>(null)
  const [currentLead, setCurrentLead]         = useState<LiveAgent | null>(null)
  const [liveAgents, setLiveAgents]           = useState<LiveAgent[]>([])
  const [isLoadingConnect, setIsLoadingConnect] = useState(false)

  // Call state
  const [callId, setCallId]                   = useState<string | null>(null)
  const [transcript, setTranscript]           = useState<TranscriptEntry[]>([])
  const [suggestions, setSuggestions]         = useState<string[]>([])
  const [streamingSuggestion, setStreamingSug] = useState('')
  const [isStreaming, setIsStreaming]         = useState(false)
  const [violations, setViolations]           = useState<ViolationEntry[]>([])
  const [violationAlert, setViolationAlert]   = useState(false)
  const [isProcessing, setIsProcessing]       = useState(false)
  const [deviceLabels, setDeviceLabels]       = useState<{ customer: string; agent: string } | null>(null)
  const [callDuration, setCallDuration]       = useState(0)
  const [violationCount, setViolationCount]   = useState(0)
  const [postCallFeedback, setPostCallFeedback] = useState('')
  const [showFeedback, setShowFeedback]       = useState(false)

  // Refs
  const realtimeChannelRef  = useRef<RealtimeChannel | null>(null)
  const previousStatusRef   = useRef<string>('READY')
  const mediaRecorderRef    = useRef<MediaRecorder | null>(null)
  const chunksRef           = useRef<Blob[]>([])
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureResultRef    = useRef<CaptureResult | null>(null)
  const transcriptEndRef    = useRef<HTMLDivElement>(null)
  const callStartTimeRef    = useRef<number>(0)
  const isCallActiveRef     = useRef(false)
  const callIdRef           = useRef<string | null>(null)
  const violationCountRef   = useRef(0)
  const transcriptRef       = useRef<TranscriptEntry[]>([])
  const selectedAgentRef    = useRef<LiveAgent | null>(null)

  const currentScore = Math.max(0, 100 - violationCount * 5)

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Keep refs in sync
  useEffect(() => { transcriptRef.current = transcript }, [transcript])
  useEffect(() => { selectedAgentRef.current = selectedAgent }, [selectedAgent])
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [transcript])

  // Cleanup Realtime on unmount
  useEffect(() => {
    return () => {
      if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current)
    }
  }, [])

  // ── Fetch live agents ────────────────────────────────────────────────
  const fetchLiveAgents = useCallback(async (): Promise<LiveAgent[]> => {
    const { data } = await supabase.from('live_agents').select('*').order('full_name')
    const agents = (data ?? []) as LiveAgent[]
    setLiveAgents(agents)
    return agents
  }, [])

  // Poll agent list every 30s
  useEffect(() => {
    fetchLiveAgents()
    const interval = setInterval(fetchLiveAgents, 30000)
    return () => clearInterval(interval)
  }, [fetchLiveAgents])

  // Auto-reconnect from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('agent_vicidial_user')
    if (savedUser) {
      fetchLiveAgents().then((agents) => {
        const agent = agents.find((a) => a.user_vicidial === savedUser)
        if (agent) {
          setSelectedAgent(agent)
          startAgentMonitoringFn(savedUser)
          setAppState('standby')
        } else {
          localStorage.removeItem('agent_vicidial_user')
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Audio processing ─────────────────────────────────────────────────
  const streamSuggestions = useCallback(async (transcriptText: string) => {
    setIsStreaming(true)
    setStreamingSug('')
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: transcriptText }),
      })
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value, { stream: true })
        setStreamingSug(accumulated)
      }
      const match = accumulated.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed)) setSuggestions(parsed)
        } catch {}
      }
    } catch (err) {
      console.error('streamSuggestions error:', err)
    } finally {
      setStreamingSug('')
      setIsStreaming(false)
    }
  }, [])

  const processAudioChunk = useCallback(async (blob: Blob) => {
    if (blob.size < 1000) return
    setIsProcessing(true)
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'audio.webm')
      const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const transcribeData = await transcribeRes.json()
      const text: string = transcribeData.text?.trim() ?? ''
      if (!text) return

      const entry: TranscriptEntry = {
        speaker: 'agent',
        text,
        timestamp: new Date().toLocaleTimeString('el-GR'),
      }
      setTranscript((prev) => [...prev, entry])

      const fullTranscript = [...transcriptRef.current, entry]
        .map((e) => `${e.speaker === 'agent' ? 'Praktoras' : 'Pelatis'}: ${e.text}`)
        .join('\n')

      if (callIdRef.current) {
        fetch('/api/transcripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_id: callIdRef.current, speaker: 'agent', text, is_flagged: false }),
        }).catch(console.error)
      }

      const [checkRes] = await Promise.all([
        fetch('/api/check-words', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            call_id: callIdRef.current,
            agent_name: selectedAgentRef.current?.full_name ?? '',
          }),
        }),
        streamSuggestions(fullTranscript),
      ])

      const checkData = await checkRes.json()
      if (checkData.hasViolation) {
        setViolationAlert(true)
        setTimeout(() => setViolationAlert(false), 5000)
        violationCountRef.current += 1
        setViolationCount(violationCountRef.current)
        const allWords = [...(checkData.foundWords ?? []), ...(checkData.detectedProfanity ?? [])]
        const logMsg =
          allWords.length > 0
            ? `"${allWords.join("', '")}"${checkData.aiReason ? ` - ${checkData.aiReason}` : ''}`
            : checkData.aiReason ?? 'Paravasi politikis'
        setViolations((prev) => [{ text: logMsg, words: allWords }, ...prev.slice(0, 3)])
      }
    } catch (err) {
      console.error('processAudioChunk error:', err)
    } finally {
      setIsProcessing(false)
    }
  }, [streamSuggestions])

  const createAndStartRecorder = useCallback((stream: MediaStream) => {
    if (!isCallActiveRef.current) return
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    mediaRecorderRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      await processAudioChunk(blob)
      if (isCallActiveRef.current && captureResultRef.current) {
        createAndStartRecorder(captureResultRef.current.mixedStream)
      }
    }
    mr.start()
    recordingTimeoutRef.current = setTimeout(() => {
      if (mr.state === 'recording') mr.stop()
    }, 8000)
  }, [processAudioChunk])

  // ── Call lifecycle ───────────────────────────────────────────────────
  const startCall = useCallback(async (agent: LiveAgent) => {
    isCallActiveRef.current = true
    setAppState('incall')
    setCallDuration(0)
    setViolationCount(0)
    violationCountRef.current = 0
    setTranscript([])
    setSuggestions([])
    setViolations([])
    setCurrentLead(agent)

    try {
      const res = await fetch('/api/calls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name: agent.full_name,
          lead_id: agent.lead_id ?? null,
          campaign_id: agent.campaign_id ?? null,
        }),
      })
      const data = await res.json()
      callIdRef.current = data.call_id
      setCallId(data.call_id)
    } catch (err) {
      console.error('startCall fetch error:', err)
    }

    callStartTimeRef.current = Date.now()
    durationIntervalRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000))
    }, 1000)

    try {
      const capture = await startMicroSIPCapture()
      captureResultRef.current = capture
      setDeviceLabels(capture.deviceLabels)
      createAndStartRecorder(capture.mixedStream)
    } catch (err) {
      console.error('Audio capture error:', err)
    }
  }, [createAndStartRecorder])

  const endCall = useCallback(async () => {
    if (!callIdRef.current) return
    isCallActiveRef.current = false

    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)
    if (captureResultRef.current) { stopCapture(captureResultRef.current); captureResultRef.current = null }

    const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000)
    const savedCallId = callIdRef.current
    const savedAgentName = selectedAgentRef.current?.full_name ?? ''
    const savedTranscript = transcriptRef.current
      .map((e) => `${e.speaker === 'agent' ? 'Praktoras' : 'Pelatis'}: ${e.text}`)
      .join('\n')
    const savedViolations = violationCountRef.current

    setAppState('standby')
    callIdRef.current = null
    setCallId(null)
    setCurrentLead(null)

    try {
      await fetch('/api/calls/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: savedCallId, duration_seconds: duration, total_violations: savedViolations }),
      })
    } catch (err) {
      console.error('endCall error:', err)
    }

    if (savedCallId) {
      setShowFeedback(true)
      setPostCallFeedback('')
      try {
        const fbRes = await fetch('/api/calls/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            call_id: savedCallId,
            agent_name: savedAgentName,
            transcript_text: savedTranscript,
            violations_count: savedViolations,
            duration,
          }),
        })
        if (fbRes.body) {
          const reader = fbRes.body.getReader()
          const decoder = new TextDecoder()
          let acc = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            acc += decoder.decode(value, { stream: true })
            setPostCallFeedback(acc)
          }
        }
      } catch (err) {
        console.error('feedback stream error:', err)
      }
    }
  }, [])

  // ── Supabase Realtime monitoring ─────────────────────────────────────
  const handleVicidialStatusChange = useCallback((agent: LiveAgent) => {
    const prev = previousStatusRef.current
    const curr = agent.status
    if (curr === 'INCALL' && prev !== 'INCALL') {
      console.log('VICIdial INCALL detected - starting recording')
      startCall(agent)
    }
    if (prev === 'INCALL' && (curr === 'READY' || curr === 'PAUSED' || curr === 'DISPO')) {
      console.log('VICIdial call ended - stopping recording')
      endCall()
    }
    previousStatusRef.current = curr
  }, [startCall, endCall])

  const startAgentMonitoringFn = useCallback((username: string) => {
    if (realtimeChannelRef.current) supabase.removeChannel(realtimeChannelRef.current)
    const channel = supabase
      .channel(`agent_status_${username}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'live_agents', filter: `user_vicidial=eq.${username}` },
        (payload) => handleVicidialStatusChange(payload.new as LiveAgent)
      )
      .subscribe()
    realtimeChannelRef.current = channel
  }, [handleVicidialStatusChange])

  // ── Connect / Disconnect ─────────────────────────────────────────────
  async function handleConnect() {
    if (!selectedAgent) return
    setIsLoadingConnect(true)
    localStorage.setItem('agent_vicidial_user', selectedAgent.user_vicidial)
    previousStatusRef.current = selectedAgent.status
    startAgentMonitoringFn(selectedAgent.user_vicidial)
    setAppState('standby')
    setIsLoadingConnect(false)
  }

  function handleDisconnect() {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current)
      realtimeChannelRef.current = null
    }
    localStorage.removeItem('agent_vicidial_user')
    setSelectedAgent(null)
    setAppState('selecting')
  }

  // ── RENDER ───────────────────────────────────────────────────────────

  // STATE 1: Selecting
  if (appState === 'selecting') {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-6">

          <div className="text-center space-y-2">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
              <Headphones className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-white">Agent Assist</h1>
            <p className="text-sm text-zinc-500">Epelexe to onoma sou gia na xekiniseis</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              Logged-in Agents ({liveAgents.length})
            </label>

            <select
              value={selectedAgent?.user_vicidial ?? ''}
              onChange={(e) => {
                const agent = liveAgents.find((a) => a.user_vicidial === e.target.value) ?? null
                setSelectedAgent(agent)
              }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all appearance-none"
            >
              <option value="">Epelexe agent</option>
              {liveAgents.map((agent) => (
                <option key={agent.user_vicidial} value={agent.user_vicidial}>
                  {agent.full_name} ({agent.campaign_name})
                </option>
              ))}
            </select>

            {selectedAgent && (
              <div className="bg-zinc-800/50 rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-600/20 rounded-xl flex items-center justify-center text-sm font-bold text-indigo-400 shrink-0">
                  {selectedAgent.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{selectedAgent.full_name}</p>
                  <p className="text-xs text-zinc-500">
                    @{selectedAgent.user_vicidial} · {selectedAgent.campaign_name} · {selectedAgent.calls_today} kliseis simera
                  </p>
                </div>
                <StatusDot status={selectedAgent.status} />
              </div>
            )}

            <button
              onClick={handleConnect}
              disabled={!selectedAgent || isLoadingConnect}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoadingConnect ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Syndesi...</>
              ) : (
                <><Plug className="w-4 h-4" /> Syndesi</>
              )}
            </button>
          </div>

          <button
            onClick={() => fetchLiveAgents()}
            className="w-full text-xs text-zinc-600 hover:text-zinc-400 flex items-center justify-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Ananewsi listas
          </button>

        </div>
      </div>
    )
  }

  // STATES 2 & 3: standby + incall
  return (
    <div className="bg-zinc-950 min-h-screen overflow-hidden">

      {/* Violation Alert Overlay */}
      {violationAlert && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-950 border border-red-800 text-red-300 px-5 py-3 rounded-2xl shadow-2xl shadow-red-950/50 animate-bounce">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="font-semibold text-sm text-red-200">Apagoreymenи Lexi</p>
            <p className="text-xs text-red-400">O agent chrisimopoiise akatallili ekfrasi</p>
          </div>
        </div>
      )}

      {/* Topbar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Headphones className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{selectedAgent?.full_name}</p>
            <p className="text-[10px] text-zinc-500">{selectedAgent?.campaign_name}</p>
          </div>
        </div>

        <div className="h-5 w-px bg-zinc-800" />

        {deviceLabels && appState === 'incall' && (
          <div className="hidden md:flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" />
              {deviceLabels.customer}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full" />
              {deviceLabels.agent}
            </span>
          </div>
        )}

        <div className="flex-1" />

        {isProcessing && (
          <span className="text-xs text-zinc-500 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-pulse" />
            Epeksergasia
          </span>
        )}

        <a href="/dashboard" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors hidden md:block">
          Dashboard
        </a>

        {appState === 'standby' && (
          <div className="flex items-center gap-2 bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-2">
            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
            <span className="text-sm text-yellow-400 font-medium">Anamoni Klisis</span>
          </div>
        )}

        {appState === 'incall' && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm text-red-400 font-medium">Se Klisi</span>
          </div>
        )}

        <button
          onClick={handleDisconnect}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-sm px-3 py-2 rounded-xl transition-all flex items-center gap-2"
        >
          <LogOut className="w-4 h-4" /> Apostndesi
        </button>
      </header>

      {/* Status Bar (incall only) */}
      {appState === 'incall' && (
        <div className="fixed top-16 left-0 right-0 z-30 h-9 bg-red-950/40 border-b border-red-900/30 flex items-center px-6 gap-6 text-xs">
          <span className="flex items-center gap-1.5 text-red-400 font-medium">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            REC {formatDuration(callDuration)}
          </span>

          <div className="h-4 w-px bg-red-900/50" />

          {currentLead?.lead_id && currentLead.lead_id !== '0' && (
            <>
              <span className="text-zinc-500">
                Lead:{' '}
                <a
                  href={`http://10.1.0.21/vicidial/admin_modify_lead.php?lead_id=${encodeURIComponent(currentLead.lead_id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 font-mono transition-colors"
                >
                  #{currentLead.lead_id}
                </a>
              </span>
              {currentLead.phone_number && (
                <span className="text-zinc-500 font-mono">{currentLead.phone_number}</span>
              )}
              {(currentLead.lead_first_name || currentLead.lead_last_name) && (
                <span className="text-zinc-400">
                  {[currentLead.lead_first_name, currentLead.lead_last_name].filter(Boolean).join(' ')}
                </span>
              )}
              <span className="text-zinc-600">{currentLead.campaign_name}</span>
            </>
          )}

          <div className="flex-1" />

          <span className="text-zinc-500">
            Paravasis:{' '}
            <span className={violationCount > 0 ? 'text-red-400 font-bold' : 'text-zinc-400'}>
              {violationCount}
            </span>
          </span>
          <span className="text-zinc-500">
            Score:{' '}
            <span className={`font-bold ${currentScore >= 80 ? 'text-green-400' : currentScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
              {currentScore}
            </span>
          </span>
        </div>
      )}

      {/* Main grid */}
      <main
        className="flex"
        style={{ height: '100vh', paddingTop: appState === 'incall' ? 'calc(4rem + 2.25rem)' : '4rem' }}
      >
        {/* LEFT: Transcript */}
        <div className="flex-[3] border-r border-zinc-800 flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Apomagnitofwnisi
            </span>
            <span className="text-xs text-zinc-600">{transcript.length} minymata</span>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {transcript.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-4">
                {appState === 'standby' ? (
                  <>
                    <div className="w-16 h-16 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex items-center justify-center">
                      <PhoneIncoming className="w-7 h-7 text-yellow-400" />
                    </div>
                    <div className="text-center">
                      <p className="text-zinc-300 font-medium">Anamoni eiserchomenis klisis</p>
                      <p className="text-xs text-zinc-600 mt-1">I engrafи xekina automatа otan o VICIdial se synde</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-zinc-600">
                      <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                      Parakolouthisi VICIdial status...
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 bg-zinc-800/50 rounded-2xl flex items-center justify-center">
                      <Mic className="w-5 h-5 text-zinc-600" />
                    </div>
                    <p className="text-zinc-600 text-sm">I katagrafи xekinise...</p>
                  </>
                )}
              </div>
            ) : (
              transcript.map((entry, i) => (
                <div key={i} className={`flex ${entry.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      entry.speaker === 'agent'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                    }`}
                  >
                    {entry.text}
                    <div className={`text-[10px] mt-1 ${entry.speaker === 'agent' ? 'text-indigo-300' : 'text-zinc-500'}`}>
                      {entry.timestamp}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* RIGHT: Suggestions + Violations */}
        <div className="flex-[2] flex flex-col min-h-0">
          <div className="flex-[3] border-b border-zinc-800 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> AI Protaseis
              </span>
              {isStreaming && (
                <span className="text-xs text-indigo-400 flex items-center gap-1">
                  <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {isStreaming && streamingSuggestion && (
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 text-sm text-zinc-400 italic animate-pulse">
                  {streamingSuggestion}
                </div>
              )}
              {!isStreaming && suggestions.length === 0 && (
                <div className="h-full flex items-center justify-center">
                  <p className="text-zinc-700 text-xs text-center">
                    Oi protaseis emfanizontai<br />kata ti diarkeia tis klisis
                  </p>
                </div>
              )}
              {!isStreaming && suggestions.length > 0 && (
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <div key={i} className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-3.5 flex gap-3">
                      <span className="text-indigo-400 text-base mt-0.5 shrink-0">💡</span>
                      <p className="text-sm text-zinc-300 leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex-[2] flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> Paravasis
              </span>
              <span className={`text-xs font-bold ${violationCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {violationCount}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {violations.length === 0 ? (
                <div className="flex items-center gap-2 text-green-400 text-xs">
                  <CheckCircle className="w-4 h-4" /> Kamia paravasi
                </div>
              ) : (
                <div className="space-y-2">
                  {violations.slice(0, 4).map((v, i) => (
                    <div key={i} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                      <p className="text-xs text-red-300 leading-relaxed line-clamp-2">{v.text}</p>
                      {v.words.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {v.words.map((w, j) => (
                            <span key={j} className="text-[10px] bg-red-900/40 text-red-300 px-2 py-0.5 rounded-full">
                              {w}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Post-Call Feedback Panel */}
      {showFeedback && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 backdrop-blur-sm border-t border-zinc-800 max-h-80 overflow-y-auto animate-in">
          <div className="max-w-4xl mx-auto px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-white flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-indigo-400" />
                Axiologisi Klisis - {selectedAgent?.full_name}
              </h3>
              <button onClick={() => setShowFeedback(false)} className="text-zinc-500 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            {!postCallFeedback ? (
              <span className="text-zinc-600 text-sm animate-pulse">Dimiourgia axiologisis...</span>
            ) : (() => {
              const match = postCallFeedback.match(/\{[\s\S]+\}/)
              if (match) {
                try {
                  const qa = JSON.parse(match[0])
                  return (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <ScoreBadge score={qa.score ?? 0} />
                        {qa.has_violation && (
                          <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-semibold px-2.5 py-1 rounded-full">
                            Paravasi politikis
                          </span>
                        )}
                      </div>
                      {qa.summary && (
                        <p className="text-sm text-zinc-300 bg-zinc-800/50 px-3 py-2 rounded-lg">{qa.summary}</p>
                      )}
                      {(qa.positives ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-400 mb-1.5">Thetika</p>
                          <ul className="space-y-1">
                            {(qa.positives as string[]).map((p: string, i: number) => (
                              <li key={i} className="text-xs text-zinc-400">- {p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(qa.improvements ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-yellow-400 mb-1.5">Veltiosi</p>
                          <ul className="space-y-1">
                            {(qa.improvements as string[]).map((p: string, i: number) => (
                              <li key={i} className="text-xs text-zinc-400">- {p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {qa.next_call_goal && (
                        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2">
                          <p className="text-xs text-indigo-400">Stochos: {qa.next_call_goal}</p>
                        </div>
                      )}
                    </div>
                  )
                } catch {}
              }
              return <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{postCallFeedback}</div>
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
