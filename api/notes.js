// Vercel serverless function: reads a market's notes from its Notion
// page and returns them as HTML the site can drop into the Notes panel.
// Needs NOTION_TOKEN set in Vercel env (internal integration secret),
// and the Market Screen Notes database shared with that integration.

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

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function richText(rt) {
  return (rt || []).map(function (t) {
    var text = esc(t.plain_text);
    if (t.annotations) {
      if (t.annotations.code) text = '<code>' + text + '</code>';
      if (t.annotations.bold) text = '<strong>' + text + '</strong>';
      if (t.annotations.italic) text = '<em>' + text + '</em>';
      if (t.annotations.strikethrough) text = '<s>' + text + '</s>';
    }
    if (t.href) text = '<a href="' + esc(t.href) + '" target="_blank" rel="noopener">' + text + '</a>';
    return text;
  }).join('');
}

function blockToHtml(b) {
  var t = b.type;
  var d = b[t] || {};
  switch (t) {
    case 'paragraph': {
      var p = richText(d.rich_text);
      return p ? '<p>' + p + '</p>' : '<p class="gap"></p>';
    }
    case 'heading_1': return '<h5>' + richText(d.rich_text) + '</h5>';
    case 'heading_2': return '<h5>' + richText(d.rich_text) + '</h5>';
    case 'heading_3': return '<h6>' + richText(d.rich_text) + '</h6>';
    case 'bulleted_list_item': return '<li>' + richText(d.rich_text) + '</li>';
    case 'numbered_list_item': return '<li class="nli">' + richText(d.rich_text) + '</li>';
    case 'to_do':
      return '<div class="todo' + (d.checked ? ' done' : '') + '">' +
        (d.checked ? '&#9746;' : '&#9744;') + ' ' + richText(d.rich_text) + '</div>';
    case 'quote': return '<blockquote>' + richText(d.rich_text) + '</blockquote>';
    case 'callout': return '<blockquote>' + richText(d.rich_text) + '</blockquote>';
    case 'divider': return '<hr>';
    case 'code': return '<pre>' + richText(d.rich_text) + '</pre>';
    case 'toggle': return '<p>' + richText(d.rich_text) + '</p>';
    default: return '';
  }
}

// wrap consecutive <li> runs in <ul>
function assemble(parts) {
  var out = [];
  var inList = false;
  parts.forEach(function (p) {
    if (!p) return;
    var isLi = p.indexOf('<li') === 0;
    if (isLi && !inList) { out.push('<ul>'); inList = true; }
    if (!isLi && inList) { out.push('</ul>'); inList = false; }
    out.push(p);
  });
  if (inList) out.push('</ul>');
  return out.join('\n');
}

module.exports = async function handler(req, res) {
  var token = process.env.NOTION_TOKEN;
  var id = PAGES[String(req.query.m || '')];

  // errors must not stick in the edge cache
  res.setHeader('Cache-Control', 'no-store');

  if (!id) { res.status(400).json({ error: 'unknown market' }); return; }
  if (!token) { res.status(503).json({ error: 'not_connected' }); return; }

  try {
    var blocks = [];
    var cursor = null;
    do {
      var url = 'https://api.notion.com/v1/blocks/' + id + '/children?page_size=100' +
        (cursor ? '&start_cursor=' + cursor : '');
      var r = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Notion-Version': '2022-06-28',
        },
      });
      if (!r.ok) {
        var status = r.status === 404 || r.status === 403 ? 502 : 502;
        res.status(status).json({ error: 'notion_' + r.status });
        return;
      }
      var body = await r.json();
      blocks = blocks.concat(body.results || []);
      cursor = body.has_more ? body.next_cursor : null;
    } while (cursor);

    var html = assemble(blocks.map(blockToHtml));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({ html: html });
  } catch (e) {
    res.status(502).json({ error: 'fetch_failed' });
  }
};
