# Agent Assist

Real-time AI assistant for Greek call center sales agents using MicroSIP softphone. Built with Next.js 14, Supabase, and Groq.

## Features

- **Dual audio capture** — MicroSIP speaker (VB-Cable) + agent headset mixed into one stream
- **Live Speech-to-Text** — Groq Whisper `whisper-large-v3-turbo` (Greek)
- **Compliance detection** — Dynamic ban words from Supabase + Llama Prompt Guard AI
- **Streaming AI suggestions** — `llama-3.1-8b-instant` with Server-Sent Events (live typing)
- **Daily briefing** — Streaming AI analysis of previous day's stats
- **Team Leader Dashboard** — 5 tabs: Overview, Briefing, Ban Words management, Violations, Calls

## Tech Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS (dark theme)
- Groq SDK
- Supabase (`@supabase/supabase-js`)
- Deployed to Vercel

---

## Prerequisites

- **Node.js 18+**
- **VB-Cable** installed on agent PC (free: [vb-audio.com/Cable](https://vb-audio.com/Cable))
- **MicroSIP** configured: `Settings → Audio → Speaker: "CABLE Input (VB-Audio)"`

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env example and fill in your keys
cp .env.local.example .env.local
```

Edit `.env.local`:
```
GROQ_API_KEY=your_groq_api_key
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

```bash
# 3. Run dev server
npm run dev
```

---

## Supabase Database Setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run:

```sql
create table agents (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text unique not null,
  created_at timestamptz default now()
);

create table calls (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references agents(id),
  agent_name text,
  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_seconds int,
  total_violations int default 0,
  performance_score int default 100,
  sentiment text default 'neutral'
);

create table transcripts (
  id uuid default gen_random_uuid() primary key,
  call_id uuid references calls(id) on delete cascade,
  speaker text not null,
  text text not null,
  timestamp timestamptz default now(),
  is_flagged boolean default false
);

create table violations (
  id uuid default gen_random_uuid() primary key,
  call_id uuid references calls(id) on delete cascade,
  agent_name text,
  text text not null,
  reason text,
  severity text default 'medium',
  occurred_at timestamptz default now()
);

create table ban_words (
  id uuid default gen_random_uuid() primary key,
  word text not null unique,
  severity text default 'medium',
  added_by text default 'admin',
  created_at timestamptz default now()
);

create table daily_briefings (
  id uuid default gen_random_uuid() primary key,
  content text not null,
  created_at timestamptz default now()
);

create or replace view agent_stats as
select
  a.id as agent_id,
  a.name as agent_name,
  count(c.id) as total_calls,
  coalesce(sum(c.total_violations),0) as total_violations,
  coalesce(avg(c.performance_score)::int, 100) as avg_score,
  date_trunc('day', c.started_at) as stat_date
from agents a
left join calls c on c.agent_id = a.id
group by a.id, a.name, date_trunc('day', c.started_at);
```

3. Copy **Project URL**, **anon key**, and **service_role key** from `Settings → API`

---

## Get a Groq API Key

Free at [console.groq.com](https://console.groq.com) — no credit card required.

---

## Deploy to Vercel

```bash
# 1. Initialize git and push to GitHub
git init
git add .
git commit -m "init agent-assist"
git remote add origin https://github.com/YOUR_USERNAME/agent-assist.git
git push -u origin main
```

2. Go to [vercel.com](https://vercel.com) → **Add New Project** → Import your repo
3. In **Environment Variables**, add all 4 keys:
   - `GROQ_API_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Click **Deploy**

---

## URLs

| Page | URL |
|------|-----|
| Agent live assistant | `/agent` |
| Team Leader Dashboard | `/dashboard` |

---

## Performance Score

```
score = Math.max(0, 100 - violations × 5)
```

| Score | Label | Color |
|-------|-------|-------|
| 80–100 | Άριστο | Green |
| 50–79 | Μέτριο | Yellow |
| 0–49 | Χαμηλό | Red |

---

## Deployment Flow

```
VS Code → git push → GitHub → Vercel auto-deploy
                                     ↓
                              Supabase DB (cloud)
```

Real-time AI assistant for call center sales agents. Built with Next.js 14, Supabase, and Groq.

## Features

- **Live Speech-to-Text** via Groq Whisper (Greek language)
- **Forbidden Words / Compliance Detection** via Llama Prompt Guard
- **AI Suggestions** for agents via Llama 3.1
- **Team Leader Dashboard** with live stats, violations table, calls history
- **Full persistence** to Supabase (PostgreSQL)

## Tech Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS
- Groq SDK (`groq-sdk`)
- Supabase (`@supabase/supabase-js`)
- Deployed to Vercel

---

## Prerequisites

1. **Groq API Key** → [console.groq.com](https://console.groq.com) (free)
2. **Supabase project** → [supabase.com](https://supabase.com) (free tier)
3. **Vercel account** → [vercel.com](https://vercel.com) (free)

---

## Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your keys
cp .env.local .env.local   # already created — just edit the values

# 3. Edit .env.local:
GROQ_API_KEY=your_groq_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# 4. Run the dev server
npm run dev
```

---

## Supabase Database Setup

Go to your Supabase project → **SQL Editor** and run:

```sql
-- Agents table
create table agents (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  email text unique not null,
  created_at timestamptz default now()
);

-- Calls table
create table calls (
  id uuid default gen_random_uuid() primary key,
  agent_id uuid references agents(id),
  agent_name text,
  started_at timestamptz default now(),
  ended_at timestamptz,
  duration_seconds int,
  total_violations int default 0,
  performance_score int default 100,
  sentiment text default 'neutral'
);

-- Transcripts table
create table transcripts (
  id uuid default gen_random_uuid() primary key,
  call_id uuid references calls(id) on delete cascade,
  speaker text not null,
  text text not null,
  timestamp timestamptz default now(),
  is_flagged boolean default false
);

-- Violations table
create table violations (
  id uuid default gen_random_uuid() primary key,
  call_id uuid references calls(id) on delete cascade,
  agent_id uuid references agents(id),
  agent_name text,
  text text not null,
  reason text,
  severity text default 'medium',
  occurred_at timestamptz default now()
);

-- Agent daily stats view
create or replace view agent_stats as
select
  a.id as agent_id,
  a.name as agent_name,
  count(c.id) as total_calls,
  sum(c.total_violations) as total_violations,
  avg(c.performance_score)::int as avg_score,
  date_trunc('day', c.started_at) as stat_date
from agents a
left join calls c on c.agent_id = a.id
group by a.id, a.name, date_trunc('day', c.started_at);
```

---

## Deploy to Vercel

```bash
# 1. Push to GitHub
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/agent-assist.git
git push -u origin main

# 2. Go to vercel.com → Import Project → select your repo

# 3. Add Environment Variables in Vercel dashboard:
#    GROQ_API_KEY
#    NEXT_PUBLIC_SUPABASE_URL
#    NEXT_PUBLIC_SUPABASE_ANON_KEY
#    SUPABASE_SERVICE_ROLE_KEY

# 4. Deploy!
```

---

## URLs

| Page | URL |
|------|-----|
| Agent UI | `/agent` |
| Team Leader Dashboard | `/dashboard` |

---

## Performance Score Logic

```
score = 100
score -= 5 per violation
score = max(0, score)
```

| Score | Label | Color |
|-------|-------|-------|
| 80–100 | Άριστο | Green |
| 50–79 | Μέτριο | Yellow |
| 0–49 | Χαμηλό | Red |

---

## Adding Forbidden Words

Edit `src/app/api/check-words/route.ts`:

```typescript
const FORBIDDEN_WORDS: string[] = [
  // ADD YOUR FORBIDDEN WORDS HERE
  'example_word',
]
```
