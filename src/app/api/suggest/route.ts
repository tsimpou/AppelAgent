import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { transcript } = body as {
      transcript: string
      agentText?: string
      customerText?: string
    }

    if (!transcript) {
      return NextResponse.json({ error: 'No transcript provided' }, { status: 400 })
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const stream = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      stream: true,
      temperature: 0.7,
      max_tokens: 250,
      messages: [
        {
          role: 'system',
          content:
            "Είσαι έμπειρος βοηθός πωλήσεων σε τηλεφωνικό κέντρο.\nΔίνεις 2-3 σύντομες, άμεσες προτάσεις στον agent σε β' ενικό.\nΑπάντησε ΜΟΝΟ με JSON array: [\"πρόταση 1\", \"πρόταση 2\", \"πρόταση 3\"]",
        },
        {
          role: 'user',
          content: `Συνομιλία:\n${transcript}`,
        },
      ],
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) controller.enqueue(encoder.encode(text))
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
    console.error('Suggest error:', error)
    return NextResponse.json({ error: 'Suggestion failed' }, { status: 500 })
  }
}
