import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createSupabaseServer } from '@/lib/supabaseServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { call_id, agent_name, transcript_text, violations_count, duration } = body as {
      call_id: string
      agent_name: string
      transcript_text: string
      violations_count: number
      duration: number
    }

    if (!call_id || !agent_name) {
      return NextResponse.json({ error: 'call_id and agent_name are required' }, { status: 400 })
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const stream = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      stream: true,
      temperature: 0.4,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: `Είσαι QA αναλυτής τηλεφωνικού κέντρου. Αξιολόγησε την κλήση. Απάντησε ΜΟΝΟ με JSON:
{"score":0-100,"positives":["..."],"improvements":["..."],"next_call_goal":"...","talk_ratio":0-100,"has_violation":true/false,"violation_reason":"...","summary":"..."}`,
        },
        {
          role: 'user',
          content: `Agent: ${agent_name} | Διάρκεια: ${duration}s | Παραβάσεις: ${violations_count}\n\nTranscript:\n${(transcript_text ?? '').substring(0, 3000)}`,
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

          // Parse and save to call_feedback after stream completes
          if (accumulated && call_id) {
            try {
              const match = accumulated.match(/\{[\s\S]+\}/)
              const qa = match ? JSON.parse(match[0]) : null
              if (qa) {
                const score = Math.max(0, (qa.score ?? 100) - violations_count * 5)
                await createSupabaseServer()
                  .from('call_feedback')
                  .insert({
                    call_id,
                    agent_name,
                    score,
                    positives: qa.positives ?? [],
                    improvements: qa.improvements ?? [],
                    next_call_goal: qa.next_call_goal ?? '',
                    talk_ratio: qa.talk_ratio ?? 50,
                    summary: qa.summary ?? '',
                    transcript_text: (transcript_text ?? '').substring(0, 2000),
                    has_violation: qa.has_violation ?? false,
                    violation_reason: qa.violation_reason ?? null,
                    source: 'live',
                  })
              }
            } catch (saveErr) {
              console.error('Failed to save call_feedback:', saveErr)
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
    console.error('calls/feedback error:', error)
    return NextResponse.json({ error: 'Feedback failed' }, { status: 500 })
  }
}
