/* cccenter — MLB picks tracker dashboard
   Reads picks_log.csv (committed alongside this file) and renders:
   - header daily summary
   - today's picks grouped by prop_type
   - most recent settled slate (was "yesterday")
   - cumulative stats (4 cards)
   - collapsible history by date
*/

const UNIT_DOLLARS = 25;
const CSV_URL = 'picks_log.csv?cb=' + Date.now();

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else { field += c; }
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter(r => r.length === header.length).map(r => {
    const o = {};
    header.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

const fmtPrice = p => {
  const n = parseInt(p, 10);
  if (isNaN(n)) return p || '';
  return n > 0 ? '+' + n : '' + n;
};
const fmtUnits = u => {
  const n = parseFloat(u);
  if (isNaN(n)) return '';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + 'u';
};
const fmtDollars = d => {
  const n = parseFloat(d);
  if (isNaN(n)) return '';
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
};
const fmtDate = ymd => {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  return dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
// Real today's date in America/New_York as YYYY-MM-DD.
// MLB days are ET-based, and the picks log is keyed on game date (ET).
function todayInET() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return y + '-' + m + '-' + d;
}
// Days between two YYYY-MM-DD strings (UTC math, no DST drift since we treat both as same TZ).
function daysBetween(ymdA, ymdB) {
  const [ay, am, ad] = ymdA.split('-').map(Number);
  const [by, bm, bd] = ymdB.split('-').map(Number);
  const a = Date.UTC(ay, am-1, ad);
  const b = Date.UTC(by, bm-1, bd);
  return Math.round((a - b) / 86400000);
}
function staleLabel(latestPickDate, today) {
  const diff = daysBetween(today, latestPickDate);
  if (diff <= 0) return '';
  if (diff === 1) return '1 day ago';
  return diff + ' days ago';
}
const propTypeMeta = {
  'HR_O0.5': { emoji: '⚾', label: 'Home Runs' },
  'TB_O1.5': { emoji: '📊', label: 'Total Bases Over 1.5' },
  'TB_O2.5': { emoji: '📊', label: 'Total Bases Over 2.5' },
  'HRR_O0.5': { emoji: '🎯', label: 'H+R+RBI Over 0.5' },
  'HRR_O1.5': { emoji: '🎯', label: 'H+R+RBI Over 1.5' },
  'HRR_O2.5': { emoji: '🎯', label: 'H+R+RBI Over 2.5' },
};
const propMeta = pt => propTypeMeta[pt] || { emoji: '🏷', label: pt };
const URGENCY_RE = /\b\d{1,2}:\d{2}\s*(AM|PM)?\s*ET\b/i;

function render(picks) {
  const loadedAt = document.getElementById('loaded-at');
  if (loadedAt) loadedAt.textContent = new Date().toLocaleString();
  if (!picks.length) {
    document.querySelector('.header-title').textContent = 'No picks yet';
    document.querySelector('.header-meta').textContent = 'Waiting for first day of data.';
    return;
  }
  const today = todayInET();
  const dates = [...new Set(picks.map(p => p.pick_date))].filter(Boolean).sort().reverse();
  const latestPickDate = dates[0];
  const todayPicks = picks.filter(p => p.pick_date === today);
  // If today has picks, "yesterday's results" = the slate before today.
  // If today has no picks, "most recent slate" = latestPickDate, and the prior-day card = the slate before that.
  let priorSlateDate;
  if (todayPicks.length > 0) {
    priorSlateDate = dates.find(d => d < today);
  } else {
    priorSlateDate = dates.find(d => d < latestPickDate);
  }
  const priorSlatePicks = priorSlateDate ? picks.filter(p => p.pick_date === priorSlateDate) : [];
  renderHeader(today, latestPickDate, todayPicks);
  renderToday(today, latestPickDate, todayPicks, picks);
  renderPriorSlate(priorSlateDate, priorSlatePicks);
  renderCumulative(picks);
  renderHistory(picks, today, latestPickDate);
}

function renderHeader(today, latestPickDate, todayPicks) {
  const titleEl = document.querySelector('.header-title');
  const metaEl = document.querySelector('.header-meta');
  if (todayPicks.length > 0) {
    titleEl.textContent = fmtDate(today);
    const totalUnits = todayPicks.reduce((s, p) => s + (parseFloat(p.stake_units) || 0), 0);
    const totalDollars = totalUnits * UNIT_DOLLARS;
    const cap = (totalUnits / 10 * 100).toFixed(0);
    metaEl.textContent =
      todayPicks.length + ' live picks · ' + totalUnits.toFixed(2) + 'u · $' + totalDollars.toFixed(2) + ' · ' + cap + '% of daily cap';
  } else {
    titleEl.textContent = fmtDate(today);
    const stale = staleLabel(latestPickDate, today);
    metaEl.textContent = 'No picks logged for today yet. Latest slate: ' + fmtDate(latestPickDate) + (stale ? ' (' + stale + ')' : '') + '.';
  }
}

function renderToday(today, latestPickDate, todayPicks, allPicks) {
  const root = document.getElementById('today');
  root.innerHTML = '';
  if (todayPicks.length > 0) {
    renderPicksGroup(root, todayPicks);
    return;
  }
  // No picks for today — show empty state, plus the most recent slate as a fallback
  // so the dashboard isn't blank.
  const stale = staleLabel(latestPickDate, today);
  const empty = document.createElement('section');
  empty.innerHTML = '<div class="section-head"><h2>Today</h2></div>' +
    '<div class="empty">No picks for ' + fmtDate(today) + ' yet. Run <code>pick today</code> when ready.</div>';
  root.appendChild(empty);
  const recent = allPicks.filter(p => p.pick_date === latestPickDate);
  if (recent.length) {
    const sec = document.createElement('section');
    sec.innerHTML = '<div class="section-head"><h2>📋 Most recent slate — ' + fmtDate(latestPickDate) +
      (stale ? ' <span class="meta">(' + stale + ')</span>' : '') + '</h2></div>';
    root.appendChild(sec);
    renderPicksGroup(root, recent);
  }
}

function renderPicksGroup(root, picks) {
  const groups = {};
  for (const p of picks) {
    if (!groups[p.prop_type]) groups[p.prop_type] = [];
    groups[p.prop_type].push(p);
  }
  for (const pt of Object.keys(groups)) {
    const list = groups[pt];
    const meta = propMeta(pt);
    const totalU = list.reduce((s, p) => s + (parseFloat(p.stake_units) || 0), 0);
    const sec = document.createElement('section');
    sec.innerHTML = '<div class="section-head"><h2>' + meta.emoji + ' ' + meta.label + '</h2><span class="meta">(' + list.length + ' · ' + totalU.toFixed(2) + 'u)</span></div>';
    const tbl = document.createElement('table');
    tbl.className = 'picks';
    for (const p of list) {
      const price = parseInt(p.open_price, 10);
      const priceClass = price > 0 ? 'plus' : 'minus';
      const tr = document.createElement('tr');
      tr.className = 'row';
      tr.innerHTML =
        '<td class="player">' + escapeHtml(p.player_name) + '<span class="team">(' + escapeHtml(p.team) + ')</span></td>' +
        '<td class="book">' + escapeHtml(p.book) + '</td>' +
        '<td class="price ' + priceClass + '">' + fmtPrice(p.open_price) + '</td>' +
        '<td class="stake">' + parseFloat(p.stake_units).toFixed(2) + 'u</td>';
      tbl.appendChild(tr);
      if (p.notes && p.notes.trim()) {
        const isUrgent = URGENCY_RE.test(p.notes);
        const noteTr = document.createElement('tr');
        if (isUrgent) {
          noteTr.className = 'flag';
          noteTr.innerHTML = '<td colspan="4">⏰ ' + escapeHtml(p.notes) + '</td>';
        } else {
          noteTr.innerHTML = '<td colspan="4" style="padding-top:0;padding-bottom:10px;color:var(--ink-3);font-size:12px;font-style:italic;">' + escapeHtml(p.notes) + '</td>';
        }
        tbl.appendChild(noteTr);
      }
    }
    sec.appendChild(tbl);
    root.appendChild(sec);
  }
}

function renderPriorSlate(date, picks) {
  const root = document.getElementById('yesterday');
  root.innerHTML = '';
  if (!date || !picks.length) {
    root.innerHTML = '<div class="section-head"><h2>📈 Prior slate</h2></div><div class="empty">No prior day to settle.</div>';
    return;
  }
  const settled = picks.filter(p => p.result && p.result !== '');
  const settledNonVoid = settled.filter(p => p.result !== 'Void');
  const wins = settled.filter(p => p.result === 'W').length;
  const losses = settled.filter(p => p.result === 'L').length;
  const pushes = settled.filter(p => p.result === 'Push').length;
  const voids = settled.filter(p => p.result === 'Void').length;
  const stakeAtRisk = settledNonVoid.reduce((s, p) => s + (parseFloat(p.stake_units) || 0), 0);
  const netUnits = settled.reduce((s, p) => s + (parseFloat(p.payout_units) || 0), 0);
  const netDollars = netUnits * UNIT_DOLLARS;
  const roi = stakeAtRisk > 0 ? (netUnits / stakeAtRisk) * 100 : 0;
  const clvVals = settled.map(p => parseFloat(p.clv_cents)).filter(v => !isNaN(v));
  const avgClv = clvVals.length ? (clvVals.reduce((a, b) => a + b, 0) / clvVals.length) : null;

  const cardClass = netUnits >= 0 ? 'yesterday-card' : 'yesterday-card negative';
  let html = '<div class="section-head"><h2>📈 Prior slate — ' + fmtDate(date) + '</h2></div>';
  if (settled.length === 0) {
    html += '<div class="empty">' + picks.length + ' picks logged but not yet settled.</div>';
    root.innerHTML = html;
    return;
  }
  html += '<div class="' + cardClass + '">';
  html += '<div class="yesterday-headline">' + fmtUnits(netUnits) + ' · ' + fmtDollars(netDollars) + ' · ROI ' + (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%</div>';
  html += '<div class="yesterday-sub">' + wins + 'W · ' + losses + 'L';
  if (pushes) html += ' · ' + pushes + ' Push';
  if (voids) html += ' · ' + voids + ' Void';
  if (avgClv !== null) html += ' · Avg CLV ' + (avgClv >= 0 ? '+' : '') + avgClv.toFixed(0) + ' bp';
  html += '</div></div>';

  html += '<div class="settled-list">';
  for (const p of settled) {
    const pu = parseFloat(p.payout_units) || 0;
    const cls = pu > 0 ? 'plus' : (pu < 0 ? 'minus' : '');
    html += '<div class="settled-row">' +
      '<div class="lhs"><span class="badge ' + p.result + '">' + p.result + '</span> ' + escapeHtml(p.player_name) + ' ' + escapeHtml(propMeta(p.prop_type).label) + '</div>' +
      '<div class="units ' + cls + '">' + fmtUnits(pu) + '</div>' +
      '</div>';
  }
  html += '</div>';
  root.innerHTML = html;
}

function renderCumulative(picks) {
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = '';
  const settled = picks.filter(p => p.result && p.result !== '' && p.result !== 'Void');
  const wins = settled.filter(p => p.result === 'W').length;
  const stakeAtRisk = settled.reduce((s, p) => s + (parseFloat(p.stake_units) || 0), 0);
  const netUnits = settled.reduce((s, p) => s + (parseFloat(p.payout_units) || 0), 0);
  const roi = stakeAtRisk > 0 ? (netUnits / stakeAtRisk) * 100 : 0;
  const hitRate = settled.length ? (wins / settled.length) * 100 : 0;
  const clvVals = settled.map(p => parseFloat(p.clv_cents)).filter(v => !isNaN(v));
  const avgClv = clvVals.length ? (clvVals.reduce((a, b) => a + b, 0) / clvVals.length) : null;

  const cards = [
    { label: 'Net Units', value: fmtUnits(netUnits), cls: netUnits >= 0 ? 'plus' : 'minus', sub: fmtDollars(netUnits * UNIT_DOLLARS) },
    { label: 'ROI', value: (roi >= 0 ? '+' : '') + roi.toFixed(2) + '%', cls: roi >= 0 ? 'plus' : 'minus', sub: 'n=' + settled.length + ' settled' },
    { label: 'Hit Rate', value: hitRate.toFixed(1) + '%', cls: '', sub: wins + 'W / ' + (settled.length - wins) + 'L' },
    { label: 'Avg CLV', value: avgClv === null ? '—' : ((avgClv >= 0 ? '+' : '') + avgClv.toFixed(0) + ' bp'), cls: avgClv === null ? '' : (avgClv >= 0 ? 'plus' : 'minus'), sub: clvVals.length + ' tracked' },
  ];
  for (const c of cards) {
    const div = document.createElement('div');
    div.className = 'stat-card';
    div.innerHTML = '<div class="stat-label">' + c.label + '</div><div class="stat-value ' + c.cls + '">' + c.value + '</div><div class="stat-sub">' + c.sub + '</div>';
    grid.appendChild(div);
  }
}

function renderHistory(picks, today, latestPickDate) {
  const root = document.getElementById('history-list');
  root.innerHTML = '';
  // Exclude both today and (if today is empty) the latest pick date already shown above.
  const hide = new Set([today]);
  const hasToday = picks.some(p => p.pick_date === today);
  if (!hasToday) hide.add(latestPickDate);
  const dates = [...new Set(picks.map(p => p.pick_date))].filter(d => d && !hide.has(d)).sort().reverse();
  if (!dates.length) {
    root.innerHTML = '<div class="empty">No history yet.</div>';
    return;
  }
  for (const d of dates) {
    const dayPicks = picks.filter(p => p.pick_date === d);
    const settled = dayPicks.filter(p => p.result && p.result !== '');
    const net = settled.reduce((s, p) => s + (parseFloat(p.payout_units) || 0), 0);
    const wins = settled.filter(p => p.result === 'W').length;
    const losses = settled.filter(p => p.result === 'L').length;
    const cls = net >= 0 ? 'plus' : 'minus';
    const det = document.createElement('details');
    det.className = 'history-day';
    let inner = '<summary><div><strong>' + fmtDate(d) + '</strong></div><div class="day-stats"><span>' + dayPicks.length + ' picks</span><span>' + wins + 'W · ' + losses + 'L</span><span class="units ' + cls + '">' + fmtUnits(net) + '</span></div></summary>';
    inner += '<div class="day-body">';
    inner += '<table class="picks">';
    for (const p of dayPicks) {
      const pu = parseFloat(p.payout_units);
      const r = p.result || '—';
      const rCls = r === 'W' ? 'badge W' : r === 'L' ? 'badge L' : 'badge Push';
      const puStr = isNaN(pu) ? '<span style="color:var(--ink-3)">pending</span>' : fmtUnits(pu);
      const puCls = isNaN(pu) ? '' : (pu >= 0 ? 'plus' : 'minus');
      inner += '<tr class="row"><td class="player">' + escapeHtml(p.player_name) + ' <span class="team">(' + escapeHtml(propMeta(p.prop_type).label) + ')</span></td>' +
        '<td class="book">' + escapeHtml(p.book) + '</td>' +
        '<td class="price ' + (parseInt(p.open_price)>0?'plus':'minus') + '">' + fmtPrice(p.open_price) + '</td>' +
        '<td class="stake"><span class="' + rCls + '" style="margin-right:6px">' + (r === '—' ? '·' : r) + '</span><span class="' + puCls + '">' + puStr + '</span></td></tr>';
    }
    inner += '</table></div>';
    det.innerHTML = inner;
    root.appendChild(det);
  }
}

function escapeHtml(s) {
  if (s === undefined || s === null) return '';
  return ('' + s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

fetch(CSV_URL)
  .then(r => {
    if (!r.ok) throw new Error('CSV fetch failed: ' + r.status);
    return r.text();
  })
  .then(text => {
    const picks = parseCSV(text);
    render(picks);
  })
  .catch(err => {
    document.querySelector('.header-title').textContent = 'Error loading picks';
    document.querySelector('.header-meta').textContent = err.message;
    console.error(err);
  });
