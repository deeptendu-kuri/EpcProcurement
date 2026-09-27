# Supabase Setup

The local app has Supabase credentials in `.env.local`, but database tables must still be created in the hosted project.

## Apply Schema

Open the Supabase SQL Editor and run:

```sql
-- paste contents of supabase/migrations/0001_initial_schema.sql
```

The migration creates:

- profiles and role enum
- companies and aliases
- sources
- projects
- tenders
- product_requirements
- signals
- buyer_scores history
- search_configs
- processing_jobs
- usage_events
- RLS policies and indexes

## Production Note

The service role key must stay server-side only. Because it was shared in chat during setup, rotate it before production deployment.

## AI Testing

For low-cost testing, add either:

```bash
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
```

or:

```bash
GEMINI_API_KEY=
```

The provider priority is OpenAI, then Groq, then Gemini.
