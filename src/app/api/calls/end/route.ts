import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabaseServer'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { call_id, duration_seconds, total_violations } = body as {
      call_id: string
      duration_seconds: number
      total_violations: number
    }

    if (!call_id) {
      return NextResponse.json({ error: 'call_id is required' }, { status: 400 })
    }

    const performance_score = Math.max(0, 100 - (total_violations ?? 0) * 5)

    const { error } = await supabaseServer
      .from('calls')
      .update({
        ended_at: new Date().toISOString(),
        duration_seconds: duration_seconds ?? 0,
        total_violations: total_violations ?? 0,
        performance_score,
      })
      .eq('id', call_id)

    if (error) throw error

    return NextResponse.json({ success: true, performance_score })
  } catch (error) {
    console.error('Calls/end error:', error)
    return NextResponse.json({ error: 'Failed to end call' }, { status: 500 })
  }
}
