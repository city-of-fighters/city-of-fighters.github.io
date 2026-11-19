// The sponsors at the top of the app's pages (put <div id="sponsorBar" hidden></div> where they go). Each logo opens the
// sponsor's website when the Sponsors tab has one. Needs api.js (rpc, esc).
(async () => {
  const box = document.getElementById('sponsorBar');
  const list = box ? await rpc('cof_sponsors_list').catch(() => []) : [];
  if (!list.length) return;
  box.innerHTML = '<div class="sb-t">Our sponsors</div><div class="sb-row">' + list.map(s => {
    const img = `<img src="${esc(s.logo)}" alt="${esc(s.name)}" title="${esc(s.name)}"${s.tall ? ' class="tall"' : ''}>`;
    return /^https?:\/\//.test(s.link ?? '') ? `<a href="${esc(s.link)}" target="_blank" rel="noopener sponsored">${img}</a>` : `<span>${img}</span>`;
  }).join('') + '</div>';
  box.hidden = false;
})();
