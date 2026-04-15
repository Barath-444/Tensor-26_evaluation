const express = require('express');
const router = express.Router();

function getTier(team) {
  if (!team.phase1Commit) return 'T3';
  if ((team.commitsAfterPhase1 || 0) < 3) return 'T3';
  if ((team.commitsAfterPhase1 || 0) >= 10) return 'T1';
  return 'T2';
}

function calcTotal(team) {
  return (parseFloat(team.secA) || 0) + (parseFloat(team.secB) || 0) + (parseFloat(team.secC) || 0);
}

// GET all teams
router.get('/', (req, res) => {
  const teams = Object.values(global.teamsStore).map(t => ({
    ...t,
    tier: getTier(t),
    total: calcTotal(t)
  }));
  res.json({ teams, count: teams.length });
});

// POST add team
router.post('/', (req, res) => {
  const { name, track, members, repoName, liveUrl, hash, commitsAfterPhase1 } = req.body;
  if (!name) return res.status(400).json({ error: 'Team name required' });

  const org = process.env.GITHUB_ORG || 'tensor26-srmiist';
  const id = repoName || name.toLowerCase().replace(/\s+/g, '-');

  const team = {
    id,
    name,
    track: track || 'Industry',
    members: Array.isArray(members) ? members : (members || '').split(',').map(s => s.trim()).filter(Boolean),
    repoName: repoName || '',
    repoUrl: repoName ? `https://github.com/${org}/${repoName}` : '',
    compareUrl: (repoName && hash) ? `https://github.com/${org}/${repoName}/compare/${hash}...main` : '',
    liveUrl: liveUrl || '',
    phase1Commit: !!hash,
    phase1Hash: hash || null,
    phase1Time: hash ? new Date().toISOString() : null,
    commitsAfterPhase1: parseInt(commitsAfterPhase1) || 0,
    totalCommits: 0,
    secA: '',
    secB: '',
    secC: '',
    notes: '',
    addedAt: new Date().toISOString(),
    syncedAt: null,
    lastCommit: null
  };

  global.teamsStore[id] = team;
  global.addLog(`Team added: ${name} (${track})`, 'add');
  global.saveData();
  res.json({ team: { ...team, tier: getTier(team), total: calcTotal(team) } });
});

// POST bulk import
router.post('/bulk', (req, res) => {
  const { teams } = req.body;
  if (!Array.isArray(teams)) return res.status(400).json({ error: 'teams array required' });

  const org = process.env.GITHUB_ORG || 'tensor26-srmiist';
  let added = 0;

  teams.forEach(t => {
    if (!t.name) return;
    const id = t.repoName || t.name.toLowerCase().replace(/\s+/g, '-');
    global.teamsStore[id] = {
      id,
      name: t.name,
      track: t.track || 'Industry',
      members: Array.isArray(t.members) ? t.members : (t.members || '').split(',').map(s => s.trim()).filter(Boolean),
      repoName: t.repoName || '',
      repoUrl: t.repoName ? `https://github.com/${org}/${t.repoName}` : '',
      compareUrl: '',
      liveUrl: t.liveUrl || '',
      phase1Commit: false,
      phase1Hash: null,
      phase1Time: null,
      commitsAfterPhase1: 0,
      totalCommits: 0,
      secA: '', secB: '', secC: '',
      notes: '',
      addedAt: new Date().toISOString(),
      syncedAt: null,
      lastCommit: null
    };
    added++;
  });

  global.addLog(`Bulk imported ${added} teams`, 'add');
  global.saveData();
  res.json({ added, total: Object.keys(global.teamsStore).length });
});

// PATCH update score/notes
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  if (!global.teamsStore[id]) return res.status(404).json({ error: 'Team not found' });

  const allowed = ['secA', 'secB', 'secC', 'notes', 'liveUrl', 'phase1Commit', 'phase1Hash', 'commitsAfterPhase1', 'track', 'members'];
  allowed.forEach(field => {
    if (req.body[field] !== undefined) {
      global.teamsStore[id][field] = req.body[field];
    }
  });

  // Validate scores
  if (req.body.secA !== undefined) global.teamsStore[id].secA = Math.min(30, Math.max(0, parseFloat(req.body.secA) || 0));
  if (req.body.secB !== undefined) global.teamsStore[id].secB = Math.min(30, Math.max(0, parseFloat(req.body.secB) || 0));
  if (req.body.secC !== undefined) global.teamsStore[id].secC = Math.min(40, Math.max(0, parseFloat(req.body.secC) || 0));

  const team = global.teamsStore[id];
  if (req.body.secA !== undefined || req.body.secB !== undefined || req.body.secC !== undefined) {
    global.addLog(`Score updated: ${team.name} → A:${team.secA} B:${team.secB} C:${team.secC} Total:${calcTotal(team)}`, 'score');
  }

  global.saveData();
  res.json({ team: { ...team, tier: getTier(team), total: calcTotal(team) } });
});

// DELETE team
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!global.teamsStore[id]) return res.status(404).json({ error: 'Team not found' });
  const name = global.teamsStore[id].name;
  delete global.teamsStore[id];
  global.addLog(`Team removed: ${name}`, 'warn');
  global.saveData();
  res.json({ message: 'Deleted' });
});

// GET leaderboard
router.get('/leaderboard', (req, res) => {
  const teams = Object.values(global.teamsStore)
    .map(t => ({ ...t, tier: getTier(t), total: calcTotal(t) }))
    .sort((a, b) => b.total - a.total);
  res.json(teams);
});

module.exports = router;
