// Independent, user-selected financial video sources; no Yahoo stream or proprietary endpoint.
import { registerPanel, esc, state as ui } from '../core.js';
export function videoSource(value) {
  let u; try { u = new URL(String(value).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  let id = null;
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
    id = u.searchParams.get('v') || u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
  } else if (host === 'youtu.be' || host === 'www.youtu.be') id = u.pathname.slice(1).split('/')[0];
  if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return { url: u.href, type: 'embed', player: `https://www.youtube-nocookie.com/embed/${id}?rel=0`, publisher: 'YouTube' };
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const vimeo = u.pathname.match(/^\/(?:video\/)?([0-9]+)\/?$/)?.[1];
    if (vimeo) return { url: u.href, type: 'embed', player: `https://player.vimeo.com/video/${vimeo}`, publisher: 'Vimeo' };
  }
  if (/\.(mp4|webm|ogv|ogg)$/i.test(u.pathname)) return { url: u.href, type: 'video', player: u.href, publisher: host };
  return { url: u.href, type: 'external', publisher: host };
}
registerPanel('market-video', {
  title: 'Market Video', category: 'News', defaultSize: { w: 6, h: 11 },
  mount(el, ctx) {
    let source = videoSource(ctx.state.url || ''), active = false, error = '';
    el.classList.add('p-video');
    function render() {
      el.innerHTML = `<form class="p-video-form"><label>Video or publisher URL<input class="s-input" type="url" name="url" value="${esc(source?.url || ctx.state.url || '')}" placeholder="Paste a video or publisher channel link" required maxlength="2000" aria-label="Video or publisher URL"></label><button class="s-btn s-btn-sm" type="submit">Use source</button></form>${error ? `<p class="p-video-error s-down" role="alert">${esc(error)}</p>` : ''}
        <p class="p-video-note">Independent source selected by you. Video availability and embedding depend on the publisher.</p>
        <div class="p-video-player">${!source ? ui.empty('Add a direct MP4/WebM video, a YouTube or Vimeo video, or a financial publisher’s channel link.') : active && source.type === 'embed' ? `<iframe src="${esc(source.player)}" title="Market video from ${esc(source.publisher)}" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>` : active && source.type === 'video' ? `<video controls playsinline preload="metadata" src="${esc(source.player)}" aria-label="Market video player"></video>` : `<div class="p-video-cover"><strong>${esc(source.publisher)}</strong><p>${source.type === 'external' ? 'This publisher page opens on its own site. An embedded player is not available for this URL.' : 'Load this publisher’s video player to watch here.'}</p>${source.type !== 'external' ? '<button class="s-btn s-btn-primary" type="button" data-video-play>Load player</button>' : ''}</div>`}</div>
        ${source ? `<div class="p-video-actions"><a class="s-btn s-btn-ghost s-btn-sm" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">Open ${esc(source.publisher)} ↗</a>${active ? '<button type="button" class="s-btn s-btn-ghost s-btn-sm" data-video-stop>Unload player</button>' : ''}<button type="button" class="s-btn s-btn-ghost s-btn-sm" data-video-clear>Remove source</button></div>` : ''}`;
      el.querySelector('video')?.addEventListener('error', () => { error = 'The publisher could not load this video. Open the source link or choose another URL.'; active = false; render(); }, { once: true });
    }
    function submit(e) {
      e.preventDefault(); const value = e.target.elements.url.value; const parsed = videoSource(value);
      if (!parsed) { error = 'Enter a valid HTTP or HTTPS video or publisher URL.'; return render(); }
      source = parsed; active = false; error = ''; ctx.setState({ url: parsed.url }); render();
    }
    function click(e) {
      if (e.target.closest('[data-video-play]')) { active = true; error = ''; render(); }
      if (e.target.closest('[data-video-stop]')) { active = false; render(); }
      if (e.target.closest('[data-video-clear]')) { source = null; active = false; error = ''; ctx.setState({ url: '' }); render(); }
    }
    el.addEventListener('submit', submit); el.addEventListener('click', click); render();
    return { scoutContext: () => source ? `User-selected video source: ${source.url}. Video content has not been retrieved or transcribed.` : 'No video source selected.', destroy() { el.querySelector('video')?.pause(); el.innerHTML = ''; el.removeEventListener('submit', submit); el.removeEventListener('click', click); } };
  }
});
