// Launch Radar's page. Reads window.RADAR (written beside dashboard/ by main.ts) and renders two
// views from it: the ranked board, sortable and filterable, and one detail page per protocol with
// the model's arithmetic and the farm plan. Hash routes keep every view linkable and printable:
//   #/                       the board
//   #/board?cat=Lending      the board, filtered (also chain, q, tier, sort, wl)
//   #/protocol/<slug>        one protocol's detail page
// No network: every byte on screen comes from data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var view = document.getElementById('view');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function usd(x) {
    if (x == null) return '—';
    if (x >= 1e9) return '$' + (x / 1e9).toFixed(2) + 'B';
    if (x >= 1e6) return '$' + (x / 1e6).toFixed(1) + 'M';
    if (x >= 1e3) return '$' + (x / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(x);
  }
  function pct(x) {
    if (x == null) return '<span>—</span>';
    var cls = x >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (x >= 0 ? '+' : '') + x.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days >= 730) return (days / 365).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' days';
  }
  function bySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }
  function barW(x, r) {
    // Log-scale bar width against the larger of this row's TVL and implied value.
    var top = Math.max(r.tvl_usd, r.implied_value_usd, 1);
    return Math.max(4, Math.round(100 * Math.log10(Math.max(x, 1)) / Math.log10(top)));
  }

  // ---- masthead + live strip + footer: the same on every view ----
  (function chrome() {
    var s = DATA.stats;
    document.getElementById('mastStats').innerHTML =
      '<div class="stat"><b>' + s.protocols + '</b><span>protocols scanned</span></div>' +
      '<div class="stat"><b>' + s.rows + '</b><span>ranked pre-token</span></div>' +
      '<div class="stat"><b>' + s.watchlist + '/' + s.watchlist + '</b><span>watchlist covered</span></div>' +
      '<div class="stat"><b>' + DATA.global_multiple.toFixed(2) + '×</b><span>global peer multiple</span></div>';
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    var catSel = document.getElementById('cat');
    catSel.innerHTML = '<option value="">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    var chainSel = document.getElementById('chain');
    chainSel.innerHTML = '<option value="">All chains</option>' + Object.keys(chains).sort().map(function (c) {
      return '<option>' + esc(c) + '</option>';
    }).join('');
    document.getElementById('liveStrip').innerHTML =
      '<h3>Already trading — the market\u2019s own values, for scale (not ranked)</h3><div class="live-flex">' +
      DATA.live.map(function (l) {
        return '<div class="live-chip"><b>' + esc(l.name) + '</b> <span>' + usd(l.mcap_usd) + ' mcap · ' +
          l.multiple.toFixed(2) + '× TVL</span></div>';
      }).join('') + '</div>';
    document.getElementById('footNote').textContent =
      'Snapshot: ' + DATA.source + ' · as of ' + DATA.as_of + ' · model: ' + DATA.version +
      ' · ' + DATA.stats.derivatives + ' wrapped/staked/bridged products set aside · ' +
      DATA.stats.live + ' live-token protocols compared.';
  })();

  // ---- board view ----
  function readControls() {
    return {
      q: document.getElementById('q').value.trim().toLowerCase(),
      cat: document.getElementById('cat').value,
      chain: document.getElementById('chain').value,
      tier: document.getElementById('tier').value,
      sort: document.getElementById('sort').value,
      wl: document.getElementById('wl').checked,
    };
  }
  function writeControls(st) {
    document.getElementById('q').value = st.q || '';
    document.getElementById('cat').value = st.cat || '';
    document.getElementById('chain').value = st.chain || '';
    document.getElementById('tier').value = st.tier || '';
    document.getElementById('sort').value = st.sort || 'value';
    document.getElementById('wl').checked = !!st.wl;
  }
  function filtered(st) {
    var rows = DATA.rows.filter(function (r) {
      if (st.q && r.name.toLowerCase().indexOf(st.q) < 0 && r.slug.indexOf(st.q) < 0) return false;
      if (st.cat && r.category !== st.cat) return false;
      if (st.chain && r.chains.indexOf(st.chain) < 0) return false;
      if (st.tier && r.tvl_usd < Number(st.tier)) return false;
      if (st.wl && !r.watchlist) return false;
      return true;
    });
    var key = {
      value: function (r) { return -r.implied_value_usd; },
      tvl: function (r) { return -r.tvl_usd; },
      growth: function (r) { return -(r.change_7d == null ? -999 : r.change_7d); },
      age: function (r) { return -(r.age_days == null ? -1 : r.age_days); },
      multiple: function (r) { return -r.multiple; },
    }[st.sort] || function () { return 0; };
    rows.sort(function (a, b) { return key(a) - key(b) || a.rank - b.rank; });
    return rows;
  }
  function renderBoard(st) {
    document.body.classList.remove('detail');
    writeControls(st);
    var rows = filtered(readControls());
    document.getElementById('rowCount').textContent = rows.length + ' of ' + DATA.rows.length + ' protocols';
    if (rows.length === 0) {
      view.innerHTML = '<p class="empty">No protocol matches those filters. Loosen one and the radar sweeps again.</p>';
      return;
    }
    var html = '<table class="board"><thead><tr>' +
      '<th>#</th><th>Protocol</th><th>Chains</th><th class="n">TVL</th><th class="n">7d</th>' +
      '<th class="n">Age, no token</th><th class="n">Peer ×</th><th class="n">Implied value</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="sub">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="n num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="n num">' + pct(r.change_7d) + '</td>' +
        '<td class="n num">' + ageText(r.age_days) + '</td>' +
        '<td class="n num">' + r.multiple.toFixed(2) + '×<span class="sub">' + r.peers + ' peer' + (r.peers === 1 ? '' : 's') + ' · ' + r.confidence + '</span></td>' +
        '<td class="n num val">' + usd(r.implied_value_usd) + '</td></tr>';
    });
    view.innerHTML = html + '</tbody></table>';
    Array.prototype.forEach.call(view.querySelectorAll('tr[data-slug]'), function (tr) {
      tr.addEventListener('click', function () { location.hash = '#/protocol/' + tr.getAttribute('data-slug'); });
    });
  }

  // ---- detail view ----
  function renderDetail(slug) {
    var r = bySlug(slug);
    if (!r) { renderBoard({}); return; }
    document.body.classList.add('detail');
    var base = r.tvl_usd * r.multiple;
    var html = '<p style="margin-top:18px"><a class="back" href="#/">&larr; Back to the board</a></p>' +
      '<div class="detail-head"><div><h2>' + esc(r.name) +
      (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</h2>' +
      '<p class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) +
      ' · records no token: DefiLlama carries no CoinGecko id, symbol or market cap for it</p></div>' +
      '<div class="kv" style="min-width:210px"><b style="color:var(--teal)">' + usd(r.implied_value_usd) + '</b><span>implied value · rank #' + r.rank + '</span></div></div>' +
      '<div class="grid">' +
      '<div class="kv"><b>' + usd(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="kv"><b>' + (r.change_7d == null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b><span>TVL change, 7 days</span></div>' +
      '<div class="kv"><b>' + ageText(r.age_days) + '</b><span>running with no token' + (r.listed_at ? ' · since ' + r.listed_at : '') + '</span></div>' +
      '<div class="kv"><b>' + r.chains.length + '</b><span>chains live on</span></div></div>' +
      '<div class="bars"><div class="bar-row"><span>TVL today</span><div class="bar"><i style="width:' + barW(r.tvl_usd, r) + '%"></i></div><b class="num">' + usd(r.tvl_usd) + '</b></div>' +
      '<div class="bar-row"><span>Implied value</span><div class="bar"><i class="teal" style="width:' + barW(r.implied_value_usd, r) + '%"></i></div><b class="num">' + usd(r.implied_value_usd) + '</b></div></div>' +
      '<div class="cols"><section class="panel"><h3>How the value is built</h3><table class="factors">' +
      '<tr><td>TVL (the snapshot\u2019s figure)</td><td class="n num">' + usd(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Peer multiple — median mcap/TVL of ' + r.peers + ' live ' + esc(r.category || '') + ' protocol' + (r.peers === 1 ? '' : 's') + ', shrunk to the global median</td><td class="n num">× ' + r.multiple.toFixed(3) + '</td></tr>' +
      '<tr><td>Base value</td><td class="n num">' + usd(base) + '</td></tr>' +
      '<tr><td>Momentum — 7-day TVL change, clamped and weighted at 0.35</td><td class="n num">× ' + r.momentum.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity — years running with no token, capped at three</td><td class="n num">× ' + r.maturity.toFixed(3) + '</td></tr>' +
      '<tr><td>Breadth — one plus 0.04 per extra chain, capped at five</td><td class="n num">× ' + r.breadth.toFixed(3) + '</td></tr>' +
      '<tr class="total"><td>Implied value if it launched at this record</td><td class="n num">' + usd(r.implied_value_usd) + '</td></tr>' +
      '</table>' +
      '<div class="evidence"><h4>The live peers behind this multiple</h4>' +
      (r.peer_names.length
        ? '<ul class="peers">' + r.peer_names.map(function (pn) {
            return '<li><b>' + esc(pn.name) + '</b><span class="num">' + pn.multiple.toFixed(2) + '× TVL</span></li>';
          }).join('') + '</ul>'
        : '<p class="none">No live protocol in this category clears the snapshot\u2019s $1M TVL evidence floor, so the global median carries the claim on its own.</p>') +
      '<p class="conf">Evidence: <b class="conf-' + r.confidence + '">' + r.confidence + '</b> — ' +
      (r.confidence === 'deep'
        ? r.peers + ' live peers trade in this category; the median is the category\u2019s own market speaking.'
        : r.confidence === 'fair'
          ? r.peers + ' live peers trade in this category; shrinkage still lends the median some of the global market\u2019s weight.'
          : 'at most one live peer stands behind this category, so shrinkage pulls the multiple toward the global median and the claim should be read with that caution.') +
      '</p></div></section>' +
      '<section class="panel"><h3>Farm plan — what to do before a token exists</h3><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></section></div>';
    view.innerHTML = html;
    window.scrollTo(0, 0);
  }

  // ---- routing + control wiring ----
  function route() {
    var hash = location.hash || '#/';
    if (hash.indexOf('#/protocol/') === 0) {
      renderDetail(decodeURIComponent(hash.slice('#/protocol/'.length)));
      return;
    }
    var st = {};
    var qAt = hash.indexOf('?');
    if (qAt >= 0) {
      new URLSearchParams(hash.slice(qAt + 1)).forEach(function (v, k) { st[k] = v; });
      st.wl = st.wl === '1';
    }
    renderBoard(st);
  }
  ['q', 'cat', 'chain', 'tier', 'sort', 'wl'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      if ((location.hash || '#/').indexOf('#/protocol/') === 0) location.hash = '#/';
      renderBoard({});
    });
  });
  window.addEventListener('hashchange', route);
  route();
})();
