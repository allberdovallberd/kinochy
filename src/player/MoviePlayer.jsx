import { ArrowUpDown, Cast, Check, Expand, Gauge, Grid2x2, Pause, Play, Settings, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { withBasePath } from '../paths.js';
import { useLocale } from '../ui/locale.jsx';

const fontMap = {
  Verdana: 'Verdana, Geneva, sans-serif',
  Museo: 'Inter, Segoe UI, Arial, sans-serif',
  'PT Serif': '"Times New Roman", Georgia, serif'
};

export default function MoviePlayer({ movie, subtitles }) {
  const { t } = useLocale();
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const listRef = useRef(null);
  const liveSubtitleRef = useRef(null);
  const hoverRef = useRef('');
  const previewCleanup = useRef(null);
  const translationCache = useRef(new Map());
  const lastTimeUiRef = useRef(0);
  const lookupRequestRef = useRef(0);
  const playTimeoutRef = useRef(null);
  const seekTimerRef = useRef(null);
  const hlsRef = useRef(null);
  const lastStageToggleRef = useRef(0);
  const progressSaveRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const controlsTimerRef = useRef(null);
  const pageUnloadingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [playRequested, setPlayRequested] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [realtimeEnglish, setRealtimeEnglish] = useState(true);
  const [realtimeRussian, setRealtimeRussian] = useState(false);
  const [pausedRussian, setPausedRussian] = useState(false);
  const [pausedGrid, setPausedGrid] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playerToolsOpen, setPlayerToolsOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [subtitleStyle, setSubtitleStyle] = useState({
    en: 30,
    ru: 25,
    gap: 15,
    background: 50,
    enColor: '#ffffff',
    ruColor: '#f4d979',
    font: 'Museo'
  });
  const [lookup, setLookup] = useState(null);
  const [hoveredWord, setHoveredWord] = useState(null);
  const [previewPinnedIndex, setPreviewPinnedIndex] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voicePrefs, setVoicePrefs] = useState({ accent: 'us' });
  const [liveSubtitleHeight, setLiveSubtitleHeight] = useState(0);
  const [liveOverlayCover, setLiveOverlayCover] = useState(0);
  const [playerToggles, setPlayerToggles] = useState({
    pauseOnHover: false,
    previousReplica: false,
    pauseBetweenLines: false,
    pauseScript: true
  });
  const compactPlayer = useCompactPlayer();

  const english = subtitles.en || [];
  const russian = subtitles.ru || [];
  const activeIndex = useMemo(() => findActiveIndex(english, currentTime), [english, currentTime]);
  const nearestIndex = useMemo(() => findNearestCueIndex(english, currentTime), [english, currentTime]);
  const scrollIndex = previewPinnedIndex ?? (activeIndex >= 0 ? activeIndex : nearestIndex);
  const activeEnglish = activeIndex >= 0 ? english[activeIndex] : null;
  const activeRussian = findCueAtTime(russian, currentTime);
  const paused = !playing;
  const showPausedList = paused && hasStarted && currentTime >= 3 && playerToggles.pauseScript;
  const liveOverlayActive = Boolean((realtimeEnglish && activeEnglish) || (realtimeRussian && activeRussian));
  const fontFamily = fontMap[subtitleStyle.font] || fontMap.Museo;
  const videoSource = useMemo(() => withBasePath(`/media/movies/${movie.id}/video`), [movie.id]);
  const hlsSource = useMemo(() => withBasePath(`/media/movies/${movie.id}/playlist.m3u8`), [movie.id]);
  const prefersHls = String(movie.fileNames?.video || '').toLowerCase().endsWith('.ts');
  const showPlayerLoader = videoLoading && (playing || playRequested);
  const controlsPinned = settingsOpen || playerToolsOpen || volumeOpen;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let hls;
    let disposed = false;
    hlsRef.current = null;
    setVideoLoading(false);
    setPlayRequested(false);
    resumeAppliedRef.current = false;

    const loadHls = async () => {
      let Hls;
      try {
        ({ default: Hls } = await import('hls.js'));
      } catch {
        return;
      }
      if (disposed) return;
      setVideoLoading(true);
      if (Hls.isSupported()) {
        const compactConfig = isCompactPlayback()
          ? {
              backBufferLength: 2,
              maxBufferLength: 4,
              maxMaxBufferLength: 6,
              maxBufferSize: 4 * 1000 * 1000
            }
          : {
              backBufferLength: 8,
              maxBufferLength: 8,
              maxMaxBufferLength: 12,
              maxBufferSize: 12 * 1000 * 1000
            };
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          startPosition: -1,
          ...compactConfig,
          startFragPrefetch: false
        });
        hlsRef.current = hls;
        hls.loadSource(hlsSource);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = hlsSource;
        video.load();
      }
    };

    video.preload = 'metadata';
    if (prefersHls) {
      loadHls();
    } else {
      video.src = videoSource;
      video.load();
    }

    return () => {
      disposed = true;
      window.clearTimeout(playTimeoutRef.current);
      window.clearTimeout(seekTimerRef.current);
      hls?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [hlsSource, prefersHls, videoSource]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    revealControls(controlsPinned);
    return () => window.clearTimeout(controlsTimerRef.current);
  }, [controlsPinned]);

  useEffect(() => {
    const synth = getSpeechSynthesis();
    if (!synth) {
      setVoices([]);
      return undefined;
    }
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    pageUnloadingRef.current = false;
    const saveForRefresh = () => {
      pageUnloadingRef.current = true;
      saveMovieProgress(movie.id, videoRef.current?.currentTime, videoRef.current?.duration);
    };
    window.addEventListener('pagehide', saveForRefresh);
    window.addEventListener('beforeunload', saveForRefresh);
    return () => {
      if (pageUnloadingRef.current) {
        saveMovieProgress(movie.id, videoRef.current?.currentTime, videoRef.current?.duration);
      } else {
        clearMovieProgress(movie.id);
      }
      window.removeEventListener('pagehide', saveForRefresh);
      window.removeEventListener('beforeunload', saveForRefresh);
    };
  }, [movie.id]);

  useEffect(() => () => cleanupPreview(), []);

  useEffect(() => {
    const closeFromOutside = (event) => {
      const target = event.target;
      if (target?.closest?.('.word-card, .subtitle-settings, .player-tools-panel, .player-controls, .word-token')) return;
      closePanels();
    };
    const closeOnScroll = () => closePanels();

    document.addEventListener('pointerdown', closeFromOutside);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
      if (event.code === 'Space') {
        event.preventDefault();
        revealControls();
        togglePlay();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        revealControls();
        jumpBy(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        revealControls();
        jumpBy(5);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playing, duration]);

  useLayoutEffect(() => {
    if (!showPausedList) return;
    const list = listRef.current;
    const active = list?.querySelector('[data-scroll-active="true"]');
    if (!list || !active) return;
    const anchor = liveOverlayActive ? 0.18 : 0.28;
    const target = active.offsetTop - list.clientHeight * anchor;
    list.scrollTop = Math.max(0, target);
  }, [scrollIndex, showPausedList, pausedGrid, liveOverlayActive]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const element = liveSubtitleRef.current;
    if (!stage || !element || !showPausedList || !liveOverlayActive) {
      setLiveSubtitleHeight(0);
      setLiveOverlayCover(0);
      return;
    }

    const update = () => {
      const stageRect = stage.getBoundingClientRect();
      const liveRect = element.getBoundingClientRect();
      const nextHeight = liveRect.height || 0;
      const nextCover = Math.max(0, stageRect.bottom - liveRect.top);
      setLiveSubtitleHeight(nextHeight);
      setLiveOverlayCover(nextCover);
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showPausedList, liveOverlayActive, activeEnglish?.text, activeRussian?.text, realtimeEnglish, realtimeRussian, subtitleStyle.en, subtitleStyle.ru, subtitleStyle.font]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    closePanels();
    cleanupPreview();
    setPreviewPinnedIndex(null);
    if (video.paused) {
      setHasStarted(true);
      startPlayback(video);
    } else {
      setPlayRequested(false);
      setVideoLoading(false);
      video.pause();
    }
  }

  function seekTo(time, play = true) {
    const video = videoRef.current;
    closePanels();
    cleanupPreview();
    window.clearTimeout(seekTimerRef.current);
    setPreviewPinnedIndex(null);
    const next = seekVideo(video, time, play || playing, hlsRef.current);
    setCurrentTime(next);
    rememberProgress(next, video?.duration);
    if (play) {
      setHasStarted(true);
      startPlayback(video);
    }
  }

  function scrub(event) {
    closePanels();
    const value = Number(event.target.value);
    setCurrentTime(value);
    window.clearTimeout(seekTimerRef.current);
  }

  function commitScrub(event) {
    closePanels();
    const value = Number(event.target.value);
    const video = videoRef.current;
    window.clearTimeout(seekTimerRef.current);
    const next = seekVideo(video, value, true, hlsRef.current);
    setCurrentTime(next);
    rememberProgress(next, video?.duration);
    if (playing) setVideoLoading(needsMoreVideoData(video));
  }

  function commitScrubValue(value) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(value)) return;
    window.clearTimeout(seekTimerRef.current);
    const next = seekVideo(video, value, true, hlsRef.current);
    setCurrentTime(next);
    rememberProgress(next, video.duration);
    if (playing || playRequested) setVideoLoading(needsMoreVideoData(video));
  }

  function fullscreen() {
    const shell = videoRef.current?.closest('.player-shell');
    if (!shell) return;
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreenElement) {
      document.exitFullscreen?.();
      document.webkitExitFullscreen?.();
      return;
    }
    const request = shell.requestFullscreen?.() || shell.webkitRequestFullscreen?.();
    request?.catch?.(() => {});
  }

  function closePanels() {
    lookupRequestRef.current += 1;
    setLookup(null);
    setSettingsOpen(false);
    setPlayerToolsOpen(false);
    setVolumeOpen(false);
  }

  function revealControls(pinned = false) {
    setControlsVisible(true);
    window.clearTimeout(controlsTimerRef.current);
    if (pinned) return;
    controlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 5000);
  }

  function handlePlayerInteraction() {
    revealControls(controlsPinned);
  }

  function jumpBy(seconds) {
    const video = videoRef.current;
    if (!video) return;
    closePanels();
    cleanupPreview();
    window.clearTimeout(seekTimerRef.current);
    setPreviewPinnedIndex(null);
    const max = Number.isFinite(video.duration) ? video.duration : duration || 0;
    const next = Math.min(Math.max(video.currentTime + seconds, 0), max || Number.MAX_SAFE_INTEGER);
    const remembered = seekVideo(video, next, true, hlsRef.current);
    setCurrentTime(remembered);
    rememberProgress(remembered, video.duration);
    if (playing) setVideoLoading(needsMoreVideoData(video));
  }

  function playFromStage() {
    closePanels();
    togglePlay();
  }

  function handleStagePointerUp(event) {
    if (event.target?.closest?.('.paused-subtitles, .live-subtitles, .word-card, .player-loader, button, input, select')) return;
    event.preventDefault();
    lastStageToggleRef.current = Date.now();
    revealControls();
    playFromStage();
  }

  function handleStageClick() {
    if (Date.now() - lastStageToggleRef.current < 350) return;
    revealControls();
    playFromStage();
  }

  function handleLiveSubtitleClick(event) {
    if (event.target?.closest?.('.word-token, .word-card, button, input, select')) return;
    event.stopPropagation();
    lastStageToggleRef.current = Date.now();
    revealControls();
    togglePlay();
  }

  function handleTimeUpdate(event) {
    const next = event.currentTarget.currentTime;
    const now = performance.now();
    if (now - lastTimeUiRef.current < 180 && Math.abs(next - currentTime) < 0.35) return;
    lastTimeUiRef.current = now;
    setCurrentTime(next);
    rememberProgress(next, event.currentTarget.duration);
  }

  function restoreProgress(video) {
    if (!video || resumeAppliedRef.current) return;
    resumeAppliedRef.current = true;
    const saved = readSavedProgress(movie.id);
    if (!saved || saved < 3) return;
    const total = video.duration;
    if (Number.isFinite(total) && total > 0 && saved > total - 10) return;
    setCurrentTime(seekVideo(video, saved, false, hlsRef.current));
  }

  function rememberProgress(time, total) {
    if (!movie?.id || !Number.isFinite(time)) return;
    const now = Date.now();
    if (now - progressSaveRef.current < 1800) return;
    progressSaveRef.current = now;
    saveMovieProgress(movie.id, time, total);
  }

  function playCuePreview(cue, index, rate = 1) {
    const video = videoRef.current;
    if (!video || !cue) return;
    closePanels();
    cleanupPreview();
    window.clearTimeout(seekTimerRef.current);
    setPreviewPinnedIndex(index);
    setHasStarted(true);
    video.playbackRate = rate;
    setCurrentTime(seekVideo(video, cue.start, true, hlsRef.current));
    const stopAtEnd = () => {
      if (video.currentTime >= cue.end) {
        video.pause();
        video.playbackRate = 1;
        video.removeEventListener('timeupdate', stopAtEnd);
        previewCleanup.current = null;
      }
    };
    previewCleanup.current = () => {
      video.removeEventListener('timeupdate', stopAtEnd);
      video.playbackRate = 1;
    };
    video.addEventListener('timeupdate', stopAtEnd);
    startPlayback(video);
  }

  function startPlayback(video) {
    window.clearTimeout(playTimeoutRef.current);
    video.preload = 'auto';
    try {
      hlsRef.current?.startLoad?.(video.currentTime || 0);
    } catch {}
    setPlayRequested(true);
    setVideoLoading(needsMoreVideoData(video));
    playTimeoutRef.current = window.setTimeout(() => {
      if (video.paused && video.readyState < getMediaReadyState('HAVE_CURRENT_DATA', 2)) {
        setPlayRequested(false);
        setVideoLoading(false);
      }
    }, 12000);
    safePlay(video).finally(() => {
      window.clearTimeout(playTimeoutRef.current);
      if (!video.paused || video.readyState >= getMediaReadyState('HAVE_CURRENT_DATA', 2)) {
        setPlayRequested(false);
      }
    });
  }

  function cleanupPreview() {
    previewCleanup.current?.();
    previewCleanup.current = null;
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }

  async function openLookup(word, lang, event) {
    const cleanWord = normalizeLookupWord(word);
    if (!cleanWord) return;
    const target = lang === 'ru' ? 'en' : 'ru';
    const shell = event.currentTarget.closest('.player-shell').getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    const cardWidth = Math.min(360, shell.width - 32);
    const cardHeight = 310;
    const left = Math.min(Math.max(rect.left - shell.left - 12, 16), Math.max(16, shell.width - cardWidth - 16));
    const preferredTop = rect.top - shell.top - cardHeight - 12;
    const fallbackTop = rect.bottom - shell.top + 12;
    const top = preferredTop >= 12 ? preferredTop : Math.min(fallbackTop, Math.max(12, shell.height - cardHeight - 12));
    const position = { left, top };
    const requestId = lookupRequestRef.current + 1;
    lookupRequestRef.current = requestId;

    speakWord(cleanWord, lang, voices, voicePrefs);
    setLookup({ word: cleanWord, lang, targetLanguage: target, translation: '', loading: true, saving: false, saved: false, position });
    try {
      const result = await translateWord(cleanWord, lang, target);
      if (lookupRequestRef.current !== requestId) return;
      let saved = false;
      try {
        const check = await api(
          `/api/users/vocabulary/check?word=${encodeURIComponent(cleanWord)}&sourceLanguage=${encodeURIComponent(lang)}&targetLanguage=${encodeURIComponent(target)}`
        );
        saved = Boolean(check.entry);
      } catch {}
      if (lookupRequestRef.current !== requestId) return;
      setLookup({
        word: cleanWord,
        lang,
        targetLanguage: target,
        translation: result || 'Translation unavailable',
        loading: false,
        saving: false,
        saved,
        position
      });
    } catch {
      if (lookupRequestRef.current !== requestId) return;
      setLookup({
        word: cleanWord,
        lang,
        targetLanguage: target,
        translation: 'Translation unavailable',
        loading: false,
        saving: false,
        saved: false,
        position
      });
    }
  }

  async function saveLookupWord() {
    if (!lookup || lookup.loading) return;
    setLookup((current) => (current ? { ...current, saving: true } : current));
    try {
      await api('/api/users/vocabulary', {
        method: 'POST',
        body: JSON.stringify({
          word: lookup.word,
          translation: lookup.translation,
          sourceLanguage: lookup.lang,
          targetLanguage: lookup.targetLanguage
        })
      });
      setLookup((current) => (current ? { ...current, saving: false, saved: true, error: '' } : current));
    } catch {
      setLookup((current) => (current ? { ...current, saving: false, error: 'Could not save word. Please try again.' } : current));
    }
  }

  async function hoverWord(word, lang) {
    const cleanWord = normalizeLookupWord(word);
    if (!cleanWord) {
      hoverRef.current = '';
      setHoveredWord(null);
      return;
    }

    const contextText = arguments[2] || '';
    const pairText = arguments[3] || '';
    const target = lang === 'ru' ? 'en' : 'ru';
    const key = `${lang}:${target}:${cleanWord}:${normalizeLookupWord(contextText)}`;
    hoverRef.current = key;
    const cached = translationCache.current.get(key) || '';
    setHoveredWord({ sourceLang: lang, word: cleanWord, translation: cached, loading: !cached });
    if (cached) return;

    try {
      const phrases = buildPhraseCandidates(contextText, cleanWord);
      const translations = [];
      for (const phrase of phrases) {
        const translated = await translateWord(phrase, lang, target);
        translations.push(translated);
      }
      const translation = pickBestTranslation(translations, pairText) || translations[0] || '';
      translationCache.current.set(key, translation);
      if (hoverRef.current === key) setHoveredWord({ sourceLang: lang, word: cleanWord, translation, loading: false });
    } catch {
      if (hoverRef.current === key) setHoveredWord({ sourceLang: lang, word: cleanWord, translation: '', loading: false });
    }
  }

  async function translateWord(word, from, to) {
    const key = `${from}:${to}:${word}`;
    if (translationCache.current.has(key)) return translationCache.current.get(key);
    const result = await api(`/api/translate?text=${encodeURIComponent(word)}&from=${from}&to=${to}`);
    const translation = result.translation || '';
    translationCache.current.set(key, translation);
    return translation;
  }

  return (
    <section
      className={`player-shell ${controlsVisible || controlsPinned ? '' : 'controls-hidden'}`}
      onPointerMove={handlePlayerInteraction}
      onPointerDown={handlePlayerInteraction}
      onTouchStart={handlePlayerInteraction}
      style={{
        '--eng-size': subtitleStyle.en,
        '--ru-size': subtitleStyle.ru,
        '--sub-bg': subtitleStyle.background / 100,
        '--sub-bg-strong': Math.min(0.9, subtitleStyle.background / 100 + 0.16),
        '--live-overlay-height': `${liveSubtitleHeight}px`,
        '--live-overlay-cover': `${liveOverlayCover}px`,
        '--live-overlay-tail': `${Math.max(0, liveOverlayCover - liveSubtitleHeight)}px`,
        '--sub-gap': `${subtitleStyle.gap}px`,
        '--eng-color': subtitleStyle.enColor,
        '--ru-color': subtitleStyle.ruColor,
        '--subtitle-font': fontFamily
      }}
    >
      <div ref={stageRef} className="player-stage" onPointerUp={handleStagePointerUp} onClick={handleStageClick}>
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          disableRemotePlayback
          controlsList="nodownload noplaybackrate"
          onLoadStart={(event) => {
            if (!event.currentTarget.paused) setVideoLoading(true);
          }}
          onWaiting={(event) => {
            if (!event.currentTarget.paused || playRequested) setVideoLoading(true);
          }}
          onSeeking={(event) => {
            if (!event.currentTarget.paused || playRequested) setVideoLoading(true);
          }}
          onStalled={(event) => {
            if (!event.currentTarget.paused || playRequested) setVideoLoading(true);
          }}
          onError={() => {
            window.clearTimeout(playTimeoutRef.current);
            setPlayRequested(false);
            setVideoLoading(false);
          }}
          onCanPlay={() => setVideoLoading(false)}
          onCanPlayThrough={() => setVideoLoading(false)}
          onLoadedData={() => setVideoLoading(false)}
          onPlaying={() => {
            window.clearTimeout(playTimeoutRef.current);
            setPlaying(true);
            setPlayRequested(false);
            setVideoLoading(false);
          }}
          onPlay={() => {
            setHasStarted(true);
            setPlaying(true);
            setVideoLoading(false);
            closePanels();
          }}
          onPause={() => {
            window.clearTimeout(playTimeoutRef.current);
            saveMovieProgress(movie.id, videoRef.current?.currentTime, videoRef.current?.duration);
            setPlaying(false);
            setPlayRequested(false);
            setVideoLoading(false);
            closePanels();
          }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0);
            restoreProgress(event.currentTarget);
          }}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={handleTimeUpdate}
        />

        {showPlayerLoader ? (
          <div className="player-loader" aria-label="Loading movie">
            <span />
          </div>
        ) : null}

        {showPausedList ? (
          <SubtitleList
            cues={english}
            ru={russian}
            russianOn={pausedRussian}
            gridOn={pausedGrid}
            liveOverlayActive={liveOverlayActive}
            scrollIndex={scrollIndex}
          onPlay={() => {
              closePanels();
              togglePlay();
            }}
            onSelect={(cue) => {
              closePanels();
              seekTo(cue.start);
            }}
            onPreview={playCuePreview}
            listRef={listRef}
            onToggleRussian={() => setPausedRussian((value) => !value)}
            onToggleGrid={() => setPausedGrid((value) => !value)}
            toolbarOn={playerToggles.pauseScript}
            onLookup={openLookup}
            onHoverWord={hoverWord}
            hoveredWord={hoveredWord}
            compactMode={compactPlayer}
          />
        ) : null}

        {(realtimeEnglish && activeEnglish) || (realtimeRussian && activeRussian) ? (
          <div ref={liveSubtitleRef} className={`live-subtitles ${showPausedList ? 'over-paused-list' : ''}`} onClick={handleLiveSubtitleClick}>
            <div className="live-subtitles-inner">
              {realtimeEnglish && activeEnglish ? (
                <p className="live-en">
                  <InteractiveText
                    text={activeEnglish.text}
                    lang="en"
                    pairText={activeRussian?.text || ''}
                    onLookup={openLookup}
                    onHoverWord={hoverWord}
                    hoveredWord={hoveredWord}
                  />
                </p>
              ) : null}
              {realtimeRussian && activeRussian ? (
                <p className="live-ru">
                  <InteractiveText
                    text={activeRussian.text}
                    lang="ru"
                    pairText={activeEnglish?.text || ''}
                    onLookup={openLookup}
                    onHoverWord={hoverWord}
                    hoveredWord={hoveredWord}
                  />
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {lookup ? (
          <WordCard lookup={lookup} onClose={() => setLookup(null)} voices={voices} voicePrefs={voicePrefs} setVoicePrefs={setVoicePrefs} onSave={saveLookupWord} />
        ) : null}
      </div>

      <div className="timeline">
        <input
          type="range"
          min="0"
          max={Number.isFinite(duration) ? duration : 0}
          step="0.01"
          value={Math.min(currentTime, Number.isFinite(duration) ? duration : currentTime)}
          onInput={scrub}
          onChange={commitScrub}
          onPointerUp={(event) => commitScrubValue(Number(event.currentTarget.value))}
          onTouchEnd={(event) => commitScrubValue(Number(event.currentTarget.value))}
          onKeyUp={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
              commitScrubValue(Number(event.currentTarget.value));
            }
          }}
          style={{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` }}
          aria-label={t('player_seek')}
        />
      </div>

      <div className="player-controls">
        <div className="compact-stack">
          <button
            title={t('player_subtitle_style')}
            onClick={() =>
              setSubtitleStyle((value) => ({ ...value, en: Math.min(value.en + 1, 44), ru: Math.min(value.ru + 1, 40) }))
            }
          >
            +
          </button>
          <button
            title={t('player_subtitle_style')}
            onClick={() =>
              setSubtitleStyle((value) => ({ ...value, en: Math.max(value.en - 1, 18), ru: Math.max(value.ru - 1, 16) }))
            }
          >
            -
          </button>
        </div>
        <button className={settingsOpen ? 'active' : ''} title={t('player_subtitle_style')} onClick={() => setSettingsOpen((value) => !value)}>
          Aa
        </button>
        <button className={realtimeEnglish ? 'active' : ''} onClick={() => setRealtimeEnglish((value) => !value)}>
          EN
        </button>
        <button className={realtimeRussian ? 'active' : ''} onClick={() => setRealtimeRussian((value) => !value)}>
          RU
        </button>
        <button className="playbar" onClick={togglePlay} aria-label={playing ? t('player_pause') || 'Pause' : t('player_play') || 'Play'}>
          {playing ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
        </button>
        <span className="time-readout">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button className={playerToolsOpen ? 'active' : ''} title={t('player_tools')} onClick={() => setPlayerToolsOpen((value) => !value)}>
          <Settings size={22} />
        </button>
        <button className="cast-button" title={t('player_cast')}>
          <Cast size={21} />
        </button>
        <div className={`volume-control ${volumeOpen ? 'open' : ''}`}>
          <button title={t('player_volume')} onClick={() => setVolumeOpen((value) => !value)} aria-expanded={volumeOpen}>
            {volume <= 0 ? <VolumeX size={22} /> : volume < 0.45 ? <Volume1 size={22} /> : <Volume2 size={22} />}
          </button>
          <div className="volume-slider" onClick={(event) => event.stopPropagation()}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onInput={(event) => setVolume(Number(event.currentTarget.value))}
              onChange={(event) => setVolume(Number(event.currentTarget.value))}
              style={{ '--volume': `${volume * 100}%` }}
              aria-label={t('player_volume')}
            />
          </div>
        </div>
        <button title={t('player_fullscreen')} onClick={fullscreen}>
          <Expand size={22} />
        </button>
      </div>

      {settingsOpen ? <SubtitleSettings style={subtitleStyle} setStyle={setSubtitleStyle} /> : null}
      {playerToolsOpen ? (
        <PlayerToolsPanel
          toggles={playerToggles}
          setToggles={setPlayerToggles}
          playbackRate={playbackRate}
          setPlaybackRate={setPlaybackRate}
        />
      ) : null}
    </section>
  );
}

function SubtitleList({
  cues,
  ru,
  russianOn,
  gridOn,
  liveOverlayActive,
  scrollIndex,
  onPlay,
  onSelect,
  onPreview,
  listRef,
  onToggleRussian,
  onToggleGrid,
  toolbarOn,
  onLookup,
  onHoverWord,
  hoveredWord,
  compactMode
}) {
  const { t } = useLocale();
  const rowEstimate = gridOn ? 86 : russianOn ? 82 : 66;
  const shouldWindow = compactMode && cues.length > 140;
  const [windowCenter, setWindowCenter] = useState(scrollIndex);
  const scrollFrame = useRef(null);
  const radius = 46;
  const startIndex = shouldWindow ? Math.max(0, Math.min(cues.length - 1, windowCenter) - radius) : 0;
  const endIndex = shouldWindow ? Math.min(cues.length, startIndex + radius * 2 + 34) : cues.length;
  const visibleCues = shouldWindow ? cues.slice(startIndex, endIndex) : cues;
  const topSpacer = shouldWindow ? startIndex * rowEstimate : 0;
  const bottomSpacer = shouldWindow ? Math.max(0, cues.length - endIndex) * rowEstimate : 0;

  useEffect(() => {
    setWindowCenter(Number.isFinite(scrollIndex) && scrollIndex >= 0 ? scrollIndex : 0);
  }, [scrollIndex]);

  useEffect(
    () => () => {
      if (scrollFrame.current) window.cancelAnimationFrame(scrollFrame.current);
    },
    []
  );

  function handleScroll(event) {
    if (!shouldWindow) return;
    const scrollTop = event.currentTarget.scrollTop;
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      setWindowCenter(Math.max(0, Math.min(cues.length - 1, Math.floor(scrollTop / rowEstimate))));
    });
  }

  return (
    <div
      className={`paused-subtitles ${gridOn ? 'grid-mode' : ''} ${liveOverlayActive ? 'with-live-overlay' : ''}`}
      ref={listRef}
      onScroll={handleScroll}
      onClick={(event) => {
        if (event.target === event.currentTarget) onPlay();
        event.stopPropagation();
      }}
    >
      {toolbarOn ? (
        <div className="list-toolbar">
          <button className={russianOn ? 'active' : ''} onClick={onToggleRussian}>
            RU
          </button>
          <button className={gridOn ? 'active' : ''} onClick={onToggleGrid} aria-label={t('player_toggle_grid')}>
            <Grid2x2 size={18} />
          </button>
        </div>
      ) : null}
      {shouldWindow && topSpacer ? <div className="subtitle-spacer" style={{ height: topSpacer }} /> : null}
      {visibleCues.map((cue, visibleIndex) => {
        const index = startIndex + visibleIndex;
        const ruCue = findCueOverlapping(ru, cue);
        return (
          <div
            key={`${cue.start}-${index}`}
            data-scroll-active={index === scrollIndex}
            className="subtitle-row"
            onClick={() => onSelect(cue)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelect(cue);
            }}
          >
            <small
              onClick={(event) => {
                event.stopPropagation();
                onSelect(cue);
              }}
            >
              {formatTime(cue.start)}
            </small>
            <div
              className="subtitle-text"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(cue);
              }}
            >
              <button className="cue-start" onClick={() => onSelect(cue)} aria-label={t('player_play_from_subtitle')} />
              <p className="subtitle-en">
                <InteractiveText
                  text={cue.text}
                  lang="en"
                  pairText={ruCue?.text || ''}
                  onLookup={onLookup}
                  onHoverWord={onHoverWord}
                  hoveredWord={hoveredWord}
                />
              </p>
              {russianOn && ruCue?.text ? (
                <p className="subtitle-ru">
                  <InteractiveText
                    text={ruCue.text}
                    lang="ru"
                    pairText={cue.text}
                    onLookup={onLookup}
                    onHoverWord={onHoverWord}
                    hoveredWord={hoveredWord}
                  />
                </p>
              ) : null}
            </div>
            <div className="cue-actions" onClick={(event) => event.stopPropagation()}>
              <button title={t('player_slow_preview')} onClick={() => onPreview(cue, index, 0.65)}>
                <Gauge size={20} />
              </button>
              <button title={t('player_original_preview')} onClick={() => onPreview(cue, index, 1)}>
                <Volume2 size={20} />
              </button>
            </div>
          </div>
        );
      })}
      {shouldWindow && bottomSpacer ? <div className="subtitle-spacer" style={{ height: bottomSpacer }} /> : null}
    </div>
  );
}

function InteractiveText({ text, lang, pairText = '', onLookup, onHoverWord, hoveredWord }) {
  const parts = useMemo(() => splitText(text), [text]);

  return parts.map((part, index) =>
    part.word ? (
      <button
        type="button"
        className={isMatchedWord(part.value, lang, hoveredWord) ? 'word-token translation-match' : 'word-token'}
        key={`${part.value}-${index}`}
        onClick={(event) => {
          event.stopPropagation();
          onLookup(part.value, lang, event);
        }}
        onMouseEnter={() => onHoverWord(part.value, lang, text, pairText)}
        onMouseLeave={() => onHoverWord(null, lang)}
      >
        {part.value}
      </button>
    ) : (
      <span key={`${part.value}-${index}`}>{part.value}</span>
    )
  );
}

function WordCard({ lookup, onClose, voices, voicePrefs, setVoicePrefs, onSave }) {
  const { t } = useLocale();
  const firstAccentRender = useRef(true);
  const accentOptions = lookup.lang === 'ru' ? ['ru'] : ['us', 'uk'];
  const accentValue = accentOptions.includes(voicePrefs.accent) ? voicePrefs.accent : accentOptions[0];

  useEffect(() => {
    if (firstAccentRender.current) {
      firstAccentRender.current = false;
      return;
    }
    speakWord(lookup.word, lookup.lang, voices, { ...voicePrefs, accent: accentValue });
  }, [accentValue]);

  function speak() {
    speakWord(lookup.word, lookup.lang, voices, { ...voicePrefs, accent: accentValue });
  }

  return (
    <div className="word-card" style={{ left: lookup.position.left, top: lookup.position.top }} onClick={(event) => event.stopPropagation()}>
      <div className="word-tabs single">
        <button className="active">{t('player_word_meaning')}</button>
        <button className="close-card" onClick={onClose}>
          x
        </button>
      </div>
      <div className="word-body">
        <div className="word-title">
          <strong>
            {lookup.word} - <span>{lookup.loading ? '...' : lookup.translation}</span>
          </strong>
          <button onClick={speak} title={t('player_voice')}>
            <Volume1 size={20} />
          </button>
        </div>
        <p className="phonetic">{lookup.lang.toUpperCase()} [{lookup.word}]</p>
        <p className="more-meaning">{t('player_word_more')}: {lookup.loading ? 'loading...' : lookup.translation}</p>
        <div className="voice-options">
          <label>
            {t('player_accent')}
            <select value={accentValue} onChange={(event) => setVoicePrefs((prev) => ({ ...prev, accent: event.target.value }))}>
              {accentOptions.map((accent) => (
                <option key={accent} value={accent}>
                  {accent.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="add-word"
          onClick={onSave}
          disabled={lookup.loading || lookup.saving || lookup.saved || !lookup.translation}
        >
          <Check size={16} /> {lookup.saved ? t('player_word_added') : lookup.saving ? '...' : t('player_word_add_vocab')}
        </button>
        {lookup.error ? <p className="word-error">{lookup.error}</p> : null}
      </div>
    </div>
  );
}

function SubtitleSettings({ style, setStyle }) {
  const { t } = useLocale();
  const [palette, setPalette] = useState(null);
  const colors = ['#ffffff', '#f4d979', '#ffd43b', '#f4ff00', '#0eea15', '#ff201b'];

  return (
    <div className="subtitle-settings" onClick={(event) => event.stopPropagation()}>
      {palette ? (
        <div className="color-palette">
          {colors.map((color) => (
            <button
              key={color}
              style={{ background: color }}
              onClick={() => {
                setStyle((value) => ({ ...value, [palette]: color }));
                setPalette(null);
              }}
            />
          ))}
        </div>
      ) : null}
      <Slider label="ENG" value={style.en} min={18} max={44} suffix="%" onChange={(en) => setStyle((value) => ({ ...value, en }))} />
      <Slider label="RUS" value={style.ru} min={16} max={40} suffix="%" onChange={(ru) => setStyle((value) => ({ ...value, ru }))} />
      <div className="color-pickers">
        <button style={{ background: style.enColor }} onClick={() => setPalette(palette === 'enColor' ? null : 'enColor')} />
        <button style={{ background: style.ruColor }} onClick={() => setPalette(palette === 'ruColor' ? null : 'ruColor')} />
        <button
          className="swap-colors"
          onClick={() => setStyle((value) => ({ ...value, enColor: value.ruColor, ruColor: value.enColor }))}
          title={t('player_subtitle_style')}
        >
          <ArrowUpDown size={22} />
        </button>
      </div>
      <hr />
      <Slider label={t('player_offset')} value={style.gap} min={0} max={60} suffix="%" onChange={(gap) => setStyle((value) => ({ ...value, gap }))} />
      <Slider
        label={t('player_background')}
        value={style.background}
        min={0}
        max={90}
        suffix="%"
        onChange={(background) => setStyle((value) => ({ ...value, background }))}
      />
      <div className="font-pills">
        {Object.keys(fontMap).map((font) => (
          <button key={font} className={style.font === font ? 'active' : ''} onClick={() => setStyle((value) => ({ ...value, font }))}>
            {font}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlayerToolsPanel({ toggles, setToggles, playbackRate, setPlaybackRate }) {
  const { t } = useLocale();
  function toggle(key) {
    setToggles((value) => ({ ...value, [key]: !value[key] }));
  }

  const speeds = [0.25, 0.5, 0.75, 1, 1.5];

  return (
    <div className="player-tools-panel" onClick={(event) => event.stopPropagation()}>
      <ToggleRow label={t('player_scenario_on_pause')} value={toggles.pauseScript} onChange={() => toggle('pauseScript')} />
      <hr />
      <div className="tool-title">{t('player_playback_speed')}</div>
      <div className="speed-pills">
        {speeds.map((speed) => (
          <button key={speed} className={playbackRate === speed ? 'active' : ''} onClick={() => setPlaybackRate(speed)}>
            {speed === 1 ? t('player_normal_speed') : speed}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <label className="tool-row">
      <span>{label}</span>
      <button type="button" className={`tool-toggle ${value ? 'on' : ''}`} onClick={onChange} aria-pressed={value}>
        <i />
      </button>
    </label>
  );
}

function Slider({ label, value, onChange, min, max, suffix = '' }) {
  return (
    <label className="setting-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>
        {value}
        {suffix}
      </strong>
    </label>
  );
}

function formatTime(value = 0) {
  if (!Number.isFinite(value)) return '0:00';
  const total = Math.max(0, Math.floor(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function findActiveIndex(cues, time) {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cues[mid];
    if (time < cue.start) high = mid - 1;
    else if (time > cue.end) low = mid + 1;
    else return mid;
  }
  return -1;
}

function findCueAtTime(cues, time) {
  const index = findActiveIndex(cues, time);
  return index >= 0 ? cues[index] : null;
}

function findNearestCueIndex(cues, time) {
  if (!cues.length) return -1;
  let low = 0;
  let high = cues.length - 1;
  let candidate = cues.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (cues[mid].end >= time) {
      candidate = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return candidate;
}

function findCueOverlapping(cues, cue) {
  return (
    cues.find((candidate) => candidate.start <= cue.end && candidate.end >= cue.start) ||
    cues.find((candidate) => Math.abs(candidate.start - cue.start) < 1.2) ||
    null
  );
}

function splitText(text) {
  let wordIndex = -1;
  return String(text)
    .split(/([\p{L}][\p{L}'-]*)/gu)
    .filter(Boolean)
    .map((value) => {
      const word = /\p{L}/u.test(value);
      if (word) wordIndex += 1;
      return { value, word, wordIndex: word ? wordIndex : -1 };
    });
}

function normalizeLookupWord(word = '') {
  return String(word)
    .toLowerCase()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .trim();
}

function isMatchedWord(word, lang, hoveredWord) {
  if (!hoveredWord || hoveredWord.sourceLang === lang) return false;
  const normalized = normalizeLookupWord(word);
  if (!normalized) return false;

  if (!hoveredWord.translation) return false;
  const translatedParts = splitText(hoveredWord.translation)
    .filter((part) => part.word)
    .map((part) => normalizeLookupWord(part.value))
    .filter(Boolean);
  return translatedParts.some((part) => {
    if (normalized === part) return true;
    const min = Math.min(normalized.length, part.length);
    const stemLength = min >= 5 ? 4 : Math.max(2, min - 1);
    const stem = part.slice(0, stemLength);
    return stem.length >= 2 && (normalized.startsWith(stem) || stem.startsWith(normalized));
  });
}

function buildPhraseCandidates(text, word) {
  const cleanWord = normalizeLookupWord(word);
  if (!cleanWord) return [];
  const tokens = splitText(text).filter((part) => part.word).map((part) => part.value);
  const index = tokens.findIndex((token) => normalizeLookupWord(token) === cleanWord);
  if (index < 0) return [cleanWord];
  const phrases = [tokens[index]];
  if (index > 0) phrases.push(`${tokens[index - 1]} ${tokens[index]}`);
  if (index < tokens.length - 1) phrases.push(`${tokens[index]} ${tokens[index + 1]}`);
  if (index > 0 && index < tokens.length - 1) phrases.push(`${tokens[index - 1]} ${tokens[index]} ${tokens[index + 1]}`);
  return [...new Set(phrases.map((value) => String(value || '').trim()).filter(Boolean))];
}

function pickBestTranslation(translations, pairText = '') {
  if (!translations.length) return '';
  const pairTokens = splitText(pairText)
    .filter((part) => part.word)
    .map((part) => normalizeLookupWord(part.value))
    .filter(Boolean);
  if (!pairTokens.length) return translations[0];

  let best = translations[0];
  let bestScore = -1;
  for (const translation of translations) {
    const tokens = splitText(translation)
      .filter((part) => part.word)
      .map((part) => normalizeLookupWord(part.value))
      .filter(Boolean);
    const score = tokens.reduce((acc, token) => (pairTokens.includes(token) ? acc + 2 : acc), 0) + tokens.length * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = translation;
    }
  }
  return best;
}

function speakWord(word, lang, voices = [], voicePrefs = { accent: 'us' }) {
  const synth = getSpeechSynthesis();
  if (!synth) return;
  const utterance = new SpeechSynthesisUtterance(word);
  const voice = pickVoice(voices, lang, voicePrefs);
  utterance.lang = voice?.lang || accentToVoiceLang(lang, voicePrefs.accent);
  if (voice) utterance.voice = voice;
  synth.cancel();
  synth.speak(utterance);
}

function getSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function getMediaReadyState(key, fallback) {
  return typeof HTMLMediaElement !== 'undefined' && Number.isFinite(HTMLMediaElement[key]) ? HTMLMediaElement[key] : fallback;
}

function progressStorageKey(movieId) {
  return `kinochy:movie-progress:${movieId}`;
}

function readSavedProgress(movieId) {
  if (typeof window === 'undefined' || !movieId) return 0;
  try {
    const key = progressStorageKey(movieId);
    window.localStorage?.removeItem(key);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Number(parsed.time) || 0;
  } catch {
    return 0;
  }
}

function saveMovieProgress(movieId, time, total) {
  if (typeof window === 'undefined' || !movieId || !Number.isFinite(time)) return;
  try {
    const key = progressStorageKey(movieId);
    window.localStorage?.removeItem(key);
    if (time < 3 || (Number.isFinite(total) && total > 0 && time > total - 10)) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, JSON.stringify({ time, updatedAt: Date.now() }));
  } catch {
    // Ignore storage errors; playback should never depend on browser storage.
  }
}

function clearMovieProgress(movieId) {
  if (typeof window === 'undefined' || !movieId) return;
  try {
    const key = progressStorageKey(movieId);
    window.sessionStorage.removeItem(key);
    window.localStorage?.removeItem(key);
  } catch {
    // Ignore storage errors; playback should never depend on browser storage.
  }
}

function needsMoreVideoData(video) {
  return Boolean(video && video.readyState < getMediaReadyState('HAVE_FUTURE_DATA', 3));
}

function isCompactPlayback() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
}

function useCompactPlayer() {
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(max-width: 820px), (pointer: coarse)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(max-width: 820px), (pointer: coarse)');
    const update = () => setCompact(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return compact;
}

function safePlay(video) {
  const playPromise = video?.play?.();
  if (playPromise && typeof playPromise.catch === 'function') {
    return playPromise.catch(() => {});
  }
  return Promise.resolve();
}

function setVideoTime(video, time) {
  if (!video || !Number.isFinite(time)) return 0;
  const next = Math.max(0, time);
  try {
    video.currentTime = next;
  } catch {
    video.fastSeek?.(next);
  }
  return next;
}

function seekVideo(video, time, shouldLoad, hls) {
  if (!video || !Number.isFinite(time)) return 0;
  const next = Math.max(0, time);
  try {
    hls?.stopLoad?.();
  } catch {}
  const remembered = setVideoTime(video, next);
  if (shouldLoad) {
    try {
      hls?.startLoad?.(remembered);
    } catch {}
  }
  return remembered;
}

function pickVoice(voices, lang, prefs) {
  const targetLang = lang === 'ru' ? 'ru' : 'en';
  const langVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(targetLang));
  const byAccent = langVoices.filter((voice) => matchesAccent(voice, prefs.accent));
  const malePattern = /male|man|guy|david|mark|alex|john|james|michael|george|thomas|daniel|google uk english male|fred|pavel|maxim/i;
  if (byAccent.length) {
    return byAccent.find((voice) => malePattern.test(voice.name)) || byAccent[0] || null;
  }
  if (targetLang === 'en' && (prefs.accent === 'us' || prefs.accent === 'uk')) return null;
  return langVoices.find((voice) => malePattern.test(voice.name)) || langVoices[0] || null;
}

function accentToVoiceLang(lang, accent) {
  if (lang === 'ru' || accent === 'ru') return 'ru-RU';
  if (accent === 'uk') return 'en-GB';
  return 'en-US';
}

function matchesAccent(voice, accent) {
  const text = `${voice.lang} ${voice.name}`.toLowerCase().replace(/_/g, '-');
  if (accent === 'uk') return /en-gb|british|england|great britain|united kingdom|uk english/.test(text);
  if (accent === 'us') return /en-us|american|united states|usa|us english/.test(text);
  if (accent === 'ru') return /ru-ru|russian/.test(text);
  return false;
}
