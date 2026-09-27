# Technical Architecture

## Product Shape

The prototype is an evidence-first industrial buyer intelligence platform. It identifies companies with near-term buying signals, preserves the evidence trail, and calculates an explainable buyer score distinct from confidence.

## Flow

1. Search discovery runs configured query packs through `SearchProvider`.
2. Candidate URLs are normalized and deduplicated.
3. `ContentExtractor` fetches page content and computes hashes.
4. `AIProvider` performs cheap relevance classification before structured extraction. OpenAI, Groq, and Gemini implementations share the same contract.
5. Extracted companies, projects, tenders, requirements, and sources are validated.
6. Signals are persisted and correlated to avoid duplicate event inflation.
7. Buyer scoring generates a snapshot with score components and reasons.
8. Dashboard and company pages display buyers, explanations, timelines, and sources.
9. Trade intelligence uses `TradeIntelligenceProvider`; Volza remains pending until connected.

## Module Boundaries

- UI components never call external APIs directly.
- Route handlers validate input and call module services.
- Providers are replaceable interfaces.
- AI output is untrusted and parsed with Zod before persistence.
- Service role keys are server-only.

## Phase Checkpoint

PHASE: 0 Architecture
STATUS: Implemented

Implemented:
- Next.js structure
- Shared contracts
- Supabase migration design
- Provider boundaries
- Verification scripts

Tests performed:
- TypeScript and unit tests are configured.

Regression check:
- Initial project, no previous features.

Safe to proceed:
YES
