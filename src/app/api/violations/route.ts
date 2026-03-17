import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { call_id, agent_id, agent_name, text, reason, severity } = body as {
      call_id: string
      agent_id?: string
      agent_name: string
      text: string
      reason?: string
      severity?: string
    }

    if (!call_id || !agent_name || !text) {
      return NextResponse.json({ error: 'call_id, agent_name, and text are required' }, { status: 400 })
    }

    const { error } = await supabaseServer.from('violations').insert({
      call_id,
      agent_id: agent_id ?? null,
      agent_name,
      text,
      reason: reason ?? null,
      severity: severity ?? 'medium',
    })

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Violations POST error:', error)
    return NextResponse.json({ error: 'Failed to save violation' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)
    const agentName = searchParams.get('agent_name')

    let query = supabaseServer
      .from('violations')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (agentName) {
      query = query.eq('agent_name', agentName)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ violations: data ?? [] })
  } catch (error) {
    console.error('Violations GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch violations' }, { status: 500 })
  }
}
