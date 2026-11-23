import { formatTimer } from './audio-engine.js';
import { deleteTake, loadTakes, saveTake, TAKE_CAPACITY } from './take-store.js';

export function mountTakes(beforePlayback, onLibraryChange) {
  const element = (id) => document.getElementById(id);
  const list = element('takeList');
  const empty = element('takesEmpty');
  const message = element('takeMessage');
  const player = element('takePlayer');
  const audio = element('takeAudio');
  const toggle = element('playerToggle');
  const seek = element('playerSeek');
  const speed = element('playerSpeed');
  const wave = element('playerWave');
  const progress = element('playerProgress');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const dialog = element('deleteDialog');
  const records = new Map();
  const date = new Intl.DateTimeFormat(document.documentElement.lang, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  let selected;
  let deleting;
  let playbackRequest = 0;
  let playbackFrame = 0;

  function updatePlayer() {
    if (!selected) return;
    const { duration } = selected.take;
    const position = Math.min(audio.currentTime, duration);
    element('playerTime').textContent = formatTimer(position);
    seek.setAttribute('aria-valuetext', `${position.toFixed(1)} of ${duration.toFixed(1)} seconds`);
    if (document.activeElement !== seek || !audio.paused) seek.value = position;
    updateProgress(position);
    toggle.textContent = audio.paused ? 'Play' : 'Pause';
  }

  function updateProgress(position) {
    const ratio = Math.min(1, position / selected.take.duration);
    progress.style.transform = `scaleX(${ratio})`;
  }

  function animatePlayer() {
    if (document.activeElement !== seek) seek.value = audio.currentTime;
    if (!audio.paused) {
      updateProgress(audio.currentTime);
      if (!reduceMotion.matches) playbackFrame = requestAnimationFrame(animatePlayer);
    }
  }

  function stopPlayer(restoreFocus = false) {
    playbackRequest++;
    cancelAnimationFrame(playbackFrame);
    audio.pause();
    if (restoreFocus) selected?.open.focus();
    selected?.open.setAttribute('aria-expanded', 'false');
    selected = null;
    audio.removeAttribute('src');
    audio.load();
    player.hidden = true;
    player.removeAttribute('data-open');
  }

  function play() {
    if (!selected) return;
    beforePlayback();
    const request = ++playbackRequest;
    return audio.play().catch(() => {
      if (request === playbackRequest) message.textContent = 'Could not play this take. Try downloading it.';
    });
  }

  function openPlayer(record) {
    message.textContent = '';
    if (selected !== record) {
      stopPlayer();
      selected = record;
      player.hidden = false;
      player.setAttribute('data-open', '');
      record.open.setAttribute('aria-expanded', 'true');
      element('playerTitle').textContent = record.name;
      element('playerDuration').textContent = formatTimer(record.take.duration);
      const values = record.take.peaks ?? [];
      const peak = Math.max(1, ...values);
      wave.replaceChildren(...Array.from(values, (value) => {
        const bar = document.createElement('span');
        bar.style.transform = `scaleY(${Math.max(.08, value / peak)})`;
        return bar;
      }));
      seek.max = record.take.duration;
      seek.value = 0;
      audio.src = record.url;
      audio.playbackRate = Number(speed.value);
      updatePlayer();
    }
    toggle.focus();
    play();
  }

  function button(text) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'button compact';
    control.textContent = text;
    return control;
  }

  function insert(take, temporary = false, fresh = false) {
    if (records.has(take.id)) return;
    const row = document.createElement('li');
    row.className = 'take-row';
    row.toggleAttribute('data-new', fresh);
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.className = 'take-name';
    const name = `Take · ${date.format(take.createdAt)}`;
    title.textContent = name;
    const duration = document.createElement('span');
    duration.className = 'take-length';
    duration.textContent = `${formatTimer(take.duration)}${temporary ? ' · Unsaved' : ''}`;
    info.append(title, duration);

    const controls = document.createElement('div');
    const open = button('Play take');
    open.setAttribute('aria-controls', 'takePlayer');
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-label', `Play take from ${date.format(take.createdAt)}`);
    const download = document.createElement('a');
    download.className = 'take-download';
    download.textContent = 'Download';
    const url = URL.createObjectURL(take.blob);
    download.href = url;
    download.download = `echoback-${new Date(take.createdAt).toISOString().replaceAll(':', '-')}.wav`;
    if (temporary) download.addEventListener('click', () => {
      record.downloaded = true;
      onLibraryChange();
    });
    const remove = button('Delete');
    remove.setAttribute('aria-label', `Delete take from ${date.format(take.createdAt)}`);
    controls.append(open, download, remove);
    row.append(info, controls);

    const record = { take, name, row, open, url, temporary };
    records.set(take.id, record);
    open.addEventListener('click', () => openPlayer(record));
    remove.addEventListener('click', () => {
      deleting = record;
      dialog.returnValue = 'cancel';
      dialog.showModal();
    });
    list.prepend(row);
    empty.hidden = true;
  }

  dialog.addEventListener('close', async () => {
    const record = deleting;
    if (!record || dialog.returnValue !== 'delete') return;
    try {
      if (!record.temporary) await deleteTake(record.take.id);
      const next = record.row.nextElementSibling || record.row.previousElementSibling;
      const restoreFocus = record.row.contains(document.activeElement)
        || (selected === record && player.contains(document.activeElement));
      if (selected === record) stopPlayer();
      records.delete(record.take.id);
      record.row.remove();
      URL.revokeObjectURL(record.url);
      empty.hidden = records.size > 0;
      if (restoreFocus) (next?.querySelector('button') || element('takesHeading')).focus();
      message.textContent = 'Take deleted.';
      onLibraryChange();
    } catch {
      message.textContent = 'Could not delete the take. Try again.';
    }
  });

  toggle.addEventListener('click', () => {
    if (audio.paused) play();
    else audio.pause();
  });
  element('playerClose').addEventListener('click', () => stopPlayer(true));
  seek.addEventListener('input', () => {
    audio.currentTime = Number(seek.value);
    updatePlayer();
  });
  seek.addEventListener('blur', updatePlayer);
  speed.addEventListener('change', () => { audio.playbackRate = Number(speed.value); });
  audio.addEventListener('play', () => {
    cancelAnimationFrame(playbackFrame);
    animatePlayer();
  });
  for (const event of ['timeupdate', 'pause', 'ended', 'loadedmetadata', 'seeked']) {
    audio.addEventListener(event, updatePlayer);
  }

  empty.setAttribute('data-loading', '');
  const initial = loadTakes().then((takes) => {
    takes.sort((a, b) => a.createdAt - b.createdAt).forEach((take) => insert(take));
    empty.textContent = 'No takes yet. Start echo and choose Record take.';
  }).catch(() => {
    empty.textContent = 'Saved takes could not be loaded. You can still record and download a take.';
  }).finally(() => empty.removeAttribute('data-loading'));

  return {
    pause() { playbackRequest++; audio.pause(); },
    async add(recording) {
      await initial;
      if (!recording) return 'No audio was captured. Try recording again.';
      const take = { ...recording, id: crypto.randomUUID(), createdAt: Date.now() };
      let saved = false;
      let notice = 'Take saved. Open Takes to listen back.';
      try {
        saved = await saveTake(take);
        if (!saved) notice = `The library holds ${TAKE_CAPACITY} takes. Download this take before leaving.`;
      } catch {
        notice = 'Could not save this take. Download it before leaving.';
      }
      // Keep only the current unsaved file in memory. A previous download
      // already lives on disk and has no copy in IndexedDB.
      if (!saved) {
        for (const [id, record] of records) {
          if (!record.temporary || !record.downloaded) continue;
          if (selected === record) stopPlayer();
          record.row.remove();
          URL.revokeObjectURL(record.url);
          records.delete(id);
        }
      }
      insert(take, !saved, true);
      return notice;
    },
    canRecord: () => ![...records.values()].some((record) => record.temporary && !record.downloaded),
  };
}
