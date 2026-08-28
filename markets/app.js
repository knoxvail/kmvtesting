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

  // baked entries deleted in this browser, keyed by their primary field
  function hiddenKeys(id, listKey) {
    store.hidden = store.hidden || {};
    store.hidden[id] = store.hidden[id] || {};
    store.hidden[id][listKey] = store.hidden[id][listKey] || [];
    return store.hidden[id][listKey];
  }

  function bakedRows(m, listKey) {
    var keyField = LISTS[listKey].fields[0].k;
    var hidden = hiddenKeys(m.id, listKey);
    return (m[listKey] || []).filter(function (r) {
      return hidden.indexOf(r[keyField]) === -1;
    });
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
    return bakedRows(m, listKey).concat(localRows(m.id, listKey));
  }

  function fmt(n) { return n.toLocaleString('en-US'); }

  // ---------- shared renderers ----------
  function entryCards(m, listKey) {
    var def = LISTS[listKey];
    var baked = bakedRows(m, listKey);
    var local = localRows(m.id, listKey);
    if (!baked.length && !local.length) {
      return '<p class="empty">' + esc(def.empty) + '</p>';
    }
    function card(r, kind, ref) {
      var primary = r[def.fields[0].k] || '(unnamed)';
      var info = entryInfo(m, listKey, r);
      var del = '<button type="button" class="del" data-market="' + m.id + '" data-list="' + listKey +
        '" data-kind="' + kind + '" data-ref="' + esc(String(ref)) + '" aria-label="Delete entry">&times;</button>';
      var sub = info.subText ? '<div class="entry-sub">' + esc(info.subText) + '</div>' : '';
      return '<div class="entry" data-list="' + listKey + '" data-kind="' + kind +
        '" data-ref="' + esc(String(ref)) + '" title="Open">' +
        (r.photo ? '<img class="entry-photo" src="' + esc(r.photo) + '" alt="' + esc(primary) + '" loading="lazy">' : '') +
        '<div class="entry-top"><span class="entry-name">' + esc(primary) + '</span>' +
        (info.unitsText ? '<span class="entry-units">' + esc(info.unitsText) + '</span>' : '') + del +
        '</div>' +
        sub +
        (r.note ? '<div class="entry-note">' + esc(r.note) + '</div>' : '') +
        '</div>';
    }
    var html = baked.map(function (r) { return card(r, 'baked', r[def.fields[0].k]); }).join('');
    local.forEach(function (r, i) {
      html += card(r, 'local', i);
    });
    return '<div class="entries">' + html + '</div>';
  }

  // shared row facts: sub line, units label, pasteable address
  function entryInfo(m, listKey, r) {
    var def = LISTS[listKey];
    var primary = r[def.fields[0].k] || '(unnamed)';
    var subParts = [];
    def.fields.forEach(function (f, i) {
      if (i === 0 || f.k === 'note' || f.k === def.unitField) return;
      if (r[f.k]) subParts.push(r[f.k]);
    });
    var subText = subParts.join(' · ');
    var uv = def.unitField && r[def.unitField] ? String(r[def.unitField]).trim() : '';
    return {
      primary: primary,
      subText: subText,
      unitsText: uv ? (/[a-z]/i.test(uv) ? uv : uv + ' units') : '',
      addr: (def.unitField && subText)
        ? (/\d/.test(subText) ? subText : (primary + ', ' + subText + ', ' + m.state))
        : null,
    };
  }

  function listCount(m, listKey) {
    var def = LISTS[listKey];
    var n = combinedRows(m, listKey).length;
    if (!n) return '';
    if (def.unitField) return n + (n === 1 ? ' property' : ' properties');
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
      '<div class="list-holder" id="list-' + listKey + '">' + entryCards(m, listKey) + '</div>' +
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
      var lihtc = combinedRows(m, 'deals').length;
      var il = combinedRows(m, 'il').length;
      var brokers = combinedRows(m, 'brokers').length;
      var log = (lihtc + il + brokers)
        ? [lihtc + ' LIHTC', il + ' SL', brokers + (brokers === 1 ? ' broker' : ' brokers')].join(' · ')
        : 'nothing logged yet';
      return '<a class="city-card" href="city.html?m=' + m.id + '" data-id="' + m.id + '">' +
        '<span class="idx">' + String(MARKETS.indexOf(m) + 1).padStart(2, '0') + '</span>' +
        '<h3>' + esc(m.name) + '</h3>' +
        '<div class="meta"><span>' + esc(m.state) + '</span><span class="codes">' + esc(codesOf(m)) + '</span></div>' +
        '<div class="card-log">' + log + '</div></a>';
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

    var airportBar = m.airports.map(function (a) {
      var week = (a.weekly && a.weekly !== 'confirm')
        ? ' <span class="ap-week">' + esc(a.weekly) + '/wk</span>' : '';
      return '<span class="ap"><span class="ap-code">' + esc(a.code) + '</span> ' +
        esc(a.service) + week +
        (a.verify ? ' <span class="chip verify">confirm</span>' : '') + '</span>';
    }).join('');
    if (m.airportNote) airportBar += '<span class="ap-note">' + esc(m.airportNote) + '</span>';

    root.innerHTML =
      '<div class="city-head">' +
        '<div>' +
          '<h2>' + esc(m.name) + '</h2>' +
          '<p class="meta">' + esc(m.state) + ' · <span class="codes">' + esc(codesOf(m)) + '</span></p>' +
        '</div>' +
      '</div>' +
      (m.flag ? '<p class="flag">' + esc(m.flag) + '</p>' : '') +
      (m.note ? '<p class="context-note">' + esc(m.note) + '</p>' : '') +
      '<div class="airport-bar">' + airportBar + '</div>' +
      '<div class="workspace">' +
        listPanel(m, 'deals') +
        listPanel(m, 'il') +
        listPanel(m, 'brokers') +
        '<div class="panel notes-panel"><h4>Notes <span class="note-status" id="note-status"></span>' +
          '<a class="edit-link" href="' + esc(m.notion) + '" target="_blank" rel="noopener">Notion &#8599;</a></h4>' +
          '<textarea class="notes-live" id="notes-live" placeholder="Loading notes&hellip;" disabled ' +
            'aria-label="Notes for ' + esc(m.name) + '"></textarea>' +
          '<p class="micro">Type, then click anywhere else. It saves straight to Notion.</p>' +
        '</div>' +
      '</div>' +
      '<div class="modal" id="entry-modal" hidden>' +
        '<div class="modal-backdrop"></div>' +
        '<div class="modal-card" role="dialog" aria-modal="true" id="modal-card"></div>' +
      '</div>';

    // ---- entry detail modal ----
    var modalEl = document.getElementById('entry-modal');
    var modalCard = document.getElementById('modal-card');

    function openModal(listKey, kind, ref) {
      var def = LISTS[listKey];
      var row = kind === 'baked'
        ? bakedRows(m, listKey).filter(function (r) {
            return String(r[def.fields[0].k]) === ref;
          })[0]
        : localRows(m.id, listKey)[Number(ref)];
      if (!row) return;
      var info = entryInfo(m, listKey, row);
      var actions = '';
      if (info.addr) {
        actions =
          '<button type="button" class="mini-act" data-act="maps" data-addr="' + esc(info.addr) + '">Google Maps &#8599;</button>' +
          '<button type="button" class="mini-act" data-act="copy" data-addr="' + esc(info.addr) + '">Copy address</button>' +
          '<button type="button" class="mini-act" data-act="costar" data-addr="' + esc(info.addr) + '">CoStar &#8599;</button>';
      } else if (row.contact) {
        actions = '<button type="button" class="mini-act" data-act="copy" data-addr="' + esc(row.contact) + '">Copy contact</button>';
      }
      modalCard.innerHTML =
        '<button type="button" class="modal-close" aria-label="Close">&times;</button>' +
        (row.photo ? '<img class="modal-photo" src="' + esc(row.photo) + '" alt="' + esc(info.primary) + '">' : '') +
        '<h3>' + esc(info.primary) + '</h3>' +
        (info.unitsText ? '<p class="modal-units">' + esc(info.unitsText) + '</p>' : '') +
        (info.subText ? '<p class="modal-addr">' + esc(info.subText) + '</p>' : '') +
        (row.note ? '<p class="modal-note">' + esc(row.note) + '</p>' : '') +
        '<div class="modal-actions">' + actions +
          '<button type="button" class="del" data-market="' + m.id + '" data-list="' + listKey +
            '" data-kind="' + kind + '" data-ref="' + esc(String(ref)) + '">Delete</button>' +
        '</div>';
      modalEl.hidden = false;
      // force a style pass so the transition runs from the closed state
      void modalCard.offsetWidth;
      setTimeout(function () { modalEl.classList.add('open'); }, 20);
      document.body.style.overflow = 'hidden';
    }

    function closeModal() {
      if (modalEl.hidden) return;
      modalEl.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(function () { modalEl.hidden = true; }, 200);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    function refresh(listKey) {
      document.getElementById('list-' + listKey).innerHTML = entryCards(m, listKey);
      document.getElementById('count-' + listKey).textContent = listCount(m, listKey);
    }

    root.addEventListener('click', function (e) {
      if (e.target.closest('.modal-close') || e.target.classList.contains('modal-backdrop')) {
        closeModal();
        return;
      }

      var act = e.target.closest('button.mini-act');
      if (act) {
        var addr = act.dataset.addr;
        if (act.dataset.act === 'maps') {
          window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr),
            '_blank', 'noopener');
          return;
        }
        var isCostar = act.dataset.act === 'costar';
        var orig = act.innerHTML;
        function flash(t) {
          act.textContent = t;
          setTimeout(function () { act.innerHTML = orig; }, 1500);
        }
        function goCostar() {
          if (isCostar) window.open('https://product.costar.com/', '_blank', 'noopener');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(addr).then(
            function () { flash('copied'); goCostar(); },
            function () { flash('copy failed'); goCostar(); }
          );
        } else {
          flash('no clipboard');
          goCostar();
        }
        return;
      }

      var del = e.target.closest('button.del');
      if (!del) {
        var entry = e.target.closest('.entry[data-list]');
        if (entry && !e.target.closest('button, a')) {
          openModal(entry.dataset.list, entry.dataset.kind, entry.dataset.ref);
        }
        return;
      }
      if (del.dataset.kind === 'baked') {
        hiddenKeys(m.id, del.dataset.list).push(del.dataset.ref);
      } else {
        localRows(m.id, del.dataset.list).splice(Number(del.dataset.ref), 1);
      }
      saveJSON(LS_KEY, store);
      refresh(del.dataset.list);
      if (del.closest('.modal')) closeModal();
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

    // Notes are two-way with Notion: GET fills the textarea, clicking
    // out POSTs the text back. A passphrase (EDIT_KEY in Vercel) gates
    // writes; it is asked for once and kept in localStorage.
    var ta = document.getElementById('notes-live');
    var statusEl = document.getElementById('note-status');
    var noteBase = null; // last text synced with Notion; null = not loaded

    function setStatus(text, tone) {
      statusEl.textContent = text;
      statusEl.className = 'note-status' + (tone ? ' ' + tone : '');
    }

    function getKey(interactive) {
      var k = null;
      try { k = localStorage.getItem('lihtc-edit-key'); } catch (e) {}
      if (!k && interactive) {
        k = window.prompt('Edit key (the EDIT_KEY value set in Vercel):');
        if (k) { try { localStorage.setItem('lihtc-edit-key', k); } catch (e) {} }
      }
      return k;
    }

    function loadNotes() {
      if (document.activeElement === ta) return;
      if (noteBase !== null && ta.value !== noteBase) return; // unsaved edits win
      fetch('/api/notes?m=' + m.id + '&t=' + Date.now())
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (d) {
          noteBase = d.text || '';
          ta.value = noteBase;
          ta.disabled = false;
          ta.placeholder = 'Notes for ' + m.name + '. Click out and it saves.';
          setStatus('synced', 'ok');
        })
        .catch(function () {
          setStatus('offline here — works on the live site', 'err');
        });
    }

    function saveNotes() {
      if (noteBase === null || ta.value === noteBase) return;
      var key = getKey(true);
      if (!key) { setStatus('not saved — no edit key', 'err'); return; }
      setStatus('saving…');
      fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ m: m.id, text: ta.value, key: key }),
      })
        .then(function (r) {
          if (r.status === 401) {
            try { localStorage.removeItem('lihtc-edit-key'); } catch (e) {}
            setStatus('wrong edit key — click out to retry', 'err');
            return;
          }
          if (r.status === 403) { setStatus('editing disabled — set EDIT_KEY in Vercel', 'err'); return; }
          if (!r.ok) { setStatus('save failed — click out to retry', 'err'); return; }
          noteBase = ta.value;
          setStatus('saved', 'ok');
        })
        .catch(function () { setStatus('save failed — click out to retry', 'err'); });
    }

    ta.addEventListener('blur', saveNotes);
    ta.addEventListener('input', function () {
      if (noteBase !== null && ta.value !== noteBase) setStatus('unsaved');
    });
    window.addEventListener('pagehide', function () {
      var key = getKey(false);
      if (noteBase === null || ta.value === noteBase || !key) return;
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/notes',
          new Blob([JSON.stringify({ m: m.id, text: ta.value, key: key })], { type: 'application/json' }));
      }
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) loadNotes();
    });
    loadNotes();
  }

  // ---------- boot ----------
  if (document.getElementById('city-grid')) initHome();
  if (document.getElementById('city-root')) initCity();
})();
