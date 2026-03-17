import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createSupabaseServer } from '@/lib/supabaseServer'

export async function GET() {
  try {
    const supabase = createSupabaseServer()

    const [violationsRes, callsRes] = await Promise.all([
      supabase
        .from('violations')
        .select('text, severity, occurred_at')
        .order('occurred_at', { ascending: false })
        .limit(50),
      supabase
        .from('calls')
        .select('agent_name, performance_score, total_violations, started_at')
        .order('started_at', { ascending: false })
        .limit(100),
    ])

    const violations = violationsRes.data ?? []
    const calls = callsRes.data ?? []

    const totalCalls = calls.length
    const avgScore =
      totalCalls > 0
        ? Math.round(
            calls.reduce((s, c) => s + (c.performance_score ?? 100), 0) / totalCalls
          )
        : 100
    const totalViolations = violations.length
    const topViolations = violations
      .slice(0, 3)
      .map((v) => v.text)
      .join('; ')

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const stream = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      stream: true,
      temperature: 0.7,
      max_tokens: 600,
      messages: [
        {
          role: 'system',
          content: `Είσαι αναλυτής απόδοσης τηλεφωνικού κέντρου. Απάντησε στα ελληνικά με:
1. 📊 Σύνοψη χθεσινής απόδοσης (2-3 προτάσεις)
2. ⚠️ Κυριότερα προβλήματα που παρατηρήθηκαν
3. 💡 3-5 συγκεκριμένες προτάσεις για τους agents σήμερα
4. 🎯 Στόχος ημέρας (1 πρόταση)
Χρησιμοποίησε bullet points και emojis.`,
        },
        {
          role: 'user',
          content: `Στατιστικά τελευταίων κλήσεων:\n- Συνολικές κλήσεις: ${totalCalls}\n- Μέση βαθμολογία: ${avgScore}/100\n- Συνολικές παραβάσεις: ${totalViolations}\n- Κυριότερες παραβάσεις: ${topViolations || 'Καμία'}`,
        },
      ],
    })

    const encoder = new TextEncoder()
    let accumulated = ''

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              accumulated += text
              controller.enqueue(encoder.encode(text))
            }
          }
          // Save completed briefing to DB
          if (accumulated) {
            try {
              await createSupabaseServer()
                .from('daily_briefings')
                .insert({ content: accumulated })
            } catch (saveErr) {
              console.error('Failed to save briefing:', saveErr)
            }
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    console.error('daily-briefing error:', error)
    return NextResponse.json({ error: 'Briefing failed' }, { status: 500 })
  }
}
