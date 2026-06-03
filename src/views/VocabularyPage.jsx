import { BookText, Trash2, Volume1 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useLocale } from '../ui/locale.jsx';

export default function VocabularyPage() {
  const { t } = useLocale();
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [voices, setVoices] = useState([]);
  const [accent, setAccent] = useState('us');

  useEffect(() => {
    setLoading(true);
    api('/api/users/vocabulary')
      .then((data) => setWords(Array.isArray(data) ? data : []))
      .catch(() => setWords([]))
      .finally(() => setLoading(false));
  }, []);

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

  async function removeWord(id) {
    await api(`/api/users/vocabulary/${id}`, { method: 'DELETE' });
    setWords((current) => current.filter((entry) => entry.id !== id));
    setActive((current) => (current?.id === id ? null : current));
  }

  const columns = useMemo(() => {
    const midpoint = Math.ceil(words.length / 2);
    return [words.slice(0, midpoint), words.slice(midpoint)];
  }, [words]);

  const accentOptions = active?.sourceLanguage === 'ru' ? ['ru'] : ['us', 'uk'];
  const accentValue = accentOptions.includes(accent) ? accent : accentOptions[0];

  return (
    <section className="catalog-page vocabulary-page">
      {loading ? <div className="status">{t('auth_wait')}</div> : null}
      {!loading && !words.length ? (
        <div className="vocabulary-empty">
          <BookText size={34} />
          <h1>{t('vocabulary_title')}</h1>
          <p>{t('vocabulary_subtitle')}</p>
        </div>
      ) : null}

      {!!words.length ? (
        <div className="vocabulary-grid">
          {columns.map((column, columnIndex) => (
            <div key={columnIndex} className="vocabulary-column">
              {column.map((entry) => (
                <article key={entry.id} className="vocabulary-item">
                  <button className="vocabulary-sound" onClick={() => speakWord(entry.word, entry.sourceLanguage, voices, accentValue)} aria-label={t('player_voice')}>
                    <Volume1 size={22} />
                  </button>
                  <button className="vocabulary-copy" onClick={() => setActive(entry)}>
                    <strong>{entry.word}</strong>
                    <span>{entry.translation}</span>
                  </button>
                  <button className="vocabulary-remove" onClick={() => removeWord(entry.id)} aria-label={t('player_word_remove_vocab')}>
                    <Trash2 size={18} />
                  </button>
                </article>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {active ? (
        <div className="modal-backdrop" onClick={() => setActive(null)}>
          <div className="word-card vocabulary-card" onClick={(event) => event.stopPropagation()}>
            <div className="word-tabs single">
              <button className="active">{t('player_word_meaning')}</button>
              <button className="close-card" onClick={() => setActive(null)}>
                x
              </button>
            </div>
            <div className="word-body">
              <div className="word-title">
                <strong>
                  {active.word} - <span>{active.translation}</span>
                </strong>
                <button onClick={() => speakWord(active.word, active.sourceLanguage, voices, accentValue)} title={t('player_voice')}>
                  <Volume1 size={20} />
                </button>
              </div>
              <p className="phonetic">{active.sourceLanguage.toUpperCase()} [{active.word}]</p>
              <p className="more-meaning">
                {t('player_word_more')}: {active.translation}
              </p>
              <div className="voice-options">
                <label>
                  {t('player_accent')}
                  <select value={accentValue} onChange={(event) => setAccent(event.target.value)}>
                    {accentOptions.map((option) => (
                      <option key={option} value={option}>
                        {option.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="add-word remove-word" onClick={() => removeWord(active.id)}>
                <Trash2 size={16} /> {t('player_word_remove_vocab')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function speakWord(word, lang, voices = [], accent = 'us') {
  const synth = getSpeechSynthesis();
  if (!synth) return;
  const utterance = new SpeechSynthesisUtterance(word);
  const voice = pickVoice(voices, lang, accent);
  utterance.lang = voice?.lang || accentToVoiceLang(lang, accent);
  if (voice) utterance.voice = voice;
  synth.cancel();
  synth.speak(utterance);
}

function getSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function pickVoice(voices, lang, accent) {
  const targetLang = lang === 'ru' ? 'ru' : 'en';
  const langVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith(targetLang));
  const byAccent = langVoices.filter((voice) => matchesAccent(voice, accent));
  const malePattern = /male|man|guy|david|mark|alex|john|james|michael|george|thomas|daniel|google uk english male|fred|pavel|maxim/i;
  if (byAccent.length) {
    return byAccent.find((voice) => malePattern.test(voice.name)) || byAccent[0] || null;
  }
  if (targetLang === 'en' && (accent === 'us' || accent === 'uk')) return null;
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
