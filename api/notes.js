// Vercel serverless function: two-way notes sync with Notion.
// GET  /api/notes?m=slc  -> { text } plain-text version of the city's Notion page
// POST /api/notes        -> { m, text, key } replaces the page content
// Needs NOTION_TOKEN (integration secret, with read + update + insert
// content capabilities) and EDIT_KEY (passphrase that gates writes)
// set in Vercel env. The database must be connected to the integration.

const PAGES = {
  phx: '3c9c40abce3981428547fb6475a808a1',
  slc: '3c9c40abce398102bea2c1e40ee26968',
  provo: '3c9c40abce3981039cf8c270dfd29a01',
  ogden: '3c9c40abce39814a9e71c866a7504738',
  dfw: '3c9c40abce3981f59604cdac2241f68e',
  ftw: '3c9c40abce39818c8fd4c27edeced9ec',
  boi: '3c9c40abce39813d9cc6cb907bc56551',
  aus: '3c9c40abce3981da9fbddb5e648ca559',
  sat: '3c9c40abce3981919d4cf071b9adf3ff',
  den: '3c9c40abce3981229f82e97c2a5f5949',
  cos: '3c9c40abce398161a42bed1da63ced7c',
  clt: '3c9c40abce39819ea016eb9853e3404f',
  hou: '3c9c40abce39811e8ba7e19ba9d7abc3',
  sun: '3c9c40abce3981ee8df6e8df529a6dc0',
};

function nfetch(path, method, body, token) {
  return fetch('https://api.notion.com/v1' + path, {
    method: method || 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function listChildren(id, token) {
  var blocks = [];
  var cursor = null;
  do {
    var r = await nfetch('/blocks/' + id + '/children?page_size=100' +
      (cursor ? '&start_cursor=' + cursor : ''), 'GET', null, token);
    if (!r.ok) return { ok: false, status: r.status };
    var body = await r.json();
    blocks = blocks.concat(body.results || []);
    cursor = body.has_more ? body.next_cursor : null;
  } while (cursor);
  return { ok: true, blocks: blocks };
}

// ---------- Notion blocks -> plain text ----------
function plainOf(d) {
  return (d.rich_text || []).map(function (t) { return t.plain_text; }).join('');
}

function blockToText(b) {
  var t = b.type;
  var d = b[t] || {};
  switch (t) {
    case 'paragraph': return plainOf(d);
    case 'heading_1':
    case 'heading_2':
    case 'heading_3': return '# ' + plainOf(d);
    case 'bulleted_list_item':
    case 'numbered_list_item': return '- ' + plainOf(d);
    case 'to_do': return (d.checked ? '[x] ' : '[ ] ') + plainOf(d);
    case 'quote':
    case 'callout': return '> ' + plainOf(d);
    case 'divider': return '---';
    case 'code':
    case 'toggle': return plainOf(d);
    default: return null;
  }
}

// ---------- plain text -> Notion blocks ----------
function rich(content) {
  if (!content) return [];
  var parts = content.match(/[\s\S]{1,2000}/g) || [];
  return parts.map(function (p) { return { type: 'text', text: { content: p } }; });
}

function blk(type, data) {
  var b = { object: 'block', type: type };
  b[type] = data;
  return b;
}

function lineToBlock(line) {
  if (line.trim() === '---') return blk('divider', {});
  var m;
  if ((m = line.match(/^#{1,3}\s+(.*)$/))) return blk('heading_2', { rich_text: rich(m[1]) });
  if ((m = line.match(/^\[( |x|X)?\]\s+(.*)$/))) return blk('to_do', { rich_text: rich(m[2]), checked: /x/i.test(m[1] || '') });
  if ((m = line.match(/^[-*]\s+(.*)$/))) return blk('bulleted_list_item', { rich_text: rich(m[1]) });
  if ((m = line.match(/^>\s+(.*)$/))) return blk('quote', { rich_text: rich(m[1]) });
  return blk('paragraph', { rich_text: rich(line) });
}

function textToBlocks(text) {
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  var blocks = [];
  var prevBlank = false;
  lines.forEach(function (raw) {
    var line = raw.replace(/\s+$/, '');
    if (line === '') {
      if (!prevBlank && blocks.length) blocks.push(blk('paragraph', { rich_text: [] }));
      prevBlank = true;
      return;
    }
    prevBlank = false;
    blocks.push(lineToBlock(line));
  });
  while (blocks.length && blocks[blocks.length - 1].type === 'paragraph' &&
    !blocks[blocks.length - 1].paragraph.rich_text.length) blocks.pop();
  return blocks;
}

// ---------- handlers ----------
async function handleGet(req, res, token) {
  var id = PAGES[String(req.query.m || '')];
  if (!id) { res.status(400).json({ error: 'unknown market' }); return; }

  var got = await listChildren(id, token);
  if (!got.ok) { res.status(502).json({ error: 'notion_' + got.status }); return; }

  var text = got.blocks
    .map(blockToText)
    .filter(function (t) { return t !== null; })
    .join('\n');
  res.setHeader('Cache-Control', 's-maxage=30');
  res.status(200).json({ text: text });
}

async function handleSave(req, res, token) {
  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  if (!process.env.EDIT_KEY) { res.status(403).json({ error: 'edit_disabled' }); return; }
  var key = req.headers['x-edit-key'] || body.key;
  if (key !== process.env.EDIT_KEY) { res.status(401).json({ error: 'bad_key' }); return; }

  var id = PAGES[String(body.m || '')];
  if (!id) { res.status(400).json({ error: 'unknown market' }); return; }

  var got = await listChildren(id, token);
  if (!got.ok) { res.status(502).json({ error: 'notion_' + got.status }); return; }

  for (var i = 0; i < got.blocks.length; i++) {
    var del = await nfetch('/blocks/' + got.blocks[i].id, 'DELETE', null, token);
    if (!del.ok) { res.status(502).json({ error: 'notion_' + del.status }); return; }
  }

  var blocks = textToBlocks(body.text);
  for (var j = 0; j < blocks.length; j += 90) {
    var add = await nfetch('/blocks/' + id + '/children', 'PATCH',
      { children: blocks.slice(j, j + 90) }, token);
    if (!add.ok) { res.status(502).json({ error: 'notion_' + add.status }); return; }
  }

  res.status(200).json({ ok: true });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  var token = process.env.NOTION_TOKEN;
  if (!token) { res.status(503).json({ error: 'not_connected' }); return; }

  try {
    if (req.method === 'POST') { await handleSave(req, res, token); return; }
    await handleGet(req, res, token);
  } catch (e) {
    res.status(502).json({ error: 'fetch_failed' });
  }
};
