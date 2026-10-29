// Draws the bracket as HTML (styles in bracket.css). Used by the control panel and the OBS bracket page.
// With prev (the matches from the last draw), players who just moved in and fresh results get animated.
const knockedOut = (S, m, id) => m.winner && !m.auto && m.loser === id &&
  (m.side === 'L' || (m.side === 'W' && S.format === 'single') || m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a));

function bracketHTML(S, prev) {
  const before = prev ? new Map(prev.map(m => [m.id, m])) : null;
  const slot = (m, s) => {
    const id = m[s], won = m.winner && !m.auto && m.winner === id, out = knockedOut(S, m, id);
    const p = before?.get(m.id), real = id && id !== 'BYE';
    const cls = [won && 'win', out && 'out', !real && 'dim',
      real && p && p[s] !== id && 'new',                 // just moved into this spot
      (won || out) && p && !p.winner && 'fresh'].filter(Boolean).join(' ');
    const name = id === 'BYE' ? 'bye' : (s === 'a' ? m.aName : m.bName) ?? 'TBD';
    return `<div class="bs ${cls}"><span>${out ? '✕ ' : ''}${esc(name)}</span><b>${m.winner && !m.auto ? m['g' + s] : ''}</b></div>`;
  };
  const box = m => m.a === 'BYE' && m.b === 'BYE'
    ? '<div class="bm gone"></div>'
    : `<div class="bm${m.id === S.streamMatch ? ' live' : ''}${m.ready ? ' ready' : ''}">${slot(m, 'a')}${slot(m, 'b')}</div>`;
  const side = s => {
    const ms = S.matches.filter(m => m.side === s);
    const rounds = [...new Set(ms.map(m => m.round))].sort((x, y) => x - y);
    return rounds.map(r => {
      const col = ms.filter(m => m.round === r);
      return `<div class="bcol"><div class="bhead">${esc(col[0].label)}</div><div class="bstack">${col.map(box).join('')}</div></div>`;
    }).join('');
  };
  const part = (title, inner) => `<div class="bpart"><h3>${title}</h3><div class="brow">${inner}</div></div>`;
  if (S.matches.some(m => m.side === 'R')) return `<div class="bracket">${part('Rounds', side('R'))}</div>`; // round robin / Swiss
  if (S.format === 'single') return `<div class="bracket">${part('Bracket', side('W'))}</div>`;
  const gf = S.matches.filter(m => m.side === 'GF' && !m.skipped && (m.id === 'GF1' || m.a));
  return `<div class="bracket">${part('Winners', side('W'))}${part('Losers', side('L'))}
    ${part('Finals', gf.map(m => `<div class="bcol"><div class="bhead">${esc(m.label)}</div><div class="bstack">${box(m)}</div></div>`).join(''))}</div>`;
}

// Phone bracket: pick a round from buttons that wrap onto new lines, then see that round's matches as a list,
// so nothing scrolls sideways. sel is the chosen round's key; by default the first round still being played.
function bracketRounds(S) {
  const groups = new Map();
  for (const m of S.matches) {
    if (m.skipped || m.a === 'BYE' || m.b === 'BYE' || (m.id === 'GF2' && !m.a)) continue; // byes aren't real matches; the reset only once it's on
    const key = m.side === 'GF' ? m.id : `${m.side}${m.round}`;
    if (!groups.has(key)) groups.set(key, { key, label: m.label, matches: [] });
    groups.get(key).matches.push(m);
  }
  const order = { W: 0, R: 0, L: 1, GF: 2 };
  return [...groups.values()].sort((x, y) => order[x.matches[0].side] - order[y.matches[0].side] || x.matches[0].round - y.matches[0].round);
}

function mobileBracketHTML(S, sel) {
  const rounds = bracketRounds(S);
  if (!rounds.length) return '<p class="dim">Not started yet.</p>';
  const open = r => r.matches.some(m => !m.winner);
  const cur = rounds.find(r => r.key === sel) ?? rounds.find(open) ?? rounds.at(-1);
  const label = id => S.matches.find(x => x.id === id)?.label;
  const row = (m, s) => {
    const id = m[s], won = m.winner && !m.auto && m.winner === id, out = knockedOut(S, m, id);
    const name = id === 'BYE' ? 'bye' : (s === 'a' ? m.aName : m.bName) ?? 'TBD';
    return `<div class="mrow${won ? ' win' : ''}${out ? ' out' : ''}${!id || id === 'BYE' ? ' dim' : ''}"><span>${out ? '✕ ' : ''}${esc(name)}</span><b>${m.winner && !m.auto ? m['g' + s] : (m.ga || m.gb) && !m.winner ? m['g' + s] : ''}</b></div>`;
  };
  const badge = m => m.id === S.streamMatch && !m.winner ? '<i class="mb live">● LIVE</i>' : m.winner ? '<i class="mb">Done</i>'
    : m.ready ? (m.ga || m.gb ? '<i class="mb ready">Playing</i>' : '<i class="mb ready">Ready</i>') : '<i class="mb">Waiting</i>';
  const card = (m, i) => `<div class="mcard${m.id === S.streamMatch && !m.winner ? ' live' : ''}">
    <div class="mhead"><span>Match ${i + 1}</span>${badge(m)}</div>${row(m, 'a')}${row(m, 'b')}
    ${m.winTo || m.loseTo ? `<div class="mnext">${m.winTo ? `Winner → ${esc(label(m.winTo.id))}` : ''}${m.winTo && m.loseTo ? ' · ' : ''}${m.loseTo ? `Loser → ${esc(label(m.loseTo.id))}` : ''}</div>` : ''}</div>`;
  return `<div class="mchips">${rounds.map(r => `<button type="button" class="mchip${r === cur ? ' on' : ''}${open(r) ? '' : ' done'}" data-round="${r.key}">${esc(r.label)}</button>`).join('')}</div>
    <div class="mlist">${cur.matches.map(card).join('')}</div>`;
}
