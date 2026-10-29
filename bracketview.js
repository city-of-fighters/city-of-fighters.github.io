// Draws the bracket as HTML (styles in bracket.css). Used by the control panel and the OBS bracket page.
// With prev (the matches from the last draw), players who just moved in and fresh results get animated.
const knockedOut = (m, id) => m.winner && !m.auto && m.loser === id &&
  (m.side === 'L' || m.id === 'GF2' || (m.id === 'GF1' && m.winner === m.a));

function bracketHTML(S, prev) {
  const before = prev ? new Map(prev.map(m => [m.id, m])) : null;
  const slot = (m, s) => {
    const id = m[s], won = m.winner && !m.auto && m.winner === id, out = knockedOut(m, id);
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
  const gf = S.matches.filter(m => m.side === 'GF' && !m.skipped && (m.id === 'GF1' || m.a));
  return `<div class="bracket">
    <div class="bpart"><h3>Winners</h3><div class="brow">${side('W')}</div></div>
    <div class="bpart"><h3>Losers</h3><div class="brow">${side('L')}</div></div>
    <div class="bpart"><h3>Finals</h3><div class="brow">${gf.map(m => `<div class="bcol"><div class="bhead">${esc(m.label)}</div><div class="bstack">${box(m)}</div></div>`).join('')}</div></div>
  </div>`;
}
