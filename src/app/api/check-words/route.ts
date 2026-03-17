import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { createSupabaseServer } from '@/lib/supabaseServer'

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

    const supabase = createSupabaseServer()

    // Step 1: Fetch ban_words from Supabase dynamically
    const { data: banWordsData } = await supabase.from('ban_words').select('word, severity')
    const forbiddenWords = banWordsData ?? []

    // Step 2: Rule-based check (case-insensitive)
    const lowerText = text.toLowerCase()
    const foundWords: string[] = []
    let highestSeverity = 'medium'

    for (const bw of forbiddenWords) {
      if (lowerText.includes(bw.word.toLowerCase())) {
        foundWords.push(bw.word)
        if (bw.severity === 'high') highestSeverity = 'high'
        else if (bw.severity === 'low' && highestSeverity !== 'high') highestSeverity = 'low'
      }
    }

    if (foundWords.length > 0) {
      if (call_id) {
        await supabase.from('violations').insert({
          call_id,
          agent_name: agent_name ?? 'Unknown',
          text,
          reason: `Απαγορευμένες λέξεις: "${foundWords.join(', ')}"`,
          severity: highestSeverity,
        })
      }
      return NextResponse.json({
        hasViolation: true,
        foundWords,
        aiReason: `Απαγορευμένες λέξεις: ${foundWords.join(', ')}`,
      })
    }

    // Step 3: AI check with Llama Prompt Guard
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
    const prompt = `You are a compliance monitor for a Greek call center. Analyze the following agent speech for policy violations such as threats, insults, discriminatory language, false promises, or pressure tactics.

Agent said: "${text}"

Respond ONLY with valid JSON:
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
      await supabase.from('violations').insert({
        call_id,
        agent_name: agent_name ?? 'Unknown',
        text,
        reason: result.reason ?? null,
        severity: result.severity ?? 'medium',
      })
    }

    return NextResponse.json({
      hasViolation: result.violation ?? false,
      foundWords: [],
      aiReason: result.reason ?? null,
    })
  } catch (error) {
    console.error('Check-words error:', error)
    return NextResponse.json({ error: 'Check failed' }, { status: 500 })
  }
}
