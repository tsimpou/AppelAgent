'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Phone, PhoneOff, AlertTriangle, Lightbulb, User } from 'lucide-react'
import { startMicroSIPCapture, stopCapture, type CaptureResult } from '@/lib/audioCapture'

type TranscriptEntry = {
  speaker: 'agent' | 'customer'
  text: string
  timestamp: string
}

export default function AgentPage() {
  const [isCallActive, setIsCallActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [agentName, setAgentName] = useState('')
  const [callId, setCallId] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [streamingSuggestion, setStreamingSuggestion] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [violationLogs, setViolationLogs] = useState<string[]>([])
  const [violationAlert, setViolationAlert] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [deviceLabels, setDeviceLabels] = useState<{ customer: string; agent: string } | null>(null)
  const [callDuration, setCallDuration] = useState(0)
  const [violationCount, setViolationCount] = useState(0)
  const [finalScore, setFinalScore] = useState<number | null>(null)

  // Refs for stable access inside async callbacks
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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

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
      // Defensive JSON parse
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
      if (blob.size < 1000) return // skip near-empty blobs (silence)
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

        // Save transcript (fire-and-forget)
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

        // Check words + stream suggestions in parallel
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
          setViolationLogs((prev) => [checkData.aiReason ?? 'Παράβαση πολιτικής', ...prev.slice(0, 2)])
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
        // Restart chunk if call is still active
        if (isCallActiveRef.current && captureResultRef.current) {
          createAndStartRecorder(captureResultRef.current.mixedStream)
        }
      }

      mr.start()
      setIsRecording(true)

      // Stop after 8 seconds to trigger onstop → process → restart cycle
      recordingTimeoutRef.current = setTimeout(() => {
        if (mr.state === 'recording') mr.stop()
      }, 8000)
    },
    [processAudioChunk]
  )

  const startCall = async () => {
    if (!agentName.trim()) {
      alert('Παρακαλώ εισάγετε το όνομά σας.')
      return
    }
    try {
      const res = await fetch('/api/calls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      callIdRef.current = data.call_id
      agentNameRef.current = agentName.trim()
      violationCountRef.current = 0
      isCallActiveRef.current = true

      setCallId(data.call_id)
      setIsCallActive(true)
      setTranscript([])
      setSuggestions([])
      setViolationLogs([])
      setViolationCount(0)
      setFinalScore(null)

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
      setIsCallActive(false)
      alert('Αδυναμία έναρξης κλήσης. Ελέγξτε τα δικαιώματα μικροφώνου.')
    }
  }

  const endCall = useCallback(async () => {
    isCallActiveRef.current = false

    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current)

    if (captureResultRef.current) {
      stopCapture(captureResultRef.current)
      captureResultRef.current = null
    }

    const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000)

    try {
      const res = await fetch('/api/calls/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: callIdRef.current,
          duration_seconds: duration,
          total_violations: violationCountRef.current,
        }),
      })
      const data = await res.json()
      if (res.ok) setFinalScore(data.performance_score)
    } catch (err) {
      console.error('endCall error:', err)
    }

    setIsCallActive(false)
    setIsRecording(false)
    callIdRef.current = null
  }, [])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const scoreBadge = (score: number) => {
    if (score >= 80) return { label: 'Άριστο', cls: 'bg-green-600' }
    if (score >= 50) return { label: 'Μέτριο', cls: 'bg-yellow-600' }
    return { label: 'Χαμηλό', cls: 'bg-red-600' }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Violation Alert Overlay */}
      {violationAlert && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className="bg-red-600 text-white px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-lg font-bold border border-red-400">
            <AlertTriangle className="w-6 h-6" />
            ⚠️ ΠΡΟΣΟΧΗ — Απαγορευμένη Λέξη!
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            <h1 className="text-xl font-bold">Agent Assist</h1>
          </div>

          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              type="text"
              placeholder="Όνομα agent..."
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              disabled={isCallActive}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          {isCallActive && (
            <div className="flex items-center gap-2 ml-auto">
              {isRecording && (
                <span className="flex items-center gap-1 text-xs text-red-400">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  REC
                </span>
              )}
              <span className="font-mono text-green-400 text-sm bg-green-900/20 px-3 py-1 rounded-lg border border-green-800">
                {formatTime(callDuration)}
              </span>
              {violationCount > 0 && (
                <span className="bg-red-700 text-white text-xs px-2 py-1 rounded-full font-bold">
                  {violationCount} παράβ.
                </span>
              )}
            </div>
          )}

          <div className={isCallActive ? '' : 'ml-auto'}>
            {!isCallActive ? (
              <button
                onClick={startCall}
                disabled={!agentName.trim()}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
              >
                <Phone className="w-4 h-4" />
                Έναρξη Κλήσης
              </button>
            ) : (
              <button
                onClick={endCall}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
              >
                <PhoneOff className="w-4 h-4" />
                Τέλος Κλήσης
              </button>
            )}
          </div>
        </div>

        {/* Device info bar */}
        {deviceLabels && (
          <div className="text-xs text-gray-500 mb-3 bg-gray-900/50 px-3 py-1.5 rounded-lg border border-gray-800">
            🎧 Πελάτης: <span className="text-gray-400">{deviceLabels.customer}</span>
            &nbsp;|&nbsp; 🎤 Agent: <span className="text-gray-400">{deviceLabels.agent}</span>
          </div>
        )}

        {/* Final score banner */}
        {finalScore !== null && !isCallActive && (
          <div
            className={`rounded-xl p-3 mb-3 text-center font-bold text-lg ${scoreBadge(finalScore).cls}`}
          >
            Τελική Βαθμολογία: {finalScore}/100 — {scoreBadge(finalScore).label}
          </div>
        )}

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Transcript — 3 cols */}
          <div
            className="lg:col-span-3 bg-gray-900 rounded-xl border border-gray-800 flex flex-col"
            style={{ height: '520px' }}
          >
            <div className="px-4 py-2 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-300">Απομαγνητοφώνηση</h2>
              {isProcessing && (
                <span className="text-xs text-blue-400 animate-pulse">Επεξεργασία...</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {transcript.length === 0 && (
                <p className="text-gray-600 text-sm text-center mt-16">
                  {isCallActive
                    ? 'Μικρόφωνο ενεργό — μιλάτε...'
                    : 'Ξεκινήστε κλήση για να δείτε τη συνομιλία.'}
                </p>
              )}
              {transcript.map((entry, i) => (
                <div
                  key={i}
                  className={`flex ${entry.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-sm px-3 py-2 rounded-xl text-sm ${
                      entry.speaker === 'agent' ? 'bg-blue-800/70' : 'bg-gray-700'
                    }`}
                  >
                    <div className="text-xs text-gray-400 mb-1 font-medium">
                      {entry.speaker === 'agent' ? '🎧 Πράκτορας' : '👤 Πελάτης'} ·{' '}
                      {entry.timestamp}
                    </div>
                    <p>{entry.text}</p>
                  </div>
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* Right panel — 2 cols */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* AI Suggestions */}
            <div
              className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col"
              style={{ minHeight: '260px' }}
            >
              <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-gray-300">AI Προτάσεις</h2>
                {isStreaming && (
                  <span className="ml-auto flex items-center gap-0.5">
                    {[0, 0.15, 0.3].map((delay, i) => (
                      <span
                        key={i}
                        className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: `${delay}s` }}
                      />
                    ))}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {isStreaming && (
                  <div className="mb-2">
                    <p className="text-xs text-gray-400 mb-1 italic">🤔 Σκέφτομαι...</p>
                    {streamingSuggestion && (
                      <p className="text-xs text-gray-500 italic leading-relaxed">
                        {streamingSuggestion}
                      </p>
                    )}
                  </div>
                )}
                {!isStreaming && suggestions.length === 0 && (
                  <p className="text-gray-600 text-xs text-center mt-10">
                    {isCallActive ? 'Αναμονή πρώτης ομιλίας...' : 'Ξεκινήστε κλήση.'}
                  </p>
                )}
                {!isStreaming &&
                  suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2 text-xs text-yellow-200"
                    >
                      <span className="font-bold text-yellow-400">💡</span> {s}
                    </div>
                  ))}
              </div>
            </div>

            {/* Violations log */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col flex-1">
              <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-semibold text-gray-300">Παραβάσεις</h2>
                {violationCount > 0 && (
                  <span className="ml-auto bg-red-700 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {violationCount}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {violationLogs.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 text-green-400 text-xs mt-8">
                    ✅ Δεν εντοπίστηκαν παραβάσεις
                  </div>
                ) : (
                  violationLogs.map((v, i) => (
                    <div
                      key={i}
                      className="bg-red-900/30 border border-red-800/40 rounded-lg p-2 text-xs text-red-300"
                    >
                      🚫 {v}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 text-center">
          <a href="/dashboard" className="text-blue-400 hover:text-blue-300 text-xs underline">
            → Dashboard Team Leader
          </a>
        </div>
      </div>
    </div>
  )
}

interface TranscriptEntry {
  speaker: 'agent' | 'customer'
  text: string
  isFlagged: boolean
  timestamp: Date
}

interface Violation {
  text: string
  reason: string | null
  severity: string
  timestamp: Date
}

export default function AgentPage() {
  const [agentName, setAgentName] = useState('')
  const [callId, setCallId] = useState<string | null>(null)
  const [isCallActive, setIsCallActive] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [violations, setViolations] = useState<Violation[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [callStartTime, setCallStartTime] = useState<Date | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [lastScore, setLastScore] = useState<number | null>(null)
  const [currentSpeaker, setCurrentSpeaker] = useState<'agent' | 'customer'>('agent')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcript])

  useEffect(() => {
    if (isCallActive && callStartTime) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - callStartTime.getTime()) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isCallActive, callStartTime])

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  const startCall = async () => {
    if (!agentName.trim()) {
      alert('Παρακαλώ εισάγετε το όνομά σας πριν ξεκινήσετε κλήση.')
      return
    }
    try {
      const res = await fetch('/api/calls/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_name: agentName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCallId(data.call_id)
      setIsCallActive(true)
      setCallStartTime(new Date())
      setElapsedSeconds(0)
      setTranscript([])
      setViolations([])
      setSuggestions([])
      setLastScore(null)
    } catch (err) {
      console.error('Failed to start call:', err)
      alert('Αποτυχία έναρξης κλήσης.')
    }
  }

  const endCall = async () => {
    if (!callId) return
    if (isRecording) await stopRecording()

    try {
      const res = await fetch('/api/calls/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          call_id: callId,
          duration_seconds: elapsedSeconds,
          total_violations: violations.length,
        }),
      })
      const data = await res.json()
      if (res.ok) setLastScore(data.performance_score)
    } catch (err) {
      console.error('Failed to end call:', err)
    }

    setIsCallActive(false)
    setCallId(null)
    if (timerRef.current) clearInterval(timerRef.current)
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        await processAudio(audioBlob)
      }

      mediaRecorder.start()
      setIsRecording(true)
    } catch (err) {
      console.error('Microphone error:', err)
      alert('Δεν ήταν δυνατή η πρόσβαση στο μικρόφωνο.')
    }
  }

  const stopRecording = useCallback(() => {
    return new Promise<void>((resolve) => {
      const mr = mediaRecorderRef.current
      if (mr && mr.state !== 'inactive') {
        mr.addEventListener('stop', () => resolve(), { once: true })
        mr.stop()
        setIsRecording(false)
      } else {
        resolve()
      }
    })
  }, [])

  const processAudio = async (audioBlob: Blob) => {
    setIsLoading(true)
    try {
      // 1. Transcribe
      const formData = new FormData()
      formData.append('audio', audioBlob, 'audio.webm')
      const transcribeRes = await fetch('/api/transcribe', { method: 'POST', body: formData })
      const transcribeData = await transcribeRes.json()
      const text: string = transcribeData.text?.trim()
      if (!text) return

      // 2. Check for violations
      const checkRes = await fetch('/api/check-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, call_id: callId, agent_name: agentName }),
      })
      const checkData = await checkRes.json()
      const isFlagged = checkData.violation === true

      // 3. Save transcript
      if (callId) {
        await fetch('/api/transcripts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ call_id: callId, speaker: currentSpeaker, text, is_flagged: isFlagged }),
        })
      }

      const entry: TranscriptEntry = {
        speaker: currentSpeaker,
        text,
        isFlagged,
        timestamp: new Date(),
      }
      setTranscript((prev) => [...prev, entry])

      if (isFlagged) {
        const violation: Violation = {
          text,
          reason: checkData.reason ?? null,
          severity: checkData.severity ?? 'medium',
          timestamp: new Date(),
        }
        setViolations((prev) => [...prev, violation])
      }

      // 4. Get suggestions every 3 agent entries
      const agentEntries = transcript.filter((e) => e.speaker === 'agent').length + 1
      if (currentSpeaker === 'agent' && agentEntries % 3 === 0) {
        const fullText = [...transcript, entry]
          .map((e) => `${e.speaker === 'agent' ? 'Πράκτορας' : 'Πελάτης'}: ${e.text}`)
          .join('\n')
        const suggestRes = await fetch('/api/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: fullText }),
        })
        const suggestData = await suggestRes.json()
        if (suggestData.suggestions?.length) setSuggestions(suggestData.suggestions)
      }
    } catch (err) {
      console.error('Process audio error:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const scoreBadge = (score: number) => {
    if (score >= 80) return { label: 'Άριστο', cls: 'bg-green-500' }
    if (score >= 50) return { label: 'Μέτριο', cls: 'bg-yellow-500' }
    return { label: 'Χαμηλό', cls: 'bg-red-500' }
  }

  const severityColor = (s: string) => {
    if (s === 'high') return 'text-red-400 bg-red-900/30'
    if (s === 'low') return 'text-green-400 bg-green-900/30'
    return 'text-yellow-400 bg-yellow-900/30'
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-4">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <Phone className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Agent Assist</h1>
              <p className="text-gray-400 text-sm">AI Βοηθός Πωλήσεων</p>
            </div>
          </div>
          {isCallActive && (
            <div className="flex items-center gap-2 bg-green-900/30 border border-green-700 px-4 py-2 rounded-lg">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <span className="text-green-400 font-mono font-semibold">{formatTime(elapsedSeconds)}</span>
            </div>
          )}
        </div>

        {/* Agent name input + call controls */}
        <div className="bg-gray-900 rounded-xl p-4 mb-4 border border-gray-800">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="flex items-center gap-2 flex-1">
              <User className="w-5 h-5 text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Το όνομά σας..."
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                disabled={isCallActive}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>

            {!isCallActive ? (
              <button
                onClick={startCall}
                disabled={!agentName.trim()}
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap"
              >
                <Phone className="w-4 h-4" />
                Έναρξη Κλήσης
              </button>
            ) : (
              <button
                onClick={endCall}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 px-5 py-2 rounded-lg font-semibold text-sm transition-colors whitespace-nowrap"
              >
                <PhoneOff className="w-4 h-4" />
                Τέλος Κλήσης
              </button>
            )}
          </div>
        </div>

        {/* Last score banner */}
        {lastScore !== null && !isCallActive && (
          <div className={`rounded-xl p-4 mb-4 text-center font-bold text-lg ${scoreBadge(lastScore).cls}`}>
            Τελική Βαθμολογία: {lastScore}/100 — {scoreBadge(lastScore).label}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Transcript panel */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 flex flex-col" style={{ height: '480px' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <h2 className="font-semibold text-sm text-gray-300">Απομαγνητοφώνηση</h2>
              {isCallActive && (
                <div className="flex items-center gap-2">
                  {/* Speaker toggle */}
                  <div className="flex rounded-lg overflow-hidden border border-gray-700 text-xs">
                    <button
                      onClick={() => setCurrentSpeaker('agent')}
                      className={`px-3 py-1 ${currentSpeaker === 'agent' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                      Πράκτορας
                    </button>
                    <button
                      onClick={() => setCurrentSpeaker('customer')}
                      className={`px-3 py-1 ${currentSpeaker === 'customer' ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400'}`}
                    >
                      Πελάτης
                    </button>
                  </div>
                  {/* Record button */}
                  {!isRecording ? (
                    <button
                      onClick={startRecording}
                      disabled={isLoading}
                      className="flex items-center gap-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 px-3 py-1 rounded-lg text-xs font-semibold transition-colors"
                    >
                      <Mic className="w-3 h-3" />
                      Εγγραφή
                    </button>
                  ) : (
                    <button
                      onClick={stopRecording}
                      className="flex items-center gap-1 bg-red-600 hover:bg-red-700 px-3 py-1 rounded-lg text-xs font-semibold animate-pulse transition-colors"
                    >
                      <MicOff className="w-3 h-3" />
                      Διακοπή
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {transcript.length === 0 && (
                <p className="text-gray-600 text-sm text-center mt-10">
                  {isCallActive ? 'Πατήστε «Εγγραφή» για να ξεκινήσετε...' : 'Ξεκινήστε μια κλήση για να δείτε την απομαγνητοφώνηση.'}
                </p>
              )}
              {transcript.map((entry, i) => (
                <div
                  key={i}
                  className={`flex ${entry.speaker === 'agent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-sm px-3 py-2 rounded-xl text-sm ${
                      entry.isFlagged
                        ? 'bg-red-900/50 border border-red-600'
                        : entry.speaker === 'agent'
                        ? 'bg-blue-800/60'
                        : 'bg-gray-700'
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-xs font-semibold text-gray-400">
                        {entry.speaker === 'agent' ? '🎧 Πράκτορας' : '👤 Πελάτης'}
                      </span>
                      {entry.isFlagged && <AlertTriangle className="w-3 h-3 text-red-400" />}
                    </div>
                    <p>{entry.text}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {entry.timestamp.toLocaleTimeString('el-GR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-center">
                  <div className="bg-gray-800 px-4 py-2 rounded-full text-xs text-gray-400 animate-pulse">
                    Επεξεργασία...
                  </div>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          </div>

          {/* Right panel: violations + suggestions */}
          <div className="flex flex-col gap-4">

            {/* Violations */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 flex-1 flex flex-col" style={{ maxHeight: '230px' }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <h2 className="font-semibold text-sm text-gray-300">Παραβάσεις</h2>
                {violations.length > 0 && (
                  <span className="ml-auto bg-red-600 text-white text-xs px-2 py-0.5 rounded-full">
                    {violations.length}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {violations.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center mt-6">Καμία παράβαση</p>
                ) : (
                  violations.map((v, i) => (
                    <div key={i} className={`rounded-lg p-2 text-xs ${severityColor(v.severity)}`}>
                      <p className="font-medium truncate">{v.text}</p>
                      {v.reason && <p className="mt-0.5 opacity-80">{v.reason}</p>}
                      <p className="mt-0.5 opacity-60">
                        {v.severity.toUpperCase()} · {v.timestamp.toLocaleTimeString('el-GR')}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Suggestions */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col" style={{ maxHeight: '230px' }}>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-800">
                <Lightbulb className="w-4 h-4 text-yellow-400" />
                <h2 className="font-semibold text-sm text-gray-300">Προτάσεις AI</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {suggestions.length === 0 ? (
                  <p className="text-gray-600 text-xs text-center mt-6">Αναμονή δεδομένων...</p>
                ) : (
                  suggestions.map((s, i) => (
                    <div key={i} className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-2 text-xs text-yellow-200">
                      <span className="font-bold text-yellow-400">#{i + 1}</span> {s}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom nav */}
        <div className="mt-4 text-center">
          <a href="/dashboard" className="text-blue-400 hover:text-blue-300 text-sm underline">
            → Μετάβαση στο Dashboard Team Leader
          </a>
        </div>
      </div>
    </div>
  )
}
