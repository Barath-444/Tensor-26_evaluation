# TENSOR-26 — Evaluation System

Full-stack evaluation dashboard for TENSOR-26 hackathon.  
Connects directly to GitHub Classroom, syncs repos, tracks scores, and exports Excel.

---

## Project Structure

```
tensor26-evaluator/
├── backend/                  # Node.js + Express API
│   ├── routes/
│   │   ├── github.js         # GitHub API integration
│   │   ├── teams.js          # Team CRUD + scoring
│   │   └── export.js         # Excel export
│   ├── server.js             # Main server
│   ├── .env.example          # Copy this to .env
│   └── package.json
├── frontend/                 # React app
│   ├── src/
│   │   ├── App.js            # Main dashboard
│   │   ├── App.css           # All styles
│   │   └── index.js
│   └── package.json
├── scripts/                  # Bash helper scripts
│   ├── check_phase1.sh
│   ├── clone_all.sh
│   └── generate_urls.sh
└── README.md
```

---

## Quick Start

### Step 1 — Get a GitHub Token

1. Go to https://github.com/settings/tokens → Fine-grained tokens → Generate new
2. Set permissions: `Contents: Read`, `Metadata: Read`, `Members: Read`
3. Copy the token

### Step 2 — Configure Backend

```bash
cd backend
cp .env.example .env
# Edit .env and fill in your token and org name
npm install
npm start
```

### Step 3 — Start Frontend

```bash
cd frontend
npm install
npm start
```

Open http://localhost:3000

---

## .env Configuration

```env
GITHUB_TOKEN=ghp_your_token_here
GITHUB_ORG=tensor26-srmiist          # Your GitHub org name
GITHUB_CLASSROOM_ID=12345               # From classroom.github.com
PORT=3001
PHASE1_COMMIT_MESSAGE=feat: Initial AI Generation
```

### How to find your Classroom ID
- Go to classroom.github.com
- Open your classroom → check the URL: `classroom.github.com/classrooms/XXXXXX`
- That number is your GITHUB_CLASSROOM_ID

---

## How It Works

### Adding Teams

**Option A — Bulk CSV import** (fastest for 170+ teams):
- Click "Bulk import" in the dashboard
- Paste CSV: `TeamName, Track, Member1, Member2, Member3, Member4, RepoName, LiveURL`
- Click Import

**Option B — Add manually** via the "Add team" button

**Option C — Sync from GitHub Org** (after adding teams):
- Click "Sync all from GitHub"
- The backend fetches commits, finds Phase 1 commit, extracts live URL from README
- Takes ~1 min for 170 teams (rate-limited to avoid GitHub API limits)

### Scoring

- Click on any team row to expand it and see commit history
- Fill in Section A (/30), Section B (/30), Section C (/40) scores directly in the table
- Scores auto-save after 600ms debounce
- Total updates instantly
- All scoring actions are timestamped in the Event Log

### GitHub Sync

Each team sync does:
1. Fetches all commits from their repo
2. Finds the `feat: Initial AI Generation` commit (Phase 1 baseline)
3. Counts commits after Phase 1 (human finetuning activity)
4. Scans README.md for deployment URLs (vercel, streamlit, huggingface, render)
5. Checks branch protection status
6. Builds the GitHub compare URL (for jury to view Git Diff)

### Tier Classification (automatic)

| Tier | Condition | Jury time |
|------|-----------|-----------|
| Tier 1 | Phase 1 commit + 10+ commits after | Full 8-min deep dive |
| Tier 2 | Phase 1 commit + 3–9 commits after | Quick 2-min review |
| Tier 3 | No Phase 1 commit OR <3 commits | Auto-penalised, minimal time |

### Excel Export

Click "Export Excel" → downloads `.xlsx` with 4 sheets:
1. **Teams & Scores** — all data including compare URLs
2. **Leaderboard** — ranked by total score
3. **Compliance Check** — Phase 1 status, live URLs, flagged issues
4. **Event Log** — full timestamped activity trail

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status |
| GET | `/api/github/org/repos` | List all org repos |
| POST | `/api/github/sync-team` | Sync one team |
| POST | `/api/github/sync-all` | Sync all teams (background) |
| GET | `/api/github/classroom/assignments` | List classroom assignments |
| GET | `/api/teams` | All teams + scores |
| POST | `/api/teams` | Add team |
| POST | `/api/teams/bulk` | Bulk import |
| PATCH | `/api/teams/:id` | Update score/notes |
| DELETE | `/api/teams/:id` | Remove team |
| GET | `/api/export/excel` | Download Excel |
| GET | `/api/log` | Event log |

---

## Event Day Checklist

| Time | Action |
|------|--------|
| Before event | Set up backend, paste GitHub token, test with one repo |
| 09:00 | Bulk import all team names + repo names |
| 10:00 | Phase 1 starts — no action needed |
| 12:55 | Announce Phase 1 commit deadline |
| 13:05 | Click "Sync all" → check Phase 1 column instantly |
| 14:00–19:00 | Sync every 30 min to track commit activity |
| 18:45 | Final sync before Checkpoint 1 |
| 19:00 | Jury uses Compare URLs in table for Git Diff evaluation |
| 00:00 | GitHub Classroom locks repos. Final sync. Export Excel. |
| 08:00 | Export final Excel for prize announcement |

---

## Deployment (Optional — for network access)

To run on a shared network so jury members can access from their own laptops:

```bash
# Backend: already listens on 0.0.0.0 by default
# Frontend: 
REACT_APP_API=http://YOUR_IP:3001 npm start

# Or build and serve statically:
npm run build
npx serve -s build -p 3000
```

---

## Notes

- Data is stored **in-memory** in the backend — restart clears it. For persistence across restarts, export Excel before shutting down.
- GitHub API rate limit: 5000 requests/hour with a token. Syncing 170 teams uses ~340 requests (2 per team). Well within limits.
- The 300ms delay in bulk sync is intentional to avoid hitting GitHub's secondary rate limits.
