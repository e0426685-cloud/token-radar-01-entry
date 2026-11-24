// Launch Radar dashboard logic. Reads window.RADAR (written beside this page by main.ts) and
// renders the ranked board with search, category and chain filters, five sort orders, a
// per-protocol detail panel with the farm plan, and the already-trading peer strip the model's
// multiples are learned from. No fetch, no network: every byte shown ships in data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'implied',
    open: params.get('open') || null,
  };

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n === null || n === undefined) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'untracked';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs tracked';
    return days + ' days tracked';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Header statistics, straight from the model's own summary of the board.
  var s = DATA.stats;
  $('stats').innerHTML = [
    [String(s.board_rows), 'protocols ranked'],
    [String(s.watchlist) + '/' + String(s.watchlist), 'watchlist covered'],
    [money(s.board_tvl_usd), 'TVL under watch'],
    [money(s.board_implied_usd), 'implied launch value'],
    [String(s.pre_token), 'record no token'],
  ].map(function (pair) {
    return '<div class="stat"><b>' + esc(pair[0]) + '</b><span>' + esc(pair[1]) + '</span></div>';
  }).join('');

  // Filter vocabularies come from the data itself, so a future snapshot needs no page edit.
  var cats = [];
  var chains = [];
  DATA.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="all">All categories</option>' + cats.map(function (c) {
    return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  $('chain').innerHTML = '<option value="all">All chains</option>' + chains.map(function (c) {
    return '<option' + (c === state.chain ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  $('q').value = state.q;
  $('watch').checked = state.watch;
  $('sort').value = state.sort;

  var SORTERS = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    name: function (a, b) { return a.name.localeCompare(b.name); },
  };

  function visible() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.on_watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    }).sort(SORTERS[state.sort] || SORTERS.implied);
  }

  function render() {
    var rows = visible();
    $('count').textContent = rows.length + ' of ' + DATA.rows.length + ' shown';
    $('rows').innerHTML = rows.map(function (r) {
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.slug) + '" aria-selected="' + (state.open === r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
        (r.on_watchlist ? '<span class="pill">watchlist</span>' : '') +
        '<span class="slug">' + esc(r.slug) + ' · ' + esc(ageLabel(r.age_days)) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + r.peer_multiple.toFixed(2) + 'x</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="farm">' + r.steps.length + ' steps →</td></tr>';
    }).join('');
    Array.prototype.forEach.call($('rows').querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
    });
    if (state.open) showDetail(state.open);
  }

  function openDetail(slug) {
    state.open = slug;
    render();
    var panel = $('detail');
    if (!panel.hidden) panel.scrollIntoView({ block: 'nearest' });
  }

  function showDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var panel = $('detail');
    if (!row) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML =
      '<button class="close" id="close-detail">Close</button>' +
      '<h3>' + esc(row.name) + (row.on_watchlist ? '<span class="pill">watchlist</span>' : '') + '</h3>' +
      '<p class="meta">Rank #' + row.rank + ' · ' + esc(row.category || 'Uncategorised') + ' · ' +
      esc(row.chains.join(', ') || 'chain unlisted') + ' · ' + esc(ageLabel(row.age_days)) + '</p>' +
      '<p>TVL <b>' + money(row.tvl_usd) + '</b> · 7d change <b>' + pct(row.change_7d) + '</b> · ' +
      'peer multiple <b>' + row.peer_multiple.toFixed(2) + 'x</b> · implied launch value <b>' + money(row.implied_value_usd) + '</b></p>' +
      '<p>' + esc(row.name) + ' records no token in the snapshot (no CoinGecko id, no symbol, no market cap). ' +
      'The implied value is the peer model applied to its own figures: TVL x the median market-cap/TVL of its ' +
      'category\'s traded protocols, adjusted for momentum, seasoning and chain breadth. It is an estimate of ' +
      'what a launch would be worth if the record stayed as it is — not a promise that one will happen.</p>' +
      '<h4>Farm plan</h4><ol>' +
      row.steps.map(function (step) { return '<li>' + esc(step) + '</li>'; }).join('') +
      '</ol>';
    $('close-detail').addEventListener('click', function () {
      state.open = null;
      panel.hidden = true;
      render();
    });
    // A page opened with ?open=<slug> (a shared detail link) leads with the panel:
    // it is moved above the methodology strip so the protocol is the first thing read.
    if (params.get('open') === slug) {
      var method = document.querySelector('.method');
      if (method && method.parentNode) method.parentNode.insertBefore(panel, method);
    }
  }

  // The already-trading peers: context for the model, deliberately kept off the ranked board.
  $('live').innerHTML = DATA.live.map(function (p) {
    return '<div class="live-card"><b>' + esc(p.name) + (p.symbol ? ' · ' + esc(p.symbol) : '') + '</b>' +
      '<span>' + money(p.mcap_usd) + ' market cap · ' + money(p.tvl_usd) + ' TVL</span></div>';
  }).join('');

  $('foot').textContent =
    'Launch Radar · model ' + DATA.model_version + ' · snapshot as of ' + DATA.as_of +
    ' (DefiLlama protocol data, frozen) · watchlist floor ' + money(DATA.floor_usd) +
    ' TVL · a protocol is described as recording no token, never as having none: the record is evidence, not proof.';

  $('q').addEventListener('input', function () { state.q = this.value; render(); });
  $('cat').addEventListener('change', function () { state.cat = this.value; render(); });
  $('chain').addEventListener('change', function () { state.chain = this.value; render(); });
  $('watch').addEventListener('change', function () { state.watch = this.checked; render(); });
  $('sort').addEventListener('change', function () { state.sort = this.value; render(); });

  render();
})();
