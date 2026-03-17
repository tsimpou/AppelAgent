import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { call_id, speaker, text, is_flagged } = body as {
      call_id: string
      speaker: string
      text: string
      is_flagged: boolean
    }

    if (!call_id || !speaker || !text) {
      return NextResponse.json({ error: 'call_id, speaker, and text are required' }, { status: 400 })
    }

    const { error } = await supabaseServer.from('transcripts').insert({
      call_id,
      speaker,
      text,
      is_flagged: is_flagged ?? false,
    })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Transcripts POST error:', error)
    return NextResponse.json({ error: 'Failed to save transcript' }, { status: 500 })
  }
}
