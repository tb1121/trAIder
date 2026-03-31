# trAIder

trAIder is now scaffolded as a Vercel-native Next.js app with Supabase auth/database and a server-side trading coach route. The product keeps a per-user profile JSON, stores conversations in Postgres, and includes that structured context in every coaching request.

## Stack

- Next.js App Router for the frontend and Vercel deployment target
- Supabase Auth for email/password login
- Supabase Postgres for profiles, conversations, and messages
- OpenAI server route for coaching replies when `OPENAI_API_KEY` is set
- Financial Modeling Prep for the live market tape under the desk navbar
- Optional Google Programmable Search for fallback coach web lookups
- A modern branded workspace with a visible profile JSON snapshot

## Local setup

1. Copy [.env.example](/Users/taylorball/Documents/Playground/.env.example) to `.env.local`
2. Fill in your Supabase project URL and anon key
3. Optionally add:

```bash
FMP_API_KEY=your_fmp_key_here
GOOGLE_SEARCH_API_KEY=your_google_search_key_here
GOOGLE_SEARCH_CX=your_programmable_search_engine_id_here
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

4. Apply the SQL in [202603260001_traider.sql](/Users/taylorball/Documents/Playground/supabase/migrations/202603260001_traider.sql) to your Supabase project
5. Install packages:

```bash
npm install
```

6. Start the app:

```bash
npm run dev
```

7. Open `http://localhost:3000`

## Deploy to Vercel

1. Push this repo to GitHub
2. Import the project into Vercel
3. Add the same env vars from `.env.local`
4. Redeploy

## Notes

- The new Vercel/Supabase app lives under `src/`
- The older FastAPI prototype now lives in `legacy_fastapi/` as a legacy reference and is no longer the main deployment path
