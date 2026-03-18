'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Headphones, Phone, PhoneOff,
  Mic, MessageSquare, Sparkles,
  AlertTriangle, CheckCircle,
  ClipboardCheck, X,
} from 'lucide-react'
import { startMicroSIPCapture, stopCapture, type CaptureResult } from '@/lib/audioCapture'
import { CallDetector } from '@/lib/callDetector'

type CallStatus = 'idle' | 'standby' | 'active'

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
  const label = score >= 80 ? 'Αριστο' : score >= 50 ? 'Μέτριο' : 'Χαμηλό'
  return (
    <span className={`${cls} text-xs font-semibold px-2.5 py-1 rounded-full`}>
      {label} {score}
    </span>
  )
}

export default function AgentPage() {
  const [callStatus, setCallStatus] = useState<CallStatus>('idle')
  const [agentName, setAgentName] = useState('')
  const [callId, setCallId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [streamingSuggestion, setStreamingSuggestion] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [violations, setViolations] = useState<ViolationEntry[]>([])
  const [violationAlert, setViolationAlert] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [deviceLabels, setDeviceLabels] = useState<{ customer: string; agent: string } | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [violationCount, setViolationCount] = useState(0)
  const [postCallFeedback, setPostCallFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const captureResultRef = useRef<CaptureResult | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const callStartTimeRef = useRef<number>(0)
  const isCallActiveRef = useRef(false)
  const callIdRef = useRef<string | null>(null)
  const agentNameRef = useRef('')
  const violationCountRef = useRef(0)
  const transcriptRef = useRef<TranscriptEntry[]>([])
  const detectorRef = useRef<CallDetector | null>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  const currentScore = Math.max(0, 100 - violationCount * 5)

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const streamSuggestions = useCallback(async (transcriptText: string) => {
    setIsStreaming(true)
    setStreamingSuggestion('')
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
        const chunk = decoder.decode(value, { stream: true })
        accumulated += chunk
        setStreamingSuggestion(accumulated)
      }
      const match = accumulated.match(/\[[\s\S]*\]/)
      if (match) {
        try {
          const parsed = JSON.parse(match[0])
          if (Array.isArray(parsed)) setSuggestions(parsed)
        } catch {}
      }
    } catch (err) {
      console.error('Streaming suggestions error:', err)
    } finally {
      setStreamingSuggestion('')
      setIsStreaming(false)
    }
  }, [])

  const processAudioChunk = useCallback(
    async (blob: Blob) => {
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
          .map((e) => `${e.speaker === 'agent' ? 'Πράκτορας' : 'Πελάτης'}: ${e.text}`)
          .join('\n')

        if (callIdRef.current) {
          fetch('/api/transcripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              call_id: callIdRef.current,
              speaker: 'agent',
              text,
              is_flagged: false,
            }),
          }).catch(console.error)
        }

        const [checkRes] = await Promise.all([
          fetch('/api/check-words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text,
              call_id: callIdRef.current,
              agent_name: agentNameRef.current,
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

          const allWords = [
            ...(checkData.foundWords ?? []),
            ...(checkData.detectedProfanity ?? []),
          ]
          const logMsg =
            allWords.length > 0
              ? `"${allWords.join('\', \'')}"${checkData.aiReason ? ` — ${checkData.aiReason}` : ''}`
              : checkData.aiReason ?? 'Παράβαση πολιτικής'

          setViolations((prev) => [{ text: logMsg, words: allWords }, ...prev.slice(0, 3)])
        }
      } catch (err) {
        console.error('processAudioChunk error:', err)
      } finally {
        setIsProcessing(false)
      }
    },
    [streamSuggestions]
  )

  const createAndStartRecorder = useCallback(
    (stream: MediaStream) => {
      if (!isCallActiveRef.current) return
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

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
    },
    [processAudioChunk]
  )

  const startCall = async () => {
    try {
      const res = await fetch('/api/calls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentNameRef.current }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      callIdRef.current = data.call_id
      violationCountRef.current = 0

      setCallId(data.call_id)
      setTranscript([])
      setSuggestions([])
      setViolations([])
      setViolationCount(0)

      callStartTimeRef.current = Date.now()
      setCallDuration(0)
      durationIntervalRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000))
      }, 1000)

      const captureResult = await startMicroSIPCapture()
      captureResultRef.current = captureResult
      setDeviceLabels(captureResult.deviceLabels)
      createAndStartRecorder(captureResult.mixedStream)
    } catch (err) {
      console.error('startCall error:', err)
      isCallActiveRef.current = false
      setCallStatus('idle')
      alert('Αδυναμία έναρξης κλήσης. Ελέγξτε τα δικαιώματα μικροφώνου.')
    }
  }

  const endCall = useCallback(async () => {
    isCallActiveRef.current = false
    detectorRef.current?.stop()
    detectorRef.current = null

    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)

    if (captureResultRef.current) {
      stopCapture(captureResultRef.current)
      captureResultRef.current = null
    }

    const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000)
    const savedCallId = callIdRef.current
    const savedAgentName = agentNameRef.current
    const savedTranscript = transcriptRef.current
          .map((e) => `${e.speaker === 'agent' ? 'Πράκτορας' : 'Πελάτης'}: ${e.text}`)
      .join('\n')
    const savedViolations = violationCountRef.current

    try {
      await fetch('/api/calls/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: savedCallId,
          duration_seconds: duration,
          total_violations: savedViolations,
        }),
      })
    } catch (err) {
      console.error('endCall error:', err)
    }

    setCallStatus('idle')
    callIdRef.current = null

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

  const enterStandby = async () => {
    if (!agentName.trim()) {
      alert('Παρακαλώ εισάγετε το όνομά σας.')
      return
    }
    agentNameRef.current = agentName.trim()
    setCallStatus('standby')

    const detector = new CallDetector()
    detectorRef.current = detector

    try {
      await detector.startListening(
        async () => {
          detector.stop()
          isCallActiveRef.current = true
          setCallStatus('active')
          await startCall()
        },
        async () => {
          await endCall()
        },
      )
    } catch (err) {
      console.error('enterStandby error:', err)
      detector.stop()
      detectorRef.current = null
      setCallStatus('idle')
    }
  }

  const exitStandby = () => {
    detectorRef.current?.stop()
    detectorRef.current = null
    setCallStatus('idle')
  }

  const handleButtonClick = async () => {
    if (callStatus === 'idle') await enterStandby()
    else if (callStatus === 'standby') exitStandby()
    else await endCall()
  }

  return (
    <div className="bg-zinc-950 min-h-screen overflow-hidden">

      {/* Violation Alert Overlay */}
      {violationAlert && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-red-950 border border-red-800 text-red-300 px-5 py-3 rounded-2xl shadow-2xl shadow-red-950/50 animate-bounce">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <div>
            <p className="font-semibold text-sm text-red-200">Απαγορευμένη Λέξη</p>
            <p className="text-xs text-red-400">Ο agent χρησιμοποίησε ακατάλληλη έκφραση</p>
          </div>
        </div>
      )}

      {/* Topbar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-zinc-950/90 backdrop-blur-sm border-b border-zinc-800 flex items-center px-6 gap-4">
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Headphones className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-white text-sm">Agent Assist</span>
        </div>

        <div className="h-5 w-px bg-zinc-800" />

        {callStatus === 'idle' ? (
          <input
            value={agentName}
            onChange={(e) => setAgentName(e.target.value)}
            placeholder="Όνομα agent..."
            className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 w-48"
          />
        ) : (
          <span className="text-sm font-medium text-white">{agentName}</span>
        )}

        {deviceLabels && (
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
            Επεξεργασία
          </span>
        )}

        <a
          href="/dashboard"
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors hidden md:block"
        >
          Dashboard →
        </a>

        {callStatus === 'idle' && (
          <button
            onClick={handleButtonClick}
            disabled={!agentName.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-150"
          >
            <Phone className="w-4 h-4" /> Έναρξη Κλήσης
          </button>
        )}
        {callStatus === 'standby' && (
          <button
            onClick={handleButtonClick}
            className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 transition-all hover:bg-yellow-500/20"
          >
            <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
            Σε Αναμονή...
          </button>
        )}
        {callStatus === 'active' && (
          <button
            onClick={handleButtonClick}
            className="bg-red-600 hover:bg-red-500 text-white text-sm font-medium px-4 py-2 rounded-xl flex items-center gap-2 transition-all duration-150"
          >
            <PhoneOff className="w-4 h-4" /> Τέλος Κλήσης
          </button>
        )}
      </header>

      {/* Status Bar (active only) */}
      {callStatus === 'active' && (
        <div className="fixed top-16 left-0 right-0 z-30 h-9 bg-red-950/40 border-b border-red-900/30 flex items-center px-6 gap-6 text-xs">
          <span className="flex items-center gap-1.5 text-red-400 font-medium">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            REC {formatDuration(callDuration)}
          </span>
          <span className="text-zinc-500">Κλήση ενεργή — {agentName}</span>
          <div className="flex-1" />
          <span className="text-zinc-500">
            Παραβάσεις:{' '}
            <span className={violationCount > 0 ? 'text-red-400 font-bold' : 'text-zinc-400'}>
              {violationCount}
            </span>
          </span>
          <span className="text-zinc-500">
            Score:{' '}
            <span
              className={`font-bold ${currentScore >= 80 ? 'text-green-400' : currentScore >= 50 ? 'text-yellow-400' : 'text-red-400'}`}
            >
              {currentScore}
            </span>
          </span>
        </div>
      )}

      {/* Main grid */}
      <main
        className="flex"
        style={{
          height: '100vh',
          paddingTop: callStatus === 'active' ? 'calc(4rem + 2.25rem)' : '4rem',
        }}
      >
        {/* LEFT: Transcript — 60% */}
        <div className="flex-[3] border-r border-zinc-800 flex flex-col min-h-0">
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5" /> Απομαγνητοφώνηση
            </span>
            <span className="text-xs text-zinc-600">{transcript.length} μηνύματα</span>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {transcript.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-12 h-12 bg-zinc-800/50 rounded-2xl flex items-center justify-center">
                  <Mic className="w-5 h-5 text-zinc-600" />
                </div>
                <p className="text-zinc-600 text-sm">
                  {callStatus === 'idle'
                    ? 'Πάτα Έναρξη Κλήσης'
                    : callStatus === 'standby'
                    ? 'Αναμονή για εισερχόμενη κλήση...'
                    : 'Η καταγραφή ξεκίνησε...'}
                </p>
              </div>
            ) : (
              transcript.map((entry, i) => (
                <div
                  key={i}
                  className={`flex ${entry.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      entry.speaker === 'agent'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                    }`}
                  >
                    {entry.text}
                    <div
                      className={`text-[10px] mt-1 ${
                        entry.speaker === 'agent' ? 'text-indigo-300' : 'text-zinc-500'
                      }`}
                    >
                      {entry.timestamp}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* RIGHT: Suggestions + Violations — 40% */}
        <div className="flex-[2] flex flex-col min-h-0">
          {/* AI Suggestions — top 60% */}
          <div className="flex-[3] border-b border-zinc-800 flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" /> AI Προτάσεις
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
                    Οι προτάσεις εμφανίζονται<br />κατά τη διάρκεια της κλήσης
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

          {/* Violations — bottom 40% */}
          <div className="flex-[2] flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> Παραβάσεις
              </span>
              <span className={`text-xs font-bold ${violationCount > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {violationCount}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {violations.length === 0 ? (
                <div className="flex items-center gap-2 text-green-400 text-xs">
                  <CheckCircle className="w-4 h-4" /> Καμία παράβαση
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
                Αξιολόγηση Κλήσης — {agentName}
              </h3>
              <button
                onClick={() => setShowFeedback(false)}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {!postCallFeedback ? (
              <span className="text-zinc-600 text-sm animate-pulse">Δημιουργία αξιολόγησης...</span>
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
                            Παράβαση πολιτικής
                          </span>
                        )}
                      </div>
                      {qa.summary && (
                        <p className="text-sm text-zinc-300 bg-zinc-800/50 px-3 py-2 rounded-lg">{qa.summary}</p>
                      )}
                      {(qa.positives ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-green-400 mb-1.5">Με θετικά</p>
                          <ul className="space-y-1">
                            {(qa.positives as string[]).map((p: string, i: number) => (
                              <li key={i} className="text-xs text-zinc-400">— {p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {(qa.improvements ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-yellow-400 mb-1.5">Βελτίωση</p>
                          <ul className="space-y-1">
                            {(qa.improvements as string[]).map((p: string, i: number) => (
                              <li key={i} className="text-xs text-zinc-400">— {p}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {qa.next_call_goal && (
                        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-lg px-3 py-2">
                          <p className="text-xs text-indigo-400">🎯 {qa.next_call_goal}</p>
                        </div>
                      )}
                    </div>
                  )
                } catch {}
              }
              return (
                <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  {postCallFeedback}
                </div>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
