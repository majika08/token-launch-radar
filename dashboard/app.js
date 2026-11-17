// Token Launch Radar dashboard. Renders window.RADAR, the dataset main.ts writes beside this
// page (../data.js): the ranked board with every row's model breakdown and farm plan, the fitted
// calibration, and the launched reference set. No fetch, no network: every byte shown is in
// data.js. Filters and sorts are client-side; a row opens its detail view; the location hash
// deep-links a row (#row=<slug>) or a filter (#cat=<category>), which is also how the entry's
// screenshots are framed.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { q: '', cat: '', chain: '', sort: 'implied', wl: false, selected: null };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + Number(n).toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3); }

  // ---- state from the hash -------------------------------------------------
  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      var k = kv[0];
      var v = decodeURIComponent(kv.slice(1).join('=') || '');
      if (k === 'row' && bySlug[v]) state.selected = v;
      if (k === 'cat') state.cat = v;
      if (k === 'chain') state.chain = v;
      if (k === 'q') state.q = v;
      if (k === 'wl') state.wl = v === '1';
    });
  }

  // ---- masthead ------------------------------------------------------------
  function renderStats() {
    var top = rows[0];
    $('mast-stats').innerHTML =
      stat(DATA.board_size, 'candidates ranked') +
      stat(DATA.watchlist_size, 'watchlist covered') +
      stat(DATA.excluded_size, 'products set aside') +
      stat(top ? fmtUsd(top.implied_value_usd) : 'n/a', 'top implied value');
    function stat(v, label) { return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>'; }
  }

  // ---- board table -----------------------------------------------------------
  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && (r.category || '') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var by = {
      implied: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.model.age_days === null ? -1 : b.model.age_days) - (a.model.age_days === null ? -1 : a.model.age_days); },
      name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
    };
    return out.sort(by[state.sort] || by.implied);
  }

  function renderBoard() {
    var vis = visibleRows();
    $('count').innerHTML = vis.length + ' of ' + rows.length + ' shown' +
      (state.cat ? ' &nbsp;<span class="chip">category: ' + esc(state.cat) + '</span>' : '') +
      (state.chain ? ' &nbsp;<span class="chip">chain: ' + esc(state.chain) + '</span>' : '');
    $('rows').innerHTML = vis.map(function (r) {
      var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'uncategorised') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.model.age_days) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b></td></tr>';
    }).join('');
    var trs = $('rows').querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].addEventListener('click', function () { select(this.getAttribute('data-slug'), true); });
    }
  }

  // ---- detail ------------------------------------------------------------------
  function select(slug, pushHash) {
    state.selected = slug;
    if (pushHash) {
      var target = slug
        ? '#row=' + encodeURIComponent(slug)
        : window.location.pathname + window.location.search;
      try { history.replaceState(null, '', target); } catch (e) { /* file URLs may refuse */ }
    }
    renderDetail();
    renderBoard();
    if (slug) $('detail-panel').scrollIntoView({ block: 'nearest' });
  }

  function cell(value, label, hero) {
    return '<div class="cell' + (hero ? ' hero' : '') + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  function renderDetail() {
    var panel = $('detail-panel');
    var r = state.selected ? bySlug[state.selected] : null;
    if (!r) { panel.hidden = true; return; }
    panel.hidden = false;
    var m = r.model;
    $('detail').innerHTML =
      '<div class="detail-head"><div><h2>#' + r.rank + ' ' + esc(r.name) +
      (r.watchlist ? '<span class="badge">watchlist</span>' : '') + '</h2>' +
      '<div class="meta">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'uncategorised') + ' &middot; ' +
      esc(r.chains.join(', ') || 'no chains recorded') + ' &middot; records no token yet</div></div>' +
      '<button class="close-btn" id="close-detail" type="button">Close</button></div>' +
      '<div class="breakdown">' +
      cell(fmtUsd(r.implied_value_usd), 'implied value at launch', true) +
      cell(fmtUsd(r.tvl_usd), 'TVL') +
      cell(fmtMult(m.category_multiple), 'category multiple') +
      cell(fmtUsd(m.comps_value_usd), 'comps read') +
      cell(fmtUsd(m.curve_value_usd), 'size-curve read') +
      cell(fmtUsd(m.blended_base_usd), 'blended base') +
      cell(fmtPct(m.growth_pct) + ' → ' + fmtMult(m.growth_multiplier), '7d growth adj.') +
      cell(fmtMult(m.maturity_multiplier), 'maturity adj.') +
      cell(r.listed_at ? r.listed_at + ' (' + fmtAge(m.age_days) + ')' : 'unknown', 'tracked since') +
      '</div>' +
      '<h3>Farm plan</h3><ol class="farm">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol>';
    $('close-detail').addEventListener('click', function () { select(null, true); });
  }

  // ---- model section --------------------------------------------------------------
  function renderModel() {
    var c = DATA.calibration;
    var mc = DATA.model_constants;
    $('model-version').textContent = 'model ' + DATA.model_version;
    var cats = Object.keys(c.category_multiples).map(function (k) {
      return { name: k, multiple: c.category_multiples[k].multiple, n: c.category_multiples[k].sample };
    }).sort(function (a, b) { return b.multiple - a.multiple; });
    var catRows = cats.map(function (x) {
      return '<tr><td>' + esc(x.name) + '</td><td class="num">' + fmtMult(x.multiple) + '</td><td class="num">' + x.n + '</td></tr>';
    }).join('');
    $('model-body').innerHTML =
      '<p class="sub">Every figure below was fitted from this snapshot itself when the program ran; ' +
      'no protocol is priced by name and no constant comes from outside the data.</p>' +
      '<div class="model-grid">' +
      '<div class="model-card"><h3>Who is on the board</h3><p>Every protocol the snapshot records no token for is a candidate. ' +
      'Wrapped, staked, bridged and exchange products of tokens that already trade are set aside (' + DATA.excluded_size + ' of them): ' +
      'at or above the $' + (DATA.floor_usd / 1e6) + 'M floor the snapshot\'s own watchlist is the authority, below it the same product test is re-run on the recorded fields. ' +
      '<b>' + DATA.board_size + ' candidates remain, all ' + DATA.watchlist_size + ' watchlist protocols among them.</b></p></div>' +
      '<div class="model-card"><h3>Two reads of the launched market</h3><p>Fitted on the <b>' + c.sample_size + ' launched protocols</b> with a recorded market cap: ' +
      'a category read (TVL x the category\'s median market-cap/TVL, shrunk toward the global median of <b>' + fmtMult(c.global_multiple) + '</b>) and a size curve, ' +
      '<b>log(mcap) = ' + c.fit_intercept.toFixed(2) + ' + ' + c.fit_slope.toFixed(2) + ' x log(TVL)</b>. The board blends them ' +
      Math.round(c.blend_comps_weight * 100) + '/' + Math.round((1 - c.blend_comps_weight) * 100) + ' in log space, the weights that best reproduced the launched set itself.</p></div>' +
      '<div class="model-card"><h3>Two stated adjustments</h3><p><b>Growth:</b> the 7-day TVL change, clamped to [' + mc.growth_floor_pct + '%, +' + mc.growth_cap_pct + '%], ' +
      'moves a value by up to x' + (1 + mc.growth_cap_pct / 100 * mc.growth_weight).toFixed(2) + '. <b>Maturity:</b> a protocol tracked longer without launching earns up to x' +
      (mc.maturity_base + mc.maturity_span).toFixed(2) + ' over ' + (mc.maturity_days / 365) + ' years; an unknown listing date takes the candidates\' median age. ' +
      'Each row\'s detail view shows its own full breakdown.</p></div>' +
      '</div>' +
      '<h3 style="margin:14px 0 6px">Category multiples (launched protocols, shrunk to the global median)</h3>' +
      '<div class="table-wrap"><table class="mini"><thead><tr><th>Category</th><th class="num">mcap / TVL</th><th class="num">Launched n</th></tr></thead>' +
      '<tbody>' + catRows + '</tbody></table></div>';
  }

  // ---- launched reference ---------------------------------------------------------
  function renderLive() {
    $('live-rows').innerHTML = DATA.live.map(function (r) {
      var cls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      return '<tr><td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'uncategorised') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.mcap_usd) + '</b></td>' +
        '<td class="num ' + cls + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  // ---- controls ----------------------------------------------------------------------
  function fillSelects() {
    var cats = {};
    var chains = {};
    rows.forEach(function (r) {
      if (r.category) cats[r.category] = true;
      r.chains.forEach(function (c) { chains[c] = true; });
    });
    $('cat').innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    $('chain').innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    $('q').value = state.q;
    $('wl').checked = state.wl;
  }

  function bind() {
    $('q').addEventListener('input', function () { state.q = this.value; renderBoard(); });
    $('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
    $('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
    $('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
    $('wl').addEventListener('change', function () { state.wl = this.checked; renderBoard(); });
    window.addEventListener('hashchange', function () {
      state.selected = null; state.cat = ''; state.chain = ''; state.q = ''; state.wl = false;
      readHash(); fillSelects(); renderDetail(); renderBoard();
    });
  }

  function renderFooter() {
    $('foot').innerHTML =
      '<p>Snapshot: ' + esc(DATA.source) + ' (as of ' + esc(DATA.as_of) + '). Sealed input: the same bytes are scored on every run.</p>' +
      '<p>Implied values are a model\'s estimate of a launch valuation, not a promise: most protocols on this board may never launch a token. ' +
      'Farm plans are activity checklists with stated costs and times, not financial advice.</p>';
  }

  readHash();
  renderStats();
  fillSelects();
  bind();
  renderBoard();
  renderDetail();
  renderModel();
  renderLive();
  renderFooter();
})();
