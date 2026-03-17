import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { supabaseServer } from '@/lib/supabaseServer'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

// ADD YOUR FORBIDDEN WORDS HERE
const FORBIDDEN_WORDS: string[] = []

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, call_id, agent_name } = body as {
      text: string
      call_id?: string
      agent_name?: string
    }

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 })
    }

    // Local keyword check first
    const lowerText = text.toLowerCase()
    const foundWord = FORBIDDEN_WORDS.find((w) => lowerText.includes(w.toLowerCase()))
    if (foundWord) {
      if (call_id) {
        await supabaseServer.from('violations').insert({
          call_id,
          agent_name: agent_name ?? 'Unknown',
          text,
          reason: `Απαγορευμένη λέξη: "${foundWord}"`,
          severity: 'high',
        })
      }
      return NextResponse.json({
        violation: true,
        reason: `Απαγορευμένη λέξη: "${foundWord}"`,
        severity: 'high',
      })
    }

    // AI-based check with Llama Prompt Guard
    const prompt = `You are a compliance monitor for a Greek call center. Analyze the following agent speech for policy violations such as threats, insults, discriminatory language, false promises, or pressure tactics.

Agent said: "${text}"

Respond ONLY with valid JSON in this exact format:
{"violation": true/false, "reason": "explanation or null", "severity": "low|medium|high"}`

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-prompt-guard-2-86m',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { violation: false }

    if (result.violation && call_id) {
      await supabaseServer.from('violations').insert({
        call_id,
        agent_name: agent_name ?? 'Unknown',
        text,
        reason: result.reason ?? null,
        severity: result.severity ?? 'medium',
      })
    }

    return NextResponse.json({
      violation: result.violation ?? false,
      reason: result.reason ?? null,
      severity: result.severity ?? 'medium',
    })
  } catch (error) {
    console.error('Check-words error:', error)
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
}
