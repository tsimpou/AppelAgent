import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabaseServer'

export async function GET() {
  try {
    const supabase = createSupabaseServer()
    const { data, error } = await supabase
      .from('ban_words')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error
    return NextResponse.json({ words: data ?? [] })
  } catch (error) {
    console.error('ban-words GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch ban words' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const supabase = createSupabaseServer()

    // ── Bulk insert (from TXT upload) ──────────────────────────────────
    if (Array.isArray(body.words)) {
      const rows = (body.words as string[])
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 0)
        .filter((w, i, arr) => arr.indexOf(w) === i) // deduplicate
        .map((w) => ({
          word: w,
          severity: (body.severity as string) ?? 'medium',
          added_by: (body.added_by as string) ?? 'admin',
        }))

      if (rows.length === 0) {
        return NextResponse.json({ error: 'No valid words in list' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('ban_words')
        .upsert(rows, { onConflict: 'word', ignoreDuplicates: true })
        .select()

      if (error) throw error
      return NextResponse.json({ success: true, added: data?.length ?? 0, total: rows.length })
    }

    // ── Single insert ──────────────────────────────────────────────────
    const { word, severity, added_by } = body as {
      word: string
      severity: string
      added_by?: string
    }

    if (!word?.trim()) {
      return NextResponse.json({ error: 'word is required' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('ban_words')
      .insert({
        word: word.trim().toLowerCase(),
        severity: severity ?? 'medium',
        added_by: added_by ?? 'admin',
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, word: data })
  } catch (error) {
    console.error('ban-words POST error:', error)
    return NextResponse.json({ error: 'Failed to add ban word' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const supabase = createSupabaseServer()
    const { error } = await supabase.from('ban_words').delete().eq('id', id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('ban-words DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete ban word' }, { status: 500 })
  }
}
