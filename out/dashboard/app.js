// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the board, a filterable table, a per-protocol detail with the model's own numbers and the farm
// plan, two charts and the day's shortlists. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', cat: 'all', chain: 'all', band: 'all', watch: false, sort: 'implied_value_usd', dir: -1, sel: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.round(d) + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
  }

  function rows() {
    var out = DATA.rows.slice();
    var q = state.q.trim().toLowerCase();
    if (q) out = out.filter(function (r) {
      return (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    if (state.cat !== 'all') out = out.filter(function (r) { return r.category === state.cat; });
    if (state.chain !== 'all') out = out.filter(function (r) { return r.chains.indexOf(state.chain) >= 0; });
    if (state.band !== 'all') {
      var min = Number(state.band) * 1e6;
      out = out.filter(function (r) { return r.tvl_usd >= min; });
    }
    if (state.watch) out = out.filter(function (r) { return r.on_watchlist; });
    var k = state.sort;
    out.sort(function (a, b) {
      var av = k === 'score' ? a.airdrop.score : k === 'cost' ? a.airdrop.farm_cost_usd : a[k];
      var bv = k === 'score' ? b.airdrop.score : k === 'cost' ? b.airdrop.farm_cost_usd : b[k];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'string') return state.dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return state.dir * (av - bv);
    });
    return out;
  }

  function head() {
    document.getElementById('meta').innerHTML =
      'snapshot <b>' + esc(DATA.as_of) + '</b> · floor ' + fmtUsd(DATA.floor_usd) + '<br>' +
      esc(String(DATA.source).replace('DefiLlama https://api.llama.com', 'DefiLlama'));
    document.getElementById('stats').innerHTML = [
      ['Protocols in the snapshot', String(DATA.counts.protocols), DATA.counts.pre_token + ' record no token'],
      ['Board rows', String(DATA.counts.rows), DATA.counts.watchlist + ' on the house watchlist'],
      ['Top implied launch value', fmtUsd(DATA.rows[0].implied_value_usd), DATA.rows[0].name],
      ['Best farm score', String(DATA.summary.top_score[0].score), DATA.summary.top_score[0].name + ' · ' + fmtUsd(DATA.summary.top_score[0].per_wallet_usd) + ' a wallet'],
    ].map(function (c) {
      return '<div class="stat"><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="n">' + esc(c[2]) + '</div></div>';
    }).join('');
    document.getElementById('method').innerHTML = '<b>How the board is built.</b> ' + esc(DATA.model_statement);
    document.getElementById('foot').innerHTML =
      'Every figure comes from the sealed snapshot (' + esc(DATA.as_of) + '). Implied launch value is a model, not a price; ' +
      'the airdrop column is a stated assumption, never a promise. Farm plans are generic steps for the category, not advice.';
  }

  function controls() {
    var cats = {}, chains = {};
    DATA.rows.forEach(function (r) {
      cats[r.category] = (cats[r.category] || 0) + 1;
      r.chains.forEach(function (c) { chains[c] = (chains[c] || 0) + 1; });
    });
    var cat = document.getElementById('cat');
    cat.innerHTML = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + ' (' + cats[c] + ')</option>';
    }).join('');
    var ch = document.getElementById('chain');
    ch.innerHTML = '<option value="all">All chains</option>' + Object.keys(chains).sort(function (a, b) { return chains[b] - chains[a]; }).slice(0, 40).map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + ' (' + chains[c] + ')</option>';
    }).join('');
    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; table(); });
    cat.addEventListener('change', function (e) { state.cat = e.target.value; table(); });
    ch.addEventListener('change', function (e) { state.chain = e.target.value; table(); });
    document.getElementById('band').addEventListener('change', function (e) { state.band = e.target.value; table(); });
    document.getElementById('watch').addEventListener('change', function (e) { state.watch = e.target.checked; table(); });
    Array.prototype.forEach.call(document.querySelectorAll('#board thead th'), function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
        table();
      });
    });
  }

  function table() {
    var list = rows();
    document.getElementById('count').textContent = list.length + ' of ' + DATA.rows.length + ' rows';
    document.getElementById('rows').innerHTML = list.map(function (r) {
      var s = r.airdrop.score;
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="nm">' + esc(r.name) + '</div><div class="slug">' + esc(r.slug) + (r.on_watchlist ? ' · watchlist' : '') + '</div></td>' +
        '<td><span class="chip">' + esc(r.category) + '</span></td>' +
        '<td class="num">' + r.chain_count + (r.chain_count > 1 ? ' <span class="slug">' + esc(r.chains.slice(0, 2).join(', ')) + '</span>' : '') + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + fmtUsd(r.implied_value_usd) + '</b><div class="slug">' + r.implied_breakdown.category_multiple.toFixed(2) + 'x TVL</div></td>' +
        '<td class="num"><span class="scorebar"><i style="width:' + s + '%"></i></span>' + s + ' <span class="band-' + r.airdrop.band + '">' + r.airdrop.band + '</span></td>' +
        '<td class="num">' + fmtUsd(r.airdrop.farm_cost_usd) + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#rows tr'), function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
    draw();
  }

  function select(slug) {
    state.sel = state.sel === slug ? null : slug;
    var r = DATA.rows.filter(function (x) { return x.slug === slug; })[0];
    var box = document.getElementById('detail');
    if (!r) {
      box.innerHTML = '<p class="empty">Pick a row to see the model\'s numbers, the airdrop estimate and the farm plan.</p>';
    } else {
      var b = r.implied_breakdown;
      box.innerHTML =
        '<h2>Protocol</h2>' +
        '<div class="name">' + esc(r.name) + '</div>' +
        '<div>' + r.chains.map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('') +
        '<span class="chip on">' + esc(r.category) + '</span>' + (r.on_watchlist ? '<span class="chip on">watchlist</span>' : '') + '</div>' +
        '<div class="lbl">Implied launch value</div><div class="big">' + fmtUsd(r.implied_value_usd) + '</div>' +
        '<div class="slug">rank ' + r.rank + ' of ' + DATA.rows.length + ' pre-token protocols · TVL ' + fmtUsd(r.tvl_usd) +
        ' · 7d ' + fmtPct(r.change_7d) + ' · age ' + fmtAge(r.age_days) + '</div>' +
        '<dl>' +
        '<dt>Base at the category multiple</dt><dd>' + fmtUsd(b.base_usd) + ' <span class="slug">(' + b.category_multiple.toFixed(3) + 'x)</span></dd>' +
        '<dt>Chain breadth</dt><dd>' + b.breadth.toFixed(3) + 'x</dd>' +
        '<dt>Momentum (7d)</dt><dd>' + b.momentum.toFixed(3) + 'x</dd>' +
        '<dt>Maturity</dt><dd>' + b.maturity.toFixed(3) + 'x</dd>' +
        '<dt>Comparable live protocols in the category</dt><dd>' + (b.comparables ? 'yes' : 'none, market median used') + '</dd>' +
        '</dl>' +
        '<div class="lbl">Airdrop estimate</div>' +
        '<dl>' +
        '<dt>Assumed share to early users</dt><dd>' + (r.airdrop.share * 100).toFixed(0) + '% of the implied value</dd>' +
        '<dt>Assumed wallets</dt><dd>' + r.airdrop.wallets.toLocaleString('en-US') + '</dd>' +
        '<dt>Per well-farmed wallet</dt><dd><b>' + fmtUsd(r.airdrop.per_wallet_usd) + '</b></dd>' +
        '<dt>Cost to farm</dt><dd>' + fmtUsd(r.airdrop.farm_cost_usd) + '</dd>' +
        '<dt>Score</dt><dd>' + r.airdrop.score + ' <span class="band-' + r.airdrop.band + '">' + r.airdrop.band + '</span></dd>' +
        '</dl>' +
        '<div class="lbl">Farm plan</div><ol>' + r.farm_steps.map(function (s) {
          return '<li><b>' + esc(s.step) + '</b> <span class="cost">(' + esc(s.cost) + ')</span><div class="d">' + esc(s.detail) + '</div></li>';
        }).join('') + '</ol>' +
        '<div class="why">' + esc(r.why) + '</div>';
    }
    table();
  }

  function axes(c, w, h, minX, maxX, minY, maxY) {
    c.clearRect(0, 0, w, h);
    c.strokeStyle = '#e4e7ec'; c.lineWidth = 1; c.fillStyle = '#6b7280'; c.font = '11px ui-sans-serif, system-ui, sans-serif';
    function x(v) { return 44 + (Math.log10(v) - Math.log10(minX)) / (Math.log10(maxX) - Math.log10(minX)) * (w - 60); }
    function y(v) { return h - 28 - (Math.log10(v) - Math.log10(minY)) / (Math.log10(maxY) - Math.log10(minY)) * (h - 46); }
    c.beginPath();
    for (var i = 0; i <= 4; i++) {
      var gx = 44 + i / 4 * (w - 60), gy = h - 28 - i / 4 * (h - 46);
      c.moveTo(gx, 18); c.lineTo(gx, h - 28); c.moveTo(44, gy); c.lineTo(w - 16, gy);
    }
    c.stroke();
    c.fillText('TVL (log)', w / 2 - 26, h - 8);
    c.save(); c.translate(12, h / 2 + 34); c.rotate(-Math.PI / 2); c.fillText('implied value (log)', 0, 0); c.restore();
    return { x: x, y: y };
  }

  function draw() {
    var rowsAll = DATA.rows;
    var sc = document.getElementById('scatter');
    if (sc && sc.getContext) {
      var c = sc.getContext('2d');
      var tvls = rowsAll.map(function (r) { return r.tvl_usd; });
      var vals = rowsAll.map(function (r) { return r.implied_value_usd; });
      var a = axes(c, sc.width, sc.height, Math.min.apply(null, tvls) * 0.7, Math.max.apply(null, tvls) * 1.4,
        Math.min.apply(null, vals) * 0.7, Math.max.apply(null, vals) * 1.4);
      rowsAll.forEach(function (r) {
        var sel = r.slug === state.sel;
        c.beginPath();
        c.arc(a.x(r.tvl_usd), a.y(r.implied_value_usd), sel ? 5 : 2.4, 0, Math.PI * 2);
        c.fillStyle = sel ? '#1d4ed8' : 'rgba(29,78,216,0.35)';
        c.fill();
        if (sel) { c.strokeStyle = '#111827'; c.lineWidth = 1.5; c.stroke(); }
      });
    }
    var bs = document.getElementById('bars');
    if (bs && bs.getContext) {
      var b = bs.getContext('2d');
      var cats = DATA.summary.categories.slice(0, 8);
      var max = Math.max.apply(null, cats.map(function (x) { return x.implied_usd; }));
      b.clearRect(0, 0, bs.width, bs.height);
      b.font = '11px ui-sans-serif, system-ui, sans-serif';
      cats.forEach(function (x, i) {
        var y = 16 + i * ((bs.height - 28) / cats.length);
        var w = (x.implied_usd / max) * (bs.width - 190);
        b.fillStyle = '#1d4ed8';
        b.fillRect(150, y, Math.max(2, w), 14);
        b.fillStyle = '#14171c';
        b.fillText(x.category.slice(0, 22), 8, y + 11);
        b.fillStyle = '#6b7280';
        b.fillText(fmtUsd(x.implied_usd) + ' · ' + x.rows + ' rows', 156 + Math.max(2, w), y + 11);
      });
    }
  }

  function lists() {
    var s = DATA.summary;
    document.getElementById('lists').innerHTML =
      '<div><h2>Highest implied launch value</h2><ol>' + s.top_value.map(function (r) {
        return '<li>' + esc(r.name) + ' <span class="v">' + fmtUsd(r.implied_value_usd) + ' · ' + esc(r.category) + '</span></li>';
      }).join('') + '</ol></div>' +
      '<div><h2>Best farm score</h2><ol>' + s.top_score.map(function (r) {
        return '<li>' + esc(r.name) + ' <span class="v">score ' + r.score + ' · ' + fmtUsd(r.per_wallet_usd) + ' a wallet · cost ' + fmtUsd(r.cost) + '</span></li>';
      }).join('') + '</ol></div>' +
      '<div><h2>Biggest 7-day moves</h2><ol>' + s.movers.map(function (r) {
        return '<li>' + esc(r.name) + ' <span class="v ' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span> <span class="v">on ' + fmtUsd(r.tvl_usd) + ' TVL</span></li>';
      }).join('') + '</ol></div>';
  }

  head(); controls(); lists(); table();
  var first = DATA.rows[0];
  if (first) select(first.slug);
})();