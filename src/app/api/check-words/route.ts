import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createSupabaseServer } from '@/lib/supabaseServer'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GreekFilter = require('greek-swearword-filter')

const greekFilter = new GreekFilter()
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, call_id, agent_name } = body as {
      text: string
      call_id?: string
      agent_name?: string
    }

    if (!text?.trim()) {
      return NextResponse.json({ hasViolation: false })
    }

    const supabase = createSupabaseServer()

    // ── 1. Custom Ban Words from Supabase ──────────────────────────────────
    const { data: banData } = await supabase.from('ban_words').select('word, severity')
    const customBanWords = banData ?? []
    const foundCustom: { word: string; severity: string }[] = []

    for (const ban of customBanWords) {
      if (text.toLowerCase().includes(ban.word.toLowerCase())) {
        foundCustom.push(ban)
      }
    }

    // ── 2. Greek Profanity Library — detection only, never censor ──────────
    const filteredText: string = greekFilter.filter(text)
    const hasLibraryProfanity = filteredText !== text

    // Extract which specific words were flagged by comparing word arrays
    const detectedProfanity: string[] = []
    if (hasLibraryProfanity) {
      const originalWords = text.split(/\s+/)
      const filteredWords = filteredText.split(/\s+/)
      originalWords.forEach((word, i) => {
        if (filteredWords[i] !== word) {
          detectedProfanity.push(word)
        }
      })
    }

    // ── 3. AI check with Prompt Guard (context & variations) ───────────────
    let aiReason: string | null = null
    let aiViolation = false

    try {
      const aiCheck = await groq.chat.completions.create({
        model: 'meta-llama/llama-prompt-guard-2-86m',
        messages: [
          {
            role: 'user',
            content: `Έλεγξε αν το παρακάτω κείμενο από agent τηλεφωνικού κέντρου είναι ακατάλληλο, προσβλητικό ή επαγγελματικά απαράδεκτο. Απάντησε ΜΟΝΟ με JSON: {"violation": true/false, "reason": "σύντομη αιτία ή null"}\n\nΚείμενο: "${text}"`,
          },
        ],
        temperature: 0,
        max_tokens: 80,
      })

      const raw = aiCheck.choices[0]?.message?.content ?? '{}'
      const match = raw.match(/\{[^}]+\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        aiViolation = parsed.violation ?? false
        aiReason = parsed.reason ?? null
      }
    } catch {
      // AI check is best-effort; never block on failure
    }

    // ── 4. Aggregate result ────────────────────────────────────────────────
    const hasViolation = foundCustom.length > 0 || hasLibraryProfanity || aiViolation

    // ── 5. Save to Supabase with ORIGINAL uncensored text ──────────────────
    if (hasViolation && call_id) {
      const severity =
        foundCustom.find((w) => w.severity === 'high') || hasLibraryProfanity
          ? 'high'
          : aiViolation
          ? 'medium'
          : 'low'

      const reasonParts = [
        foundCustom.length > 0
          ? `Custom ban words: ${foundCustom.map((w) => w.word).join(', ')}`
          : null,
        detectedProfanity.length > 0
          ? `Profanity: ${detectedProfanity.join(', ')}`
          : null,
        aiReason ? `AI: ${aiReason}` : null,
      ].filter(Boolean)

      await supabase.from('violations').insert({
        call_id,
        agent_name: agent_name ?? 'Unknown',
        text, // always original — never censored
        reason: reasonParts.join(' | ') || null,
        severity,
      })
    }

    return NextResponse.json({
      hasViolation,
      foundWords: foundCustom.map((w) => w.word),
      detectedProfanity,
      aiReason,
      originalText: text,
    })
  } catch (error) {
    console.error('Check-words error:', error)
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
}
