import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabaseServer'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const supabaseServer = createSupabaseServer()
    const { data, error } = await supabaseServer
      .from('calls')
      .select('*')
      .order('started_at', { ascending: false })

    if (error) throw error

    return NextResponse.json({ calls: data ?? [] }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (error) {
    console.error('Calls GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 })
  }
}
