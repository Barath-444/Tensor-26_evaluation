require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const githubRoutes = require('./routes/github');
const teamsRoutes = require('./routes/teams');
const exportRoutes = require('./routes/export');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(express.json());

// ─── Persistence Logic ────────────────────────────────────────────────────────

// Initial state
global.teamsStore = {};
global.eventLog = [];
global.activePhase = 'Inauguration';
global.phaseStartTime = new Date().toISOString();
global.phaseDurations = {
  'Inauguration': 60, 'Phase 1': 180, 'Lunch': 60, 'Phase 2': 300, 
  'Checkpoint 1': 90, 'Phase 3': 420, 'Dinner': 60, 'Phase 4': 180, 
  'Phase 5': 90, 'Final Pitch': 120
};
global.phaseLabels = {
  'Inauguration': 'Inauguration', 'Phase 1': 'Phase 1 — AI Generation', 'Lunch': 'Lunch Break', 
  'Phase 2': 'Phase 2 — Co-Curation', 'Checkpoint 1': 'Checkpoint 1 Evaluation', 
  'Phase 3': 'Phase 3 — Integration', 'Dinner': 'Dinner Break', 
  'Phase 4': 'Phase 4 — Deployment', 'Phase 5': 'Phase 5 — Documentation', 
  'Final Pitch': 'Final Pitch'
};
global.sectionMeta = {
  'secA': { label: 'Section A — Prompt Architecture', max: 30 },
  'secB': { label: 'Section B — Human Finetuning', max: 30 },
  'secC': { label: 'Section C — Final Product', max: 40 }
};

// Persistence functions
global.saveData = () => {
  try {
    const data = {
      teamsStore: global.teamsStore,
      eventLog: global.eventLog,
      activePhase: global.activePhase,
      phaseStartTime: global.phaseStartTime,
      phaseDurations: global.phaseDurations,
      phaseLabels: global.phaseLabels,
      sectionMeta: global.sectionMeta
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Save error:', err);
  }
};

global.loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      global.teamsStore = data.teamsStore || {};
      global.eventLog = data.eventLog || [];
      global.activePhase = data.activePhase || 'Inauguration';
      global.phaseStartTime = data.phaseStartTime || new Date().toISOString();
      if (data.phaseDurations) global.phaseDurations = data.phaseDurations;
      if (data.phaseLabels) global.phaseLabels = data.phaseLabels;
      if (data.sectionMeta) global.sectionMeta = data.sectionMeta;
      console.log('✓ Persistence: Data loaded from', DATA_FILE);
    }
  } catch (err) {
    console.warn('Load warning (starting fresh):', err.message);
  }
};

// Load on start
global.loadData();

function addLog(msg, type = 'info') {
  global.eventLog.unshift({
    ts: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    fullTs: new Date().toISOString(),
    msg,
    type
  });
  if (global.eventLog.length > 500) global.eventLog = global.eventLog.slice(0, 500);
  global.saveData(); // Save on log
}
global.addLog = addLog;

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use('/api/github', githubRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/export', exportRoutes);

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    teamsCount: Object.keys(global.teamsStore).length,
    org: process.env.GITHUB_ORG
  });
});

app.get('/api/log', (req, res) => {
  res.json(global.eventLog.slice(0, 100));
});

// Phase Management
app.get('/api/phases', (req, res) => {
  res.json({ 
    activePhase: global.activePhase, 
    startTime: global.phaseStartTime,
    durations: global.phaseDurations,
    labels: global.phaseLabels,
    sectionMeta: global.sectionMeta
  });
});

app.post('/api/phases/set', (req, res) => {
  const { phase } = req.body;
  global.activePhase = phase;
  global.phaseStartTime = new Date().toISOString();
  global.addLog(`Phase changed to: ${phase}`, 'system');
  global.saveData();
  res.json({ success: true, phase });
});

app.post('/api/phases/update-duration', (req, res) => {
  const { phaseId, duration, label } = req.body;
  if (global.phaseDurations[phaseId] !== undefined) {
    if (duration !== undefined) global.phaseDurations[phaseId] = parseInt(duration) || 0;
    if (label !== undefined) global.phaseLabels[phaseId] = label;
    global.saveData();
    res.json({ success: true, durations: global.phaseDurations, labels: global.phaseLabels });
  } else {
    res.status(404).json({ error: 'Phase not found' });
  }
});

app.post('/api/sections/update', (req, res) => {
  const { field, label, max } = req.body;
  if (global.sectionMeta[field]) {
    if (label !== undefined) global.sectionMeta[field].label = label;
    if (max !== undefined) global.sectionMeta[field].max = parseInt(max) || 0;
    global.saveData();
    res.json({ success: true, sectionMeta: global.sectionMeta });
  } else {
    res.status(404).json({ error: 'Section not found' });
  }
});

app.listen(PORT, () => {
  console.log(`TENSOR26 Evaluator backend running on port ${PORT}`);
  addLog(`Server started on port ${PORT}`, 'system');
});

