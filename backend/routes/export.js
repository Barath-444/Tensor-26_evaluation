const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');

function getTier(team) {
  if (!team.phase1Commit) return 'Tier 3 - No Phase 1';
  if ((team.commitsAfterPhase1 || 0) < 3) return 'Tier 3 - Inactive';
  if ((team.commitsAfterPhase1 change || 0) >= 10) return 'Tier 1 - Deep Dive';
  return 'Tier 2 - Quick Review';
}

function calcTotal(team) {
  return (parseFloat(team.secA) || 0) + (parseFloat(team.secB) || 0) + (parseFloat(team.secC) || 0);
}

router.get('/excel', (req, res) => {
  const teams = Object.values(global.teamsStore);
  const wb = XLSX.utils.book_new();

  // Sheet 1: Teams & Scores
  const headers = [
    '#', 'Team Name', 'Track', 'Members', 'GitHub Repo', 'Repo URL', 'Compare URL (Git Diff)',
    'Phase 1 Commit', 'Phase 1 Time', 'Phase 1 Hash', 'Commits After P1', 'Total Commits',
    'Live URL', 'Tier', 'Section A (/30)', 'Section B (/30)', 'Section C (/40)',
    'Total Score (/100)', 'Notes', 'Last Synced', 'Added At'
  ];

  const rows = teams.map((t, i) => [
    i + 1,
    t.name,
    t.track,
    (t.members || []).join(', '),
    t.repoName || '',
    t.repoUrl || '',
    t.compareUrl || '',
    t.phase1Commit ? 'YES' : 'MISSING',
    t.phase1Time ? new Date(t.phase1Time).toLocaleString('en-IN') : '',
    t.phase1Hash || '',
    t.commitsAfterPhase1 || 0,
    t.totalCommits || 0,
    t.liveUrl || '',
    getTier(t),
    t.secA !== '' ? t.secA : '',
    t.secB !== '' ? t.secB : '',
    t.secC !== '' ? t.secC : '',
    calcTotal(t) || '',
    t.notes || '',
    t.syncedAt ? new Date(t.syncedAt).toLocaleString('en-IN') : 'Not synced',
    t.addedAt ? new Date(t.addedAt).toLocaleString('en-IN') : ''
  ]);

  const ws1 = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws1['!cols'] = [
    { wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 35 }, { wch: 28 }, { wch: 45 }, { wch: 60 },
    { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
    { wch: 45 }, { wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 16 }, { wch: 30 }, { wch: 20 }, { wch: 20 }
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Teams & Scores');

  // Sheet 2: Leaderboard
  const sorted = [...teams].sort((a, b) => calcTotal(b) - calcTotal(a));
  const lbHeaders = ['Rank', 'Team Name', 'Track', 'Sec A', 'Sec B', 'Sec C', 'Total', 'Tier', 'Live URL'];
  const lbRows = sorted.map((t, i) => [
    i + 1, t.name, t.track,
    t.secA !== '' ? t.secA : '—',
    t.secB !== '' ? t.secB : '—',
    t.secC !== '' ? t.secC : '—',
    calcTotal(t) || '—',
    getTier(t),
    t.liveUrl || 'None'
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([lbHeaders, ...lbRows]);
  ws2['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 22 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Leaderboard');

  // Sheet 3: Compliance
  const compHeaders = ['Team', 'Repo', 'Phase 1 Commit', 'Commits After', 'Live URL', 'Branch Protected', 'Status'];
  const compRows = teams.map(t => {
    let status = 'OK';
    if (!t.phase1Commit) status = 'FORFEIT Sec A';
    else if ((t.commitsAfterPhase1 || 0) < 3) status = 'LOW ACTIVITY';
    else if (!t.liveUrl) status = 'NO LIVE URL';
    return [t.name, t.repoName, t.phase1Commit ? 'YES' : 'MISSING', t.commitsAfterPhase1 || 0, t.liveUrl || 'None', t.branchProtected ? 'YES' : 'NO', status];
  });
  const ws3 = XLSX.utils.aoa_to_sheet([compHeaders, ...compRows]);
  XLSX.utils.book_append_sheet(wb, ws3, 'Compliance Check');

  // Sheet 4: Event Log
  const logHeaders = ['Time', 'Type', 'Event'];
  const logRows = global.eventLog.map(e => [e.ts, e.type, e.msg]);
  const ws4 = XLSX.utils.aoa_to_sheet([logHeaders, ...logRows]);
  XLSX.utils.book_append_sheet(wb, ws4, 'Event Log');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `TENSOR26_Evaluation_${new Date().toISOString().slice(0, 10)}.xlsx`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);

  global.addLog(`Excel exported: ${teams.length} teams`, 'export');
});

module.exports = router;
