// Shared logic for the market screen. Home page and city page both
// load this; init picks the mode based on what's in the DOM.

(function () {
  'use strict';

  // ---------- storage ----------
  var LS_KEY = 'lihtc-screen-v1';
  var RECENT_KEY = 'lihtc-recent-v1';

  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch (e) { return fallback; }
  }
  function saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  var store = loadJSON(LS_KEY, {});
  store.notes = store.notes || {};
  store.lists = store.lists || {};

  function localRows(id, listKey) {
    store.lists[id] = store.lists[id] || {};
    store.lists[id][listKey] = store.lists[id][listKey] || [];
    return store.lists[id][listKey];
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function byId(id) {
    for (var i = 0; i < MARKETS.length; i++) if (MARKETS[i].id === id) return MARKETS[i];
    return null;
  }

  function codesOf(m) {
    return m.airports.map(function (a) { return a.code; }).join(' / ');
  }

  function combinedRows(m, listKey) {
    return (m[listKey] || []).concat(localRows(m.id, listKey));
  }

  function unitTotal(m, listKey) {
    var total = 0;
    combinedRows(m, listKey).forEach(function (r) {
      var n = parseInt(String(r.units || '').replace(/[^0-9]/g, ''), 10);
      if (!isNaN(n)) total += n;
    });
    return total;
  }

  function fmt(n) { return n.toLocaleString('en-US'); }

  // ---------- shared renderers ----------
  function listTable(m, listKey) {
    var def = LISTS[listKey];
    var baked = m[listKey] || [];
    var local = localRows(m.id, listKey);
    if (!baked.length && !local.length) {
      return '<p class="empty">' + esc(def.empty) + '</p>';
    }
    var head = def.fields.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '<th></th>';
    var rows = '';
    baked.forEach(function (r) {
      rows += '<tr>' + def.fields.map(function (f) {
        return '<td>' + esc(r[f.k]) + '</td>';
      }).join('') + '<td></td></tr>';
    });
    local.forEach(function (r, i) {
      rows += '<tr>' + def.fields.map(function (f) {
        return '<td>' + esc(r[f.k]) + '</td>';
      }).join('') +
      '<td><button type="button" class="del" data-market="' + m.id + '" data-list="' + listKey +
      '" data-index="' + i + '" aria-label="Delete row">remove</button></td></tr>';
    });
    return '<div class="table-scroll"><table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function listCount(m, listKey) {
    var def = LISTS[listKey];
    var n = combinedRows(m, listKey).length;
    if (!n) return '';
    if (def.unitField) {
      return n + (n === 1 ? ' property' : ' properties') + ' · ' + fmt(unitTotal(m, listKey)) + ' units';
    }
    return n + (n === 1 ? ' contact' : ' contacts');
  }

  function listPanel(m, listKey) {
    var def = LISTS[listKey];
    var inputs = def.fields.map(function (f, i) {
      return '<input name="' + f.k + '" placeholder="' + esc(f.label) + '" aria-label="' + esc(f.label) + '"' +
        (i === 0 ? ' required' : '') + '>';
    }).join('');
    return '<div class="panel">' +
      '<h4>' + esc(def.title) + '<span class="count" id="count-' + listKey + '">' + esc(listCount(m, listKey)) + '</span></h4>' +
      '<div class="list-holder" id="list-' + listKey + '">' + listTable(m, listKey) + '</div>' +
      '<form class="add-row" data-market="' + m.id + '" data-list="' + listKey + '">' + inputs +
      '<button type="submit">Add</button></form>' +
      '</div>';
  }

  function exportButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      var payload = JSON.stringify({ notes: store.notes, lists: store.lists }, null, 2);
      function done(ok) {
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(function () { btn.textContent = 'Copy data as JSON'; }, 1600);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(function () { done(true); }, function () { done(false); });
      } else { done(false); }
    });
  }

  // ---------- home page ----------
  function initHome() {
    var grid = document.getElementById('city-grid');
    var recentRow = document.getElementById('recent-row');
    var search = document.getElementById('search');

    function cardHTML(m) {
      var lihtc = unitTotal(m, 'deals');
      var il = unitTotal(m, 'il');
      var brokers = combinedRows(m, 'brokers').length;
      return '<a class="city-card" href="city.html?m=' + m.id + '" data-id="' + m.id + '">' +
        '<span class="idx">' + String(MARKETS.indexOf(m) + 1).padStart(2, '0') + '</span>' +
        '<h3>' + esc(m.name) + '</h3>' +
        '<div class="meta"><span>' + esc(m.state) + '</span><span class="codes">' + esc(codesOf(m)) + '</span></div>' +
        '<div class="units">' +
          '<span class="u"><span class="n">' + fmt(lihtc) + '</span><span class="l">LIHTC units</span></span>' +
          '<span class="u"><span class="n">' + fmt(il) + '</span><span class="l">IL units</span></span>' +
          '<span class="u"><span class="n">' + fmt(brokers) + '</span><span class="l">Brokers</span></span>' +
        '</div></a>';
    }

    function renderGrid(query) {
      var q = (query || '').trim().toLowerCase();
      var shown = MARKETS.filter(function (m) {
        if (!q) return true;
        var hay = [m.name, m.state, codesOf(m)];
        ['brokers', 'deals', 'il'].forEach(function (k) {
          combinedRows(m, k).forEach(function (r) {
            Object.keys(r).forEach(function (f) { hay.push(r[f]); });
          });
        });
        return hay.join(' ').toLowerCase().indexOf(q) !== -1;
      });
      grid.innerHTML = shown.length
        ? shown.map(cardHTML).join('')
        : '<p class="no-results">Nothing matches "' + esc(query) + '".</p>';
    }

    function renderRecent() {
      var ids = loadJSON(RECENT_KEY, []);
      var items = ids.map(byId).filter(Boolean);
      recentRow.innerHTML = items.length
        ? items.map(function (m) {
            return '<a href="city.html?m=' + m.id + '">' + esc(m.name) +
              '<span class="codes">' + esc(codesOf(m)) + '</span></a>';
          }).join('')
        : '<span class="none">No pages visited yet.</span>';
    }

    search.addEventListener('input', function () { renderGrid(search.value); });
    renderGrid('');
    renderRecent();
    exportButton(document.getElementById('export-btn'));
  }

  // ---------- city page ----------
  function initCity() {
    var root = document.getElementById('city-root');
    var params = new URLSearchParams(location.search);
    var m = byId(params.get('m'));

    // tab bar renders on every city page, current one highlighted
    var tabs = document.getElementById('city-tabs');
    tabs.innerHTML = MARKETS.map(function (t) {
      var current = m && t.id === m.id;
      return '<a href="city.html?m=' + t.id + '"' + (current ? ' aria-current="page"' : '') + '>' +
        esc(t.name) + '</a>';
    }).join('');

    if (!m) {
      root.innerHTML = '<p class="empty">Unknown market. <a href="./">Back to the board.</a></p>';
      return;
    }

    document.title = m.name + ' · Market Screen';

    // recents
    var recent = loadJSON(RECENT_KEY, []).filter(function (id) { return id !== m.id; });
    recent.unshift(m.id);
    saveJSON(RECENT_KEY, recent.slice(0, 6));

    var airportRows = m.airports.map(function (a) {
      return '<tr>' +
        '<td class="codes">' + esc(a.code) + '</td>' +
        '<td>' + esc(a.name) + '</td>' +
        '<td>' + esc(a.service) + (a.verify ? ' <span class="chip verify">confirm</span>' : '') + '</td>' +
        '<td class="num">' + esc(a.weekly) + '</td>' +
        '</tr>';
    }).join('');

    var dealProps = combinedRows(m, 'deals').length;
    var ilProps = combinedRows(m, 'il').length;

    root.innerHTML =
      '<div class="city-head">' +
        '<div>' +
          '<h2>' + esc(m.name) + '</h2>' +
          '<p class="meta">' + esc(m.state) + ' · <span class="codes">' + esc(codesOf(m)) + '</span></p>' +
        '</div>' +
        '<div class="stat-row">' +
          '<div class="stat"><span class="n" id="stat-deals">' + fmt(unitTotal(m, 'deals')) + '</span>' +
            '<span class="l">LIHTC units</span><p class="sub" id="stat-deals-sub">across ' + dealProps + ' logged</p></div>' +
          '<div class="stat"><span class="n" id="stat-il">' + fmt(unitTotal(m, 'il')) + '</span>' +
            '<span class="l">IL units, 150+</span><p class="sub" id="stat-il-sub">across ' + ilProps + ' logged</p></div>' +
          '<div class="stat"><span class="n" id="stat-brokers">' + fmt(combinedRows(m, 'brokers').length) + '</span>' +
            '<span class="l">Brokers &amp; owners</span><p class="sub">on the call list</p></div>' +
        '</div>' +
      '</div>' +
      (m.flag ? '<p class="flag">' + esc(m.flag) + '</p>' : '') +
      '<div class="workspace">' +
        '<div class="stack">' +
          (m.note ? '<p class="context-note">' + esc(m.note) + '</p>' : '') +
          '<div class="panel"><h4>Notes <a class="edit-link" href="' + esc(m.notion) + '" target="_blank" rel="noopener">Edit in Notion &#8599;</a></h4>' +
            '<div class="notion-view" id="notion-view"><p class="empty">Loading notes&hellip;</p></div>' +
          '</div>' +
          '<div class="panel"><h4>Airport access</h4>' +
            '<div class="table-scroll"><table>' +
            '<thead><tr><th>Code</th><th>Airport</th><th>SNA service</th><th>Weekly</th></tr></thead>' +
            '<tbody>' + airportRows + '</tbody></table></div>' +
            (m.airportNote ? '<p class="micro">' + esc(m.airportNote) + '</p>' : '') +
          '</div>' +
          listPanel(m, 'brokers') +
        '</div>' +
        '<div class="stack">' + listPanel(m, 'deals') + '</div>' +
        '<div class="stack">' + listPanel(m, 'il') + '</div>' +
      '</div>';

    function refresh(listKey) {
      document.getElementById('list-' + listKey).innerHTML = listTable(m, listKey);
      document.getElementById('count-' + listKey).textContent = listCount(m, listKey);
      document.getElementById('stat-deals').textContent = fmt(unitTotal(m, 'deals'));
      document.getElementById('stat-il').textContent = fmt(unitTotal(m, 'il'));
      document.getElementById('stat-brokers').textContent = fmt(combinedRows(m, 'brokers').length);
      document.getElementById('stat-deals-sub').textContent = 'across ' + combinedRows(m, 'deals').length + ' logged';
      document.getElementById('stat-il-sub').textContent = 'across ' + combinedRows(m, 'il').length + ' logged';
    }

    root.addEventListener('click', function (e) {
      var del = e.target.closest('button.del');
      if (!del) return;
      localRows(m.id, del.dataset.list).splice(Number(del.dataset.index), 1);
      saveJSON(LS_KEY, store);
      refresh(del.dataset.list);
    });

    root.addEventListener('submit', function (e) {
      var form = e.target.closest('form.add-row');
      if (!form) return;
      e.preventDefault();
      var def = LISTS[form.dataset.list];
      var entry = {};
      var hasValue = false;
      def.fields.forEach(function (f) {
        entry[f.k] = form.elements[f.k].value.trim();
        if (entry[f.k]) hasValue = true;
      });
      if (!hasValue) return;
      localRows(m.id, form.dataset.list).push(entry);
      saveJSON(LS_KEY, store);
      refresh(form.dataset.list);
      form.reset();
      form.elements[def.fields[0].k].focus();
    });

    // Notes live in Notion. Pull them through /api/notes, and refresh
    // whenever the tab regains focus so edits show up on return.
    function loadNotes() {
      var view = document.getElementById('notion-view');
      fetch('/api/notes?m=' + m.id)
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (d) {
          view.innerHTML = d.html && d.html.trim()
            ? d.html
            : '<p class="empty">Nothing written yet. Use Edit in Notion.</p>';
        })
        .catch(function () {
          view.innerHTML = '<p class="empty">Notes sync is not connected yet. ' +
            'Edit in Notion works now; notes will show here once the Vercel token is set.</p>';
        });
    }
    loadNotes();
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadNotes();
    });
  }

  // ---------- boot ----------
  if (document.getElementById('city-grid')) initHome();
  if (document.getElementById('city-root')) initCity();
})();
