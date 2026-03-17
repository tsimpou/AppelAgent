import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabaseServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { agent_name } = body as { agent_name: string }

    if (!agent_name) {
      return NextResponse.json({ error: 'agent_name is required' }, { status: 400 })
    }

    const supabaseServer = createSupabaseServer()
    const { data, error } = await supabaseServer
      .from('calls')
      .insert({ agent_name })
      .select('id')
      .single()

    if (error) throw error

    return NextResponse.json({ call_id: data.id })
  } catch (error) {
    console.error('Calls/start error:', error)
    return NextResponse.json({ error: 'Failed to start call' }, { status: 500 })
  }
}
