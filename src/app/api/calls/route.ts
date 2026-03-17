import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabaseServer'

export async function GET() {
  try {
    const supabaseServer = createSupabaseServer()
    const { data, error } = await supabaseServer
      .from('calls')
      .select('*')
      .order('started_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ calls: data ?? [] })
  } catch (error) {
    console.error('Calls GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 })
  }
}
