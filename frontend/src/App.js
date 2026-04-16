import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import './App.css';

const API = axios.create({ 
  baseURL: '/api',
  headers: {
    'ngrok-skip-browser-warning': 'true'
  }
});

const TRACKS = ['Industry', 'Societal', 'R&D'];

function getTier(team) {
  const totalCommits = (team.commitsAfterPhase1 || 0) + (team.phase1Commit ? 1 : 0);
  if (totalCommits === 0) return { label: 'Tier 3', color: 'red', reason: 'No commits found' };
  if (team.liveUrl && team.liveUrl.startsWith('http')) return { label: 'Tier 1', color: 'green', reason: 'Live URL + Active' };
  return { label: 'Tier 2', color: 'amber', reason: 'Active but no Live URL' };
}

function calcTotal(t) {
  return (parseFloat(t.secA) || 0) + (parseFloat(t.secB) || 0) + (parseFloat(t.secC) || 0);
}

function useDebounce(fn, delay) {
  const timer = useRef(null);
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fn(...args), delay);
  }, [fn, delay]);
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatusBadge({ ok, trueLabel, falseLabel }) {
  return (
    <span className={`badge ${ok ? 'badge-ok' : 'badge-err'}`}>
      {ok ? trueLabel : falseLabel}
    </span>
  );
}

function TierBadge({ team }) {
  const tier = getTier(team);
  return <span className={`badge badge-tier-${tier.color}`} title={tier.reason}>{tier.label}</span>;
}

function ScoreInput({ value, max, onChange }) {
  return (
    <input
      type="number"
      className="score-input"
      value={value === '' ? '' : value}
      min="0"
      max={max}
      placeholder="—"
      onChange={e => onChange(e.target.value === '' ? '' : Math.min(max, Math.max(0, parseFloat(e.target.value) || 0)))}
    />
  );
}

const PHASES = [
  { id: 'Inauguration', label: 'Inauguration', duration: 60, color: '#c0c0c0' },
  { id: 'Phase 1', label: 'Phase 1 — AI Generation', duration: 180, color: '#d4af37' },
  { id: 'Lunch', label: 'Lunch Break', duration: 60, color: '#8b7355' },
  { id: 'Phase 2', label: 'Phase 2 — Co-Curation', duration: 300, color: '#d4af37' },
  { id: 'Checkpoint 1', label: 'Checkpoint 1 Evaluation', duration: 90, color: '#e5e4e2' },
  { id: 'Phase 3', label: 'Phase 3 — Integration', duration: 420, color: '#d4af37' },
  { id: 'Dinner', label: 'Dinner Break', duration: 60, color: '#8b7355' },
  { id: 'Phase 4', label: 'Phase 4 — Deployment', duration: 180, color: '#d4af37' },
  { id: 'Phase 5', label: 'Phase 5 — Documentation', duration: 90, color: '#d4af37' },
  { id: 'Final Pitch', label: 'Final Pitch', duration: 120, color: '#e5e4e2' }
];

function LiveClock({ activePhase, phaseStartTime, durations, labels }) {
  const [now, setNow] = useState(new Date());
  const alarmPlayedRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const phase = PHASES.find(p => p.id === activePhase) || PHASES[0];
  const label = (labels && labels[activePhase]) || phase.label;
  const durationInMins = (durations && durations[activePhase]) || phase.duration;
  
  const startTime = new Date(phaseStartTime);
  // Calculate total seconds remaining as a single integer
  const totalRemainingSecs = Math.max(0, (durationInMins * 60) - Math.floor((now - startTime) / 1000));
  
  const remainingMins = Math.floor(totalRemainingSecs / 60);
  const remainingSecs = totalRemainingSecs % 60;

  // Trigger alarm at 0:00 exactly once
  useEffect(() => {
    if (totalRemainingSecs === 0 && activePhase !== alarmPlayedRef.current) {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
      audio.volume = 1.0;
      audio.play().catch(e => console.log('Audio playback prevented by browser:', e));
      alarmPlayedRef.current = activePhase;
    }
  }, [totalRemainingSecs, activePhase]);

  return (
    <div className="live-clock">
      <div className="clock-time">{now.toLocaleTimeString('en-IN')}</div>
      <div className="phase-indicator" style={{ background: phase.color + '22', color: phase.color, border: `1px solid ${phase.color}44` }}>
        <span className="phase-dot" style={{ background: phase.color }} />
        {label} 
        <span className="timer-countdown">
          {remainingMins}:{(remainingSecs < 10 ? '0' : '')}{remainingSecs} left
        </span>
      </div>
    </div>
  );
}

function MetricCard({ value, label, color }) {
  return (
    <div className="metric-card">
      <div className="metric-val" style={color ? { color } : {}}>{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [teams, setTeams] = useState([]);
  const [log, setLog] = useState([]);
  const [activeTab, setActiveTab] = useState('teams');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [syncing, setSyncing] = useState({});
  const [syncingAll, setSyncingAll] = useState(false);
  const [serverStatus, setServerStatus] = useState(null);
  const [githubOrg, setGithubOrg] = useState('tensor26-srmiist');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [addForm, setAddForm] = useState({ name: '', track: 'Industry', members: '', repoName: '', liveUrl: '', hash: '', commitsAfterPhase1: '' });
  const [bulkCsv, setBulkCsv] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [activePhase, setActivePhase] = useState('Inauguration');
  const [phaseStartTime, setPhaseStartTime] = useState(new Date().toISOString());
  const [phaseDurations, setPhaseDurations] = useState({});
  const [phaseLabels, setPhaseLabels] = useState({});
  const [sectionMeta, setSectionMeta] = useState({
    secA: { label: 'Section A', max: 30 },
    secB: { label: 'Section B', max: 30 },
    secC: { label: 'Section C', max: 40 }
  });
  const [isJuryMode, setIsJuryMode] = useState(false);
  const [importingClassroom, setImportingClassroom] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [juryPod, setJuryPod] = useState(0); // 0 = all, 1, 2, 3...
  const [totalJuryPods, setTotalJuryPods] = useState(3);

  const fetchTeams = useCallback(async () => {
    try {
      const { data } = await API.get('/teams');
      setTeams(data.teams);
    } catch {}
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const { data } = await API.get('/log');
      setLog(data);
    } catch {}
  }, []);

  const checkHealth = useCallback(async () => {
    try {
      const { data } = await API.get('/health');
      setServerStatus('online');
      if (data.org) setGithubOrg(data.org);
    } catch {
      setServerStatus('offline');
    }
  }, []);

  const fetchPhases = useCallback(async () => {
    try {
      const { data } = await API.get('/phases');
      setActivePhase(data.activePhase);
      setPhaseStartTime(data.startTime);
      if (data.durations) setPhaseDurations(data.durations);
      if (data.labels) setPhaseLabels(data.labels);
      if (data.sectionMeta) setSectionMeta(data.sectionMeta);
    } catch {}
  }, []);

  useEffect(() => {
    checkHealth();
    fetchTeams();
    fetchLog();
    fetchPhases();
    const interval = setInterval(() => { fetchTeams(); fetchLog(); fetchPhases(); }, 10000);
    return () => clearInterval(interval);
  }, [fetchTeams, fetchLog, checkHealth, fetchPhases]);

  const updateScore = useDebounce(async (id, field, value) => {
    try {
      await API.patch(`/teams/${id}`, { [field]: value });
      fetchTeams(); fetchLog();
    } catch {}
  }, 600);

  const syncTeam = async (team) => {
    if (!team.repoName) return alert('No repo name set for this team.');
    setSyncing(s => ({ ...s, [team.id]: true }));
    try {
      await API.post('/github/sync-team', { repoName: team.repoName });
      await fetchTeams(); await fetchLog();
    } catch (e) {
      alert('Sync error: ' + (e.response?.data?.error || e.message));
    }
    setSyncing(s => ({ ...s, [team.id]: false }));
  };

  const syncAll = async () => {
    setSyncingAll(true);
    try {
      await API.post('/github/sync-all');
      setTimeout(async () => { await fetchTeams(); await fetchLog(); setSyncingAll(false); }, 5000);
    } catch (e) {
      alert('Sync all error: ' + (e.response?.data?.error || e.message));
      setSyncingAll(false);
    }
  };

  const setPhase = async (phaseId) => {
    // Check for unscored T1 teams before leaving a scoring phase
    if (activePhase === 'Checkpoint 1' || activePhase === 'Final Pitch') {
      const unscored = teams.filter(t => {
        const tier = getTier(t);
        if (tier.label === 'Tier 3') return false;
        if (activePhase === 'Checkpoint 1') return t.secA === '' || t.secB === '';
        return t.secC === '';
      });
      if (unscored.length > 0) {
        if (!window.confirm(`Warning: You have ${unscored.length} active teams with missing scores. Proceed and LOCK this phase?`)) return;
      }
    }
    try {
      await API.post('/phases/set', { phase: phaseId });
      fetchPhases();
    } catch {}
  };

  const updatePhaseDuration = async (phaseId, mins) => {
    try {
      await API.post('/phases/update-duration', { phaseId, duration: mins });
      setPhaseDurations(prev => ({ ...prev, [phaseId]: mins }));
    } catch {}
  };

  const updatePhaseLabel = async (phaseId, label) => {
    try {
      await API.post('/phases/update-duration', { phaseId, label });
      setPhaseLabels(prev => ({ ...prev, [phaseId]: label }));
    } catch {}
  };

  const updateSectionMeta = async (field, label, max) => {
    try {
      await API.post('/sections/update', { field, label, max });
      setSectionMeta(prev => ({ ...prev, [field]: { label, max } }));
    } catch {}
  };

  const importFromClassroom = async () => {
    setImportingClassroom(true);
    try {
      const { data } = await API.post('/github/import-classroom');
      alert(data.message);
      fetchTeams(); fetchLog();
    } catch (e) {
      alert('Classroom import error: ' + (e.response?.data?.error || e.message));
    }
    setImportingClassroom(false);
  };

  const addTeam = async () => {
    if (!addForm.name) return;
    try {
      await API.post('/teams', { ...addForm, members: addForm.members });
      setShowAddModal(false);
      setAddForm({ name: '', track: 'Industry', members: '', repoName: '', liveUrl: '', hash: '', commitsAfterPhase1: '' });
      fetchTeams(); fetchLog();
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      let rows = [];

      if (file.name.endsWith('.csv')) {
        // Parse CSV properly handling quoted fields with commas inside
        const parseCSVLine = (line) => {
          const result = []; let current = ''; let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            if (line[i] === '"') { inQuotes = !inQuotes; }
            else if (line[i] === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
            else { current += line[i]; }
          }
          result.push(current.trim());
          return result;
        };
        rows = bstr.trim().split('\n').map(parseCSVLine);
      } else {
        const workbook = XLSX.read(bstr, { type: 'binary' });
        const ws = workbook.Sheets[workbook.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      }

      // Find header row and map columns by name
      if (rows.length === 0) return;
      const headerRow = rows[0].map(h => String(h).toLowerCase().trim());

      // Flexible column detection by keywords
      const findCol = (keywords) => {
        const idx = headerRow.findIndex(h => keywords.some(kw => h.includes(kw)));
        return idx;
      };

      const colName    = findCol(['team name', 'team_name', 'name']);
      const colTrack   = findCol(['track']);
      const colMembers = findCol(['member']);
      const colGithub  = findCol(['github', 'git', 'repo', 'link', 'url']);
      const colLive    = findCol(['live', 'deploy', 'hosted', 'app']);

      // If no header found, fall back to raw CSV text display
      if (colName === -1) {
        // No recognized header — just show raw text for manual entry
        setBulkCsv(rows.slice(1).map(r => r.join(',')).join('\n'));
        setImportMsg(`Loaded file: ${file.name} (manual mapping mode)`);
        return;
      }

      // Convert rows (skip header) to standard format
      const dataRows = rows.slice(1);
      const teams = dataRows
        .filter(r => r.some(cell => String(cell).trim()))
        .map(r => ({
          name:    colName    >= 0 ? String(r[colName] || '').trim()   : '',
          track:   colTrack   >= 0 ? String(r[colTrack] || '').trim()  : 'Industry',
          members: colMembers >= 0 ? String(r[colMembers] || '').trim(): '',
          repoName: colGithub >= 0 ? String(r[colGithub] || '').trim() : '',
          liveUrl:  colLive   >= 0 ? String(r[colLive] || '').trim()   : '',
        }))
        .filter(t => t.name && t.repoName);

      // Show summary in textarea for user to review before importing
      const preview = teams.map(t =>
        `${t.name}, ${t.track || 'Industry'}, ${t.members}, ${t.repoName}, ${t.liveUrl}`
      ).join('\n');

      setBulkCsv(preview);
      setImportMsg(`✅ Loaded ${teams.length} teams from: ${file.name}`);
    };

    if (file.name.endsWith('.csv')) {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  const bulkImport = async () => {
    const lines = bulkCsv.trim().split('\n').filter(l => l.trim());
    const teamsList = lines.map(line => {
      const p = line.split(',').map(s => s.trim());
      
      // Smart detection: Find which column has the GitHub Link
      let detectedRepo = '';
      let membersStr = '';
      [p[2], p[3], p[4]].forEach(col => {
        if (col && (col.includes('github.com') || col.includes('git@github'))) {
          detectedRepo = col;
        } else if (col && !membersStr && !col.includes('http')) {
          membersStr = col;
        }
      });

      return { 
        name: p[0], 
        track: p[1] || 'Industry', 
        members: membersStr || p[2] || '', 
        repoName: detectedRepo || p[3] || '', 
        liveUrl: p[4] || '' 
      };
    }).filter(t => t.name);
    try {
      const { data } = await API.post('/teams/bulk', { teams: teamsList });
      setImportMsg(`${data.added} teams imported!`);
      fetchTeams(); fetchLog();
      setTimeout(() => { setBulkCsv(''); setImportMsg(''); setShowBulkModal(false); }, 2000);
    } catch (e) { alert(e.response?.data?.error || e.message); }
  };

  const removeTeam = async (id) => {
    if (!window.confirm('Remove this team?')) return;
    await API.delete(`/teams/${id}`);
    fetchTeams(); fetchLog();
  };

  const exportExcel = () => {
    window.location.href = 'http://localhost:3001/api/export/excel';
  };

  // Compute filtered/sorted teams
  const filtered = teams
    .filter((t, index) => {
      if (isJuryMode) {
        // Skip T3 in Jury Mode
        const tier = getTier(t);
        if (tier.label === 'Tier 3') return false;
        
        // Jury Assignment Logic: (index % totalPods) == (pod - 1)
        if (juryPod > 0) {
          if ((index % totalJuryPods) !== (juryPod - 1)) return false;
        }
      }
      if (filter === 'tier1') return getTier(t).label === 'Tier 1';
      if (filter === 'tier2') return getTier(t).label === 'Tier 2';
      if (filter === 'tier3') return getTier(t).label === 'Tier 3';
      if (filter === 'nolive') return !t.liveUrl;
      if (filter === 'nop1') return !t.phase1Commit;
      return true;
    })
    .filter(t => {
      const q = search.toLowerCase();
      return !q || (t.name + (t.members || []).join('') + t.track).toLowerCase().includes(q);
    })
    .filter(t => !trackFilter || t.track === trackFilter)
    .sort((a, b) => {
      if (sortBy === 'total') return calcTotal(b) - calcTotal(a);
      if (sortBy === 'commits') return (b.commitsAfterPhase1 || 0) - (a.commitsAfterPhase1 || 0);
      if (sortBy === 'secA') return (parseFloat(b.secA) || 0) - (parseFloat(a.secA) || 0);
      if (sortBy === 'secB') return (parseFloat(b.secB) || 0) - (parseFloat(a.secB) || 0);
      return a.name.localeCompare(b.name);
    });

  // Metrics
  const total = teams.length;
  const p1 = teams.filter(t => t.phase1Commit).length;
  const scored = teams.filter(t => t.secA !== '' && t.secB !== '' && t.secC !== '').length;
  const totals = teams.filter(t => calcTotal(t) > 0).map(t => calcTotal(t));
  const avg = totals.length ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length) : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <button className="menu-toggle" onClick={() => setShowSidebar(true)}>
            <div className="bar" /> <div className="bar" /> <div className="bar" />
          </button>
          <div className="logo">
            <img src="/logo.png" alt="TENSOR Logo" />
          </div>
          <div className="header-titles">
            <h1>TENSOR-26 — Evaluation System</h1>
            <p>TENSOR-26 · tensor-26-hackathon · Classroom ID: 319897</p>
          </div>
        </div>
        <div className="header-right">
          <LiveClock activePhase={activePhase} phaseStartTime={phaseStartTime} durations={phaseDurations} labels={phaseLabels} />
          
          {isJuryMode && (
            <div className="jury-pod-selector">
              <label>Assign:</label>
              <select value={juryPod} onChange={e => setJuryPod(parseInt(e.target.value))}>
                <option value={0}>All Teams</option>
                {[...Array(totalJuryPods)].map((_, i) => (
                  <option key={i+1} value={i+1}>Jury Pod {i+1}</option>
                ))}
              </select>
            </div>
          )}

          <span className={`server-dot ${serverStatus}`} title={`Backend: ${serverStatus || 'checking...'}`} />
          <div className="jury-toggle" onClick={() => setIsJuryMode(!isJuryMode)}>
            <div className={`toggle-track ${isJuryMode ? 'active' : ''}`}>
              <div className="toggle-thumb" />
            </div>
            <span>Jury Mode</span>
          </div>
          {!isJuryMode && (
            <>
              <button className="btn" onClick={() => setShowAddModal(true)}>+ Add</button>
              <button className="btn" onClick={() => setShowBulkModal(true)}>Bulk Import</button>
              <button className="btn" onClick={importFromClassroom} disabled={importingClassroom}>
                {importingClassroom ? '...' : 'Pull Classroom'}
              </button>
              <button className="btn btn-sync" onClick={syncAll} disabled={syncingAll}>
                {syncingAll ? '...' : 'Sync All'}
              </button>
              <button className="btn btn-export" onClick={exportExcel}>Export</button>
            </>
          )}
        </div>
      </header>

      {/* Metrics */}
      <div className="metrics-row">
        <MetricCard value={total} label="Total teams" />
        <MetricCard value={p1} label="Phase 1 committed" color={p1 === total && total > 0 ? '#1D9E75' : undefined} />
        <MetricCard value={total - p1} label="Missing P1 commit" color={total - p1 > 0 ? '#E24B4A' : '#1D9E75'} />
        <MetricCard value={scored} label="Fully scored" />
        <MetricCard value={avg ? avg + '/100' : '—'} label="Avg total score" />
        <MetricCard value={teams.filter(t => !t.liveUrl).length} label="No live URL" color={teams.filter(t => !t.liveUrl).length > 0 ? '#BA7517' : undefined} />
      </div>

      {/* Filter Pills */}
      <div className="filter-pills">
        {[['all', 'All teams'], ['tier1', 'Tier 1 — Deep dive'], ['tier2', 'Tier 2 — Quick review'], ['tier3', 'Tier 3 — Auto-penalised'], ['nolive', 'No live URL'], ['nop1', 'Missing Phase 1']].map(([k, label]) => (
          <button key={k} className={`pill ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{label}</button>
        ))}
      </div>

      {/* Sidebar Navigation */}
      <div className={`sidebar-overlay ${showSidebar ? 'active' : ''}`} onClick={() => setShowSidebar(false)}>
        <div className={`sidebar ${showSidebar ? 'active' : ''}`} onClick={e => e.stopPropagation()}>
          <div className="sidebar-header">
            <h3>Dashboard Menu</h3>
            <button className="sidebar-close" onClick={() => setShowSidebar(false)}>×</button>
          </div>
          <div className="sidebar-links">
            {[
              ['teams', '📋 Teams & Scoring'], 
              ['leaderboard', '🏆 Leaderboard'], 
              (!isJuryMode && ['phases', '⚙️ Phase Control']), 
              (!isJuryMode && ['log', '📜 Event Log']), 
              (!isJuryMode && ['setup', '⚡ GitHub Setup'])
            ].filter(Boolean).map(([k, label]) => (
              <button key={k} className={`sidebar-link ${activeTab === k ? 'active' : ''}`} onClick={() => { setActiveTab(k); setShowSidebar(false); }}>
                {label}
              </button>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="org-label-side">{githubOrg}</div>
            <div className="mode-status">{isJuryMode ? 'Jury Access Only' : 'Admin Access Enabled'}</div>
          </div>
        </div>
      </div>

      {/* Teams Tab */}
      {activeTab === 'teams' && (
        <div className="panel">
          <div className="search-row">
            <input className="search-input" placeholder="Search team, member, track..." value={search} onChange={e => setSearch(e.target.value)} />
            <select value={trackFilter} onChange={e => setTrackFilter(e.target.value)}>
              <option value="">All tracks</option>
              {TRACKS.map(t => <option key={t}>{t}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="name">Sort: Name</option>
              <option value="total">Sort: Total score</option>
              <option value="commits">Sort: Commits</option>
              <option value="secA">Sort: Section A</option>
              <option value="secB">Sort: Section B</option>
            </select>
            <span className="count-label">{filtered.length} / {total} teams</span>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state">
              {total === 0 ? (
                <>
                  <div className="empty-icon">⬡</div>
                  <p>No teams yet. Add teams manually or bulk import from CSV.</p>
                  <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>Add first team</button>
                </>
              ) : <p>No teams match this filter.</p>}
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Track</th>
                    <th>Phase 1</th>
                    <th>Commits ↑</th>
                    <th>Live URL</th>
                    <th>Tier</th>
                    <th>{sectionMeta.secA.label} <div className="header-max">max: {sectionMeta.secA.max}</div></th>
                    <th>{sectionMeta.secB.label} <div className="header-max">max: {sectionMeta.secB.max}</div></th>
                    <th>{sectionMeta.secC.label} <div className="header-max">max: {sectionMeta.secC.max}</div></th>
                    <th>Total</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((team, i) => {
                    const total = calcTotal(team);
                    const tier = getTier(team);
                    const isExpanded = expandedTeam === team.id;
                    return (
                      <React.Fragment key={team.id}>
                        <tr className={`team-row ${isExpanded ? 'expanded' : ''}`}>
                          <td className="mono muted">{i + 1}</td>
                          <td>
                            <div className="team-name" onClick={() => setExpandedTeam(isExpanded ? null : team.id)}>
                              {team.name}
                              <span className="expand-arrow">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                            <div className="team-members">{(team.members || []).join(', ')}</div>
                          </td>
                          <td><span className={`badge badge-track-${team.track?.toLowerCase()}`}>{team.track}</span></td>
                          <td>
                            <StatusBadge ok={team.phase1Commit} trueLabel="YES" falseLabel="MISSING" />
                            {team.phase1Time && <div className="mono tiny muted">{new Date(team.phase1Time).toLocaleTimeString('en-IN')}</div>}
                            {team.compareUrl && <a href={team.compareUrl} target="_blank" rel="noreferrer" className="diff-link">View diff ↗</a>}
                          </td>
                          <td>
                            <span className="mono">{team.commitsAfterPhase1 || 0}</span>
                            <div className="mini-bar"><div className="mini-fill" style={{ width: Math.min(100, (team.commitsAfterPhase1 || 0) * 4) + '%' }} /></div>
                          </td>
                          <td>
                            {team.liveUrl
                              ? <a href={team.liveUrl} target="_blank" rel="noreferrer" className="live-link">{team.liveUrl.replace('https://', '').substring(0, 24)}…</a>
                              : <span className="badge badge-warn">None</span>}
                          </td>
                          <td><TierBadge team={team} /></td>
                          <td>
                            <ScoreInput 
                              value={team.secA} 
                              max={sectionMeta.secA.max}
                              onChange={v => { const updated = teams.map(t => t.id === team.id ? { ...t, secA: v } : t); setTeams(updated); updateScore(team.id, 'secA', v); }}
                              disabled={activePhase !== 'Checkpoint 1'}
                            />
                          </td>
                          <td>
                            <ScoreInput 
                              value={team.secB} 
                              max={sectionMeta.secB.max}
                              onChange={v => { const updated = teams.map(t => t.id === team.id ? { ...t, secB: v } : t); setTeams(updated); updateScore(team.id, 'secB', v); }}
                              disabled={activePhase !== 'Checkpoint 1'}
                            />
                          </td>
                          <td>
                            <ScoreInput 
                              value={team.secC} 
                              max={sectionMeta.secC.max}
                              onChange={v => { const updated = teams.map(t => t.id === team.id ? { ...t, secC: v } : t); setTeams(updated); updateScore(team.id, 'secC', v); }}
                              disabled={activePhase !== 'Final Pitch'}
                            />
                          </td>
                          <td>
                            <span className={`total-score ${total >= 80 ? 'score-high' : total >= 50 ? 'score-mid' : total > 0 ? 'score-low' : ''}`}>
                              {total > 0 ? total : '—'}
                            </span>
                          </td>
                          <td>
                            <input className="notes-input" value={team.notes || ''}
                              placeholder="notes..."
                              onChange={e => { const updated = teams.map(t => t.id === team.id ? { ...t, notes: e.target.value } : t); setTeams(updated); updateScore(team.id, 'notes', e.target.value); }} />
                          </td>
                          <td className="actions-cell">
                            <button className="btn-sm" onClick={() => syncTeam(team)} disabled={syncing[team.id] || !team.repoName} title={!team.repoName ? 'No repo set' : 'Sync from GitHub'}>
                              {syncing[team.id] ? '⟳' : 'Sync'}
                            </button>
                            {team.repoUrl && <a href={team.repoUrl} target="_blank" rel="noreferrer" className="btn-sm btn-sm-link">Repo</a>}
                            <button className="btn-sm btn-sm-danger" onClick={() => removeTeam(team.id)}>×</button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="expanded-row">
                            <td colSpan="13">
                              <div className="expanded-content">
                                <div className="exp-grid">
                                  <div className="exp-section">
                                    <h4>Repository info</h4>
                                    <div className="exp-row"><span>Repo</span><a href={team.repoUrl} target="_blank" rel="noreferrer">{team.repoName || '—'}</a></div>
                                    <div className="exp-row"><span>Phase 1 Hash</span><code>{team.phase1Hash || '—'}</code></div>
                                    <div className="exp-row"><span>Total commits</span><code>{team.totalCommits || '—'}</code></div>
                                    <div className="exp-row"><span>Last synced</span><code>{team.syncedAt ? new Date(team.syncedAt).toLocaleString('en-IN') : 'Never'}</code></div>
                                    {team.compareUrl && <div className="exp-row"><span>Git diff</span><a href={team.compareUrl} target="_blank" rel="noreferrer">Open compare view ↗</a></div>}
                                  </div>
                                  <div className="exp-section">
                                    <h4>Recent commits</h4>
                                    {(team.allCommits || []).slice(0, 6).map(c => (
                                      <div key={c.sha} className="commit-item">
                                        <code className="commit-sha">{c.shortSha}</code>
                                        <span className="commit-msg">{c.message.substring(0, 60)}</span>
                                        <span className="commit-ts">{new Date(c.date).toLocaleTimeString('en-IN')}</span>
                                      </div>
                                    ))}
                                    {!team.allCommits?.length && <p className="muted small">Sync to view commits</p>}
                                  </div>
                                  <div className="exp-section">
                                    <h4>Scoring breakdown</h4>
                                    <div className="score-breakdown">
                                      <div className="sb-row"><span>Section A — Prompt Architecture</span><strong>{team.secA || '—'}/30</strong></div>
                                      <div className="sb-row"><span>Section B — Human Finetuning</span><strong>{team.secB || '—'}/30</strong></div>
                                      <div className="sb-row"><span>Section C — Final Product</span><strong>{team.secC || '—'}/40</strong></div>
                                      <div className="sb-row total-row"><span>Total</span><strong className={total >= 80 ? 'score-high' : total >= 50 ? 'score-mid' : 'score-low'}>{total || '—'}/100</strong></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Leaderboard Tab */}
      {activeTab === 'leaderboard' && (
        <div className="panel">
          <div className="leaderboard">
            {[...teams].sort((a, b) => calcTotal(b) - calcTotal(a)).filter(t => calcTotal(t) > 0).map((team, i) => {
              const total = calcTotal(team);
              return (
                <div key={team.id} className={`lb-row ${i < 3 ? 'lb-top3' : ''}`}>
                  <div className="lb-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</div>
                  <div className="lb-info">
                    <div className="lb-name">{team.name} <span className={`badge badge-track-${team.track?.toLowerCase()}`}>{team.track}</span></div>
                    <div className="lb-members">{(team.members || []).join(', ')}</div>
                    <div className="lb-scores">A: {team.secA || '—'}/30 · B: {team.secB || '—'}/30 · C: {team.secC || '—'}/40</div>
                    <div className="lb-bar"><div className="lb-fill" style={{ width: total + '%', background: i === 0 ? '#1D9E75' : i === 1 ? '#BA7517' : i === 2 ? '#D85A30' : '#378ADD' }} /></div>
                  </div>
                  <div className={`lb-total ${total >= 80 ? 'score-high' : total >= 50 ? 'score-mid' : 'score-low'}`}>{total}</div>
                </div>
              );
            })}
            {teams.filter(t => calcTotal(t) > 0).length === 0 && (
              <div className="empty-state"><p>No scored teams yet. Enter scores in the Teams tab.</p></div>
            )}
          </div>
        </div>
      )}

      {/* Phase Control Tab */}
      {activeTab === 'phases' && !isJuryMode && (
        <div className="panel setup-panel">
          <div className="setup-grid">
            <div className="setup-card full">
              <h3>Management Dashboard - Hackathon Phase Control</h3>
              <p className="muted">Select a phase to begin the countdown timer and enable specific evaluation criteria for jury members.</p>
              <div className="phase-grid">
                {PHASES.map(p => {
                  const currentDuration = phaseDurations[p.id] || p.duration;
                  const currentLabel = phaseLabels[p.id] || p.label;
                  const isActive = activePhase === p.id;
                  return (
                    <div key={p.id} className={`phase-card ${isActive ? 'active' : ''}`}>
                      <input 
                        className="phase-label-input" 
                        value={currentLabel} 
                        onChange={e => updatePhaseLabel(p.id, e.target.value)}
                      />
                      <div className="phase-card-edit">
                        <input 
                          type="number" 
                          value={currentDuration} 
                          onChange={e => updatePhaseDuration(p.id, parseInt(e.target.value) || 0)}
                          className="phase-duration-input"
                        /> 
                        <span>mins</span>
                      </div>
                      <button className={`btn-phase-start ${isActive ? 'active' : ''}`} onClick={() => setPhase(p.id)}>
                        {isActive ? '⚡ Running' : 'Start Phase'}
                      </button>
                      {isActive && <div className="phase-active-tag">Active</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="setup-card full" style={{ marginTop: '20px' }}>
              <h3>Evaluation Criteria & Max Points</h3>
              <p className="muted">Customize the names and scoring limits for the three main evaluation sections.</p>
              <div className="setup-grid">
                {['secA', 'secB', 'secC'].map(field => (
                  <div key={field} className="setup-card" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="form-group full">
                      <label>Label</label>
                      <input 
                        value={sectionMeta[field].label} 
                        onChange={e => updateSectionMeta(field, e.target.value, sectionMeta[field].max)} 
                      />
                    </div>
                    <div className="form-group full">
                      <label>Max points</label>
                      <input 
                        type="number" 
                        value={sectionMeta[field].max} 
                        onChange={e => updateSectionMeta(field, sectionMeta[field].label, e.target.value)} 
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Log Tab */}
      {activeTab === 'log' && (
        <div className="panel">
          <div className="log-list">
            {log.length === 0 && <div className="empty-state"><p>No events logged yet.</p></div>}
            {log.map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-ts">{entry.ts}</span>
                <span className={`log-type log-type-${entry.type}`}>{entry.type}</span>
                <span className="log-msg">{entry.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GitHub Setup Tab */}
      {activeTab === 'setup' && (
        <div className="panel setup-panel">
          <div className="setup-grid">
            <div className="setup-card">
              <h3>Backend status</h3>
              <div className="setup-row"><span>Server</span><span className={`status-dot ${serverStatus}`}>{serverStatus || 'checking...'}</span></div>
              <div className="setup-row"><span>GitHub Org</span><code>{githubOrg}</code></div>
              <div className="setup-row"><span>Classroom ID</span><code>319897</code></div>
              <div className="setup-row"><span>Repo prefix</span><code>tensor-26-hackathon</code></div>
              <div className="setup-row"><span>Assignment</span><a href="https://classroom.github.com/classrooms/273971823-tensor-26-classroom-fdc5c0/assignments/tensor-26-hackathon" target="_blank" rel="noreferrer" style={{fontSize:'11px'}}>Open classroom ↗</a></div>
              <div className="setup-row"><span>Teams loaded</span><code>{teams.length}</code></div>
              <button className="btn" style={{ marginTop: 12 }} onClick={checkHealth}>Refresh status</button>
            </div>
            <div className="setup-card">
              <h3>GitHub token setup</h3>
              <p className="setup-desc">Create a fine-grained personal access token at <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">github.com/settings/tokens</a></p>
              <p className="setup-desc">Required permissions: <code>repo</code>, <code>read:org</code>, <code>read:user</code></p>
              <p className="setup-desc">Paste it into <code>backend/.env</code> as <code>GITHUB_TOKEN=...</code></p>
            </div>
            <div className="setup-card">
              <h3>.env configuration</h3>
              <pre className="env-preview">{`GITHUB_TOKEN=ghp_xxxxxxxxxxxx
GITHUB_ORG=tensor26-srmiist
GITHUB_CLASSROOM_ID=your_id
PORT=3001
PHASE1_COMMIT_MESSAGE=feat: Initial AI Generation`}</pre>
            </div>
            <div className="setup-card">
              <h3>API endpoints</h3>
              {[
                ['GET', '/api/health', 'Server health check'],
                ['GET', '/api/github/org/repos', 'List all org repos'],
                ['POST', '/api/github/sync-team', 'Sync one team from GitHub'],
                ['POST', '/api/github/sync-all', 'Sync all teams (background)'],
                ['GET', '/api/teams', 'Get all teams + scores'],
                ['POST', '/api/teams/bulk', 'Bulk import teams'],
                ['PATCH', '/api/teams/:id', 'Update score/notes'],
                ['GET', '/api/export/excel', 'Download Excel report'],
              ].map(([m, p, d]) => (
                <div key={p} className="api-row">
                  <span className={`method method-${m.toLowerCase()}`}>{m}</span>
                  <code>{p}</code>
                  <span className="api-desc">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Add Team Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add team</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>Team name *</label>
                <input value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Team Alpha" />
              </div>
              <div className="form-group">
                <label>Track</label>
                <select value={addForm.track} onChange={e => setAddForm({ ...addForm, track: e.target.value })}>
                  {TRACKS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group full">
                <label>Members (comma separated)</label>
                <input value={addForm.members} onChange={e => setAddForm({ ...addForm, members: e.target.value })} placeholder="Ravi, Priya, Karthik, Meena" />
              </div>
              <div className="form-group">
                <label>GitHub repo name</label>
                <input value={addForm.repoName} onChange={e => setAddForm({ ...addForm, repoName: e.target.value })} placeholder="tensor26-teamalpha" className="mono" />
              </div>
              <div className="form-group">
                <label>Phase 1 commit hash</label>
                <input value={addForm.hash} onChange={e => setAddForm({ ...addForm, hash: e.target.value })} placeholder="a3f9c12" className="mono" />
              </div>
              <div className="form-group">
                <label>Commits after Phase 1</label>
                <input type="number" value={addForm.commitsAfterPhase1} onChange={e => setAddForm({ ...addForm, commitsAfterPhase1: e.target.value })} placeholder="0" />
              </div>
              <div className="form-group full">
                <label>Live deployment URL</label>
                <input value={addForm.liveUrl} onChange={e => setAddForm({ ...addForm, liveUrl: e.target.value })} placeholder="https://teamalpha.vercel.app" />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addTeam}>Add team</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Bulk import teams</h2>
              <button className="modal-close" onClick={() => setShowBulkModal(false)}>×</button>
            </div>
            <p className="form-hint">Format (one per line): <code>Team Name, Track, Members (A;B;C), GitHub Link, Live URL</code></p>
            <textarea className="bulk-textarea" value={bulkCsv} onChange={e => setBulkCsv(e.target.value)}
              placeholder={`Team Alpha, Industry, Ravi; Priya; Karthik, https://github.com/ravi/ext-repo, https://alpha.vercel.app\nTeam Beta, Student, Sam; Jai, https://github.com/sam/beta-project,`} />
            {importMsg && <p className="import-msg">{importMsg}</p>}
            <div className="modal-footer">
              <button className="btn" onClick={() => setShowBulkModal(false)}>Cancel</button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn" onClick={() => fileInputRef.current.click()}>Upload File</button>
                <input type="file" ref={fileInputRef} hidden accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
                <button className="btn btn-primary" onClick={bulkImport}>Import teams</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
