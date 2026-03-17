import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transcript } = body as { transcript: string }

    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 })
    }

    const prompt = `Είσαι βοηθός πωλήσεων σε τηλεφωνικό κέντρο. Βάσει της παρακάτω συνομιλίας, δώσε 3 σύντομες προτάσεις στα Ελληνικά για τον πράκτορα — πώς να χειριστεί καλύτερα την κλήση, τι να πει ή πώς να κλείσει.

Συνομιλία:
${transcript}

Απάντησε ΜΟΝΟ με έγκυρο JSON:
{"suggestions": ["πρόταση 1", "πρόταση 2", "πρόταση 3"]}`

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    })

    const raw = completion.choices[0]?.message?.content ?? '{}'
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { suggestions: [] }

    return NextResponse.json({ suggestions: result.suggestions ?? [] })
  } catch (error) {
    console.error('Suggest error:', error)
    return NextResponse.json({ error: 'Suggestion failed' }, { status: 500 })
  }
}
