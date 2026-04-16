const express = require('express');
const router = express.Router();
const axios = require('axios');

const { GITHUB_TOKEN, GITHUB_ORG, PHASE1_COMMIT_MESSAGE } = process.env;
const phase1Msg = PHASE1_COMMIT_MESSAGE || 'Phase 1 baseline';

function parseGitHubUrl(url) {
  if (!url) return { owner: null, repo: null };
  const clean = url.trim()
    .replace(/https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/git@github\.com[:/]/i, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
  }
  return { owner: null, repo: parts[0] || null };
}

const GH = () => axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  }
});

// GET /api/github/org/repos - list all repos in org
router.get('/org/repos', async (req, res) => {
  try {
    const org = process.env.GITHUB_ORG;
    if (!org) return res.status(400).json({ error: 'GITHUB_ORG not set in .env' });

    let repos = [];
    let page = 1;
    while (true) {
      const { data } = await GH().get(`/orgs/${org}/repos`, {
        params: { per_page: 100, page, type: 'all', sort: 'created' }
      });
      if (!data.length) break;
      repos = repos.concat(data);
      if (data.length < 100) break;
      page++;
    }

    const prefix = process.env.REPO_PREFIX || 'tensor-26-hackathon';
    const filtered = repos
      .filter(r => r.name.startsWith(prefix))
      .map(r => ({
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        defaultBranch: r.default_branch
      }));

    global.addLog(`Fetched ${filtered.length} hackathon repos (prefix: ${prefix}) from org ${org}`, 'github');
    res.json({ repos: filtered, count: filtered.length, org });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    global.addLog(`GitHub org fetch error: ${msg}`, 'error');
    res.status(500).json({ error: msg });
  }
});

// GET /api/github/repo/:repoName/commits - get commits for a repo
router.get('/repo/:repoName/commits', async (req, res) => {
  try {
    const org = process.env.GITHUB_ORG;
    const { repoName } = req.params;
    const { data } = await GH().get(`/repos/${org}/${repoName}/commits`, {
      params: { per_page: 100 }
    });

    const commits = data.map(c => ({
      sha: c.sha,
      shortSha: c.sha.substring(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url
    }));

    res.json({ commits, count: commits.length });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/github/sync-team - sync a single team repo
router.post('/sync-team', async (req, res) => {
  try {
    const { repoName } = req.body;
    const team = global.teamsStore[repoName];
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const { owner: pOwner, repo: pRepo } = parseGitHubUrl(team.repoUrl || team.repoName || team.id);
    const owner = pOwner || team.repoOwner || process.env.GITHUB_ORG;
    const repo = pRepo || team.repoName || repoName;

    // Get repository details and commits
    const [{ data: repoData }, { data: commits }] = await Promise.all([
      GH().get(`/repos/${owner}/${repo}`),
      GH().get(`/repos/${owner}/${repo}/commits`, { params: { per_page: 100 } })
    ]);
    const repoCreatedAt = repoData.created_at;

    const allCommits = commits.map(c => ({
      sha: c.sha,
      shortSha: c.sha.substring(0, 7),
      message: c.commit.message,
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url
    }));

    // Find Phase 1 marker (newest-to-oldest search)
    let phase1Index = allCommits.findIndex(c =>
      c.message.toLowerCase().includes(phase1Msg.toLowerCase())
    );
    
    // If no marker, use the OLDEST commit as the milestone (so View Diff shows everything)
    if (phase1Index === -1 && allCommits.length > 0) {
      phase1Index = allCommits.length - 1; // Oldest commit
    }

    let phase1Commit = phase1Index !== -1 ? allCommits[phase1Index] : null;
    let commitsAfterPhase1 = phase1Index !== -1 ? phase1Index : 0;
    let phase1Hash = phase1Commit?.shortSha || null;
    let phase1Confirmed = !!phase1Commit;

    // Correction Logic: If the commit date is older than repo creation (template), use repo creation time.
    const finalPhase1Time = phase1Commit ? (
      new Date(phase1Commit.date) < new Date(repoCreatedAt) 
        ? repoCreatedAt 
        : phase1Commit.date
    ) : null;

    // Get README for live URL
    let liveUrl = '';
    try {
      const { data: readme } = await GH().get(`/repos/${owner}/${repo}/readme`);
      const content = Buffer.from(readme.content, 'base64').toString('utf-8');
      const urlMatch = content.match(/https?:\/\/[^\s)"\]]+\.(vercel\.app|streamlit\.app|huggingface\.co|onrender\.com|hf\.space)[^\s)"\]]*/);
      if (urlMatch) liveUrl = urlMatch[0];
    } catch (_) {}

    // Check branch protection
    let branchProtected = false;
    try {
      const { data: branch } = await GH().get(`/repos/${owner}/${repo}/branches/main`);
      branchProtected = branch.protected || false;
    } catch (_) {}

    const syncData = {
      repoName,
      repoUrl: `https://github.com/${owner}/${repo}`,
      compareUrl: phase1Hash ? `https://github.com/${owner}/${repo}/compare/${phase1Hash}...main` : '',
      totalCommits: allCommits.length,
      phase1Commit: phase1Confirmed,
      phase1Hash,
      phase1Time: finalPhase1Time,
      commitsAfterPhase1,
      liveUrl,
      branchProtected,
      lastCommit: allCommits[0] || null,
      allCommits: allCommits.slice(0, 30),
      syncedAt: new Date().toISOString()
    };

    // Update store
    if (global.teamsStore[repoName]) {
      global.teamsStore[repoName] = { ...global.teamsStore[repoName], ...syncData };
    }

    global.addLog(`Synced repo: ${repoName} | P1: ${syncData.phase1Commit ? 'YES' : 'MISSING'} | Commits after: ${commitsAfterPhase1}`, 'sync');
    global.saveData();
    res.json(syncData);
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    global.addLog(`Sync error for ${req.body.repoName}: ${msg}`, 'error');
    res.status(500).json({ error: msg });
  }
});

// POST /api/github/sync-all - sync all teams
router.post('/sync-all', async (req, res) => {
  const keys = Object.keys(global.teamsStore);
  if (!keys.length) return res.status(400).json({ error: 'No teams added yet' });

  res.json({ message: `Syncing ${keys.length} teams in background`, count: keys.length });

  // Background sync
  (async () => {
    global.addLog(`Starting bulk sync for ${keys.length} teams`, 'sync');
    for (const repoName of keys) {
      // Declare owner/repo OUTSIDE try so they're accessible in catch
      let owner = GITHUB_ORG;
      let repo = repoName;
      try {
        const team = global.teamsStore[repoName];
        const { owner: pOwner, repo: pRepo } = parseGitHubUrl(team.repoUrl || team.repoName || team.id);
        owner = pOwner || team.repoOwner || GITHUB_ORG;
        repo = pRepo || team.repoName || team.id;

        const [{ data: repoData }, { data: commits }] = await Promise.all([
          GH().get(`/repos/${owner}/${repo}`),
          GH().get(`/repos/${owner}/${repo}/commits`, { params: { per_page: 100 } })
        ]);
        const repoCreatedAt = repoData.created_at;

        const allCommits = commits.map(c => ({ sha: c.sha, shortSha: c.sha.substring(0, 7), message: c.commit.message, author: c.commit.author.name, date: c.commit.author.date, url: c.html_url }));
        
        // Use identical logic to sync-team
        let pIndex = allCommits.findIndex(c => c.message.toLowerCase().includes(phase1Msg.toLowerCase()));
        if (pIndex === -1 && allCommits.length > 0) pIndex = allCommits.length - 1; // Oldest

        const pCommit = pIndex !== -1 ? allCommits[pIndex] : null;
        const pTime = pCommit ? (new Date(pCommit.date) < new Date(repoCreatedAt) ? repoCreatedAt : pCommit.date) : null;

        let liveUrl = team.liveUrl || '';
        try {
          const { data: readme } = await GH().get(`/repos/${owner}/${repo}/readme`);
          const content = Buffer.from(readme.content, 'base64').toString('utf-8');
          const urlMatch = content.match(/https?:\/\/[^\s)"]+\.(vercel\.app|streamlit\.app|huggingface\.co|onrender\.com|hf\.space)[^\s)"]*/);
          if (urlMatch) liveUrl = urlMatch[0];
        } catch (_) {}
        global.teamsStore[repoName] = {
          ...global.teamsStore[repoName],
          repoOwner: owner,
          repoName: repo,
          phase1Commit: !!pCommit,
          phase1Hash: pCommit?.shortSha || null,
          phase1Time: pTime,
          commitsAfterPhase1: pIndex > 0 ? pIndex : 0,
          totalCommits: allCommits.length,
          liveUrl,
          compareUrl: pCommit ? `https://github.com/${owner}/${repo}/compare/${pCommit.shortSha}...main` : '',
          lastCommit: allCommits[0] || null,
          syncedAt: new Date().toISOString()
        };
        global.addLog(`Synced: ${team.name || repo} | Commits: ${allCommits.length}`, 'sync');
        await new Promise(r => setTimeout(r, 300)); // rate limit
      } catch (e) {
        const errorDetail = e.response?.data?.message || e.message;
        global.addLog(`Sync failed for ${repoName} [${owner}/${repo}]: ${errorDetail}`, 'error');
      }
    }
    global.saveData();
    global.addLog(`Bulk sync complete for ${keys.length} teams`, 'sync');
  })().catch(err => {
    console.error('CRITICAL sync-all error:', err);
    global.addLog(`Sync crashed: ${err.message}`, 'error');
  });
});

// GET /api/github/classroom/assignments - list classroom assignments
router.get('/classroom/assignments', async (req, res) => {
  try {
    const classroomId = process.env.GITHUB_CLASSROOM_ID;
    if (!classroomId) return res.status(400).json({ error: 'GITHUB_CLASSROOM_ID not set in .env' });
    const { data } = await GH().get(`/classrooms/${classroomId}/assignments`, { params: { per_page: 50 } });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/github/classroom/assignments/:id/accepted - get all accepted assignments
router.get('/classroom/assignments/:id/accepted', async (req, res) => {
  try {
    let accepted = [];
    let page = 1;
    while (true) {
      const { data } = await GH().get(`/assignments/${req.params.id}/accepted_assignments`, {
        params: { per_page: 100, page }
      });
      if (!data.length) break;
      accepted = accepted.concat(data);
      if (data.length < 100) break;
      page++;
    }
    global.addLog(`Fetched ${accepted.length} accepted assignments`, 'github');
    res.json({ accepted, count: accepted.length });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/github/import-classroom - Auto-discover teams from classroom
router.post('/import-classroom', async (req, res) => {
  try {
    const classroomId = process.env.GITHUB_CLASSROOM_ID;
    if (!classroomId) return res.status(400).json({ error: 'GITHUB_CLASSROOM_ID not set' });

    // 1. Get assignments
    const { data: assignments } = await GH().get(`/classrooms/${classroomId}/assignments`);
    if (!assignments.length) return res.status(404).json({ error: 'No assignments found in classroom' });

    // Use the first assignment (usually the main hackathon one)
    const assignment = assignments[0];
    global.addLog(`Fetching teams for assignment: ${assignment.title}`, 'github');

    // 2. Get accepted assignments
    let allAccepted = [];
    let page = 1;
    while (true) {
      const { data } = await GH().get(`/assignments/${assignment.id}/accepted_assignments`, {
        params: { per_page: 100, page }
      });
      if (!data.length) break;
      allAccepted = allAccepted.concat(data);
      if (data.length < 100) break;
      page++;
    }

    // 3. Import into teamsStore
    let newTeams = 0;
    const org = process.env.GITHUB_ORG || 'tensor-26';
    
    allAccepted.forEach(acc => {
      const repoName = acc.repository.name;
      const teamName = repoName.replace(`tensor-26-hackathon-`, '').toUpperCase(); // Extract clean name
      
      if (!global.teamsStore[repoName]) {
        global.teamsStore[repoName] = {
          id: repoName,
          name: teamName,
          track: 'Industry',
          members: acc.students.map(s => s.login),
          repoName: repoName,
          repoUrl: `https://github.com/${org}/${repoName}`,
          compareUrl: '',
          liveUrl: '',
          phase1Commit: false,
          phase1Hash: null,
          commitsAfterPhase1: 0,
          totalCommits: 0,
          secA: '', secB: '', secC: '',
          notes: '',
          addedAt: new Date().toISOString(),
          syncedAt: null
        };
        newTeams++;
      }
    });

    global.addLog(`Auto-imported ${newTeams} teams from Classroom`, 'add');
    global.saveData();
    res.json({ message: `Successfully imported ${newTeams} new teams`, total: Object.keys(global.teamsStore).length });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
