import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { api } from '../api.js';
import { useLocale } from '../ui/locale.jsx';

const initialForm = {
  username: '',
  email: '',
  password: '',
  confirmPassword: '',
  newPassword: '',
  confirmNewPassword: ''
};

function cloneAuthForm() {
  return { ...initialForm };
}

export default function AuthPage({ mode = 'login', embedded = false, onAuth }) {
  const [panel, setPanel] = useState(mode === 'signup' ? 'signup' : 'login');
  const [form, setForm] = useState(() => cloneAuthForm());
  const [verification, setVerification] = useState({ flow: 'signup', email: '', username: '', code: '', expiresAt: '', canResendAt: 0 });
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const navigate = useNavigate();
  const { t } = useLocale();

  useEffect(() => {
    if (panel !== 'verify') return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [panel]);

  function update(event) {
    setForm((value) => ({ ...value, [event.target.name]: event.target.value }));
  }

  function updateVerificationCode(event) {
    setVerification((value) => ({ ...value, code: String(event.target.value || '').replace(/\D/g, '').slice(0, 6) }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');

    try {
      if (panel === 'signup') {
        validateSignup(form, t);
        const data = await api('/api/users/signup', {
          method: 'POST',
          body: JSON.stringify({ username: form.username, email: form.email, password: form.password })
        });
        openVerificationPanel('signup', data.pending);
        return;
      }

      if (panel === 'forgot') {
        if (!isValidEmail(form.email)) throw new Error(t('auth_invalid_email'));
        const data = await api('/api/users/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email: form.email })
        });
        openVerificationPanel('forgot', data.pending);
        return;
      }

      if (panel === 'verify') {
        if (verification.flow === 'forgot') {
          await api('/api/users/verify-password-reset', {
            method: 'POST',
            body: JSON.stringify({ email: verification.email, code: verification.code })
          });
          setPanel('reset');
          return;
        }

        const data = await api('/api/users/verify-email', {
          method: 'POST',
          body: JSON.stringify({ email: verification.email, code: verification.code })
        });
        onAuth?.(data.user);
        if (!embedded) navigate('/');
        return;
      }

      if (panel === 'reset') {
        if (!isStrongPassword(form.newPassword)) throw new Error(t('auth_strong_password'));
        if (form.newPassword !== form.confirmNewPassword) throw new Error(t('auth_password_mismatch'));
        await api('/api/users/reset-password', {
          method: 'POST',
          body: JSON.stringify({ email: verification.email, code: verification.code, password: form.newPassword })
        });
        setForm(cloneAuthForm());
        setPanel('login');
        return;
      }

      const data = await api('/api/users/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password })
      });
      onAuth?.(data.user);
      if (!embedded) navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resendCode() {
    setBusy(true);
    setError('');
    try {
      const path = verification.flow === 'forgot' ? '/api/users/forgot-password' : '/api/users/resend-verification';
      const data = await api(path, {
        method: 'POST',
        body: JSON.stringify({ email: verification.email })
      });
      setVerification((value) => ({
        ...value,
        expiresAt: data.pending.verificationExpiresAt,
        canResendAt: Date.now() + 30 * 1000
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function openVerificationPanel(flow, pending) {
    setVerification({
      flow,
      email: pending.email,
      username: pending.username || form.username,
      code: '',
      expiresAt: pending.verificationExpiresAt,
      canResendAt: Date.now() + 30 * 1000
    });
    setPanel('verify');
  }

  function switchPanel(nextPanel) {
    setPanel(nextPanel);
    setForm(cloneAuthForm());
    setVisiblePasswords({});
    setError('');
  }

  function togglePassword(name) {
    setVisiblePasswords((value) => ({ ...value, [name]: !value[name] }));
  }

  const verifySeconds = Math.max(0, Math.ceil((Date.parse(verification.expiresAt || 0) - now) / 1000));
  const resendSeconds = Math.max(0, Math.ceil((verification.canResendAt - now) / 1000));

  return (
    <section className="auth-page">
      <form className="auth-panel" onSubmit={submit}>
        <h1>{getPanelTitle(panel, verification.flow, t)}</h1>

        {panel === 'verify' ? (
          <>
            <p className="verify-copy">
              {verification.flow === 'forgot' ? t('auth_reset_verify_copy') : t('auth_verify_copy')} <strong>{verification.email}</strong>
            </p>
            <label>
              {t('auth_verification_code')}
              <input
                name="verificationCode"
                value={verification.code}
                onChange={updateVerificationCode}
                inputMode="numeric"
                pattern="\d{6}"
                minLength="6"
                maxLength="6"
                placeholder={t('auth_verification_hint')}
                autoComplete="one-time-code"
                required
              />
            </label>
            <p className="verify-copy">
              {t('auth_code_expires_in')} {formatCountdown(verifySeconds)}
            </p>
          </>
        ) : null}

        {panel === 'signup' ? (
          <label>
            {t('auth_username')}
            <input name="username" value={form.username} onChange={update} minLength="2" placeholder={t('auth_username_hint')} autoComplete="username" required />
          </label>
        ) : null}

        {['login', 'signup', 'forgot'].includes(panel) ? (
          <label>
            {t('auth_email')}
            <input name="email" value={form.email} onChange={update} type="email" placeholder={t('auth_email_hint')} autoComplete="email" required />
          </label>
        ) : null}

        {['login', 'signup'].includes(panel) ? (
          <PasswordField
            label={t('auth_password')}
            name="password"
            value={form.password}
            onChange={update}
            visible={Boolean(visiblePasswords.password)}
            onToggle={() => togglePassword('password')}
            minLength="8"
            placeholder={t('auth_password_hint')}
            autoComplete={panel === 'signup' ? 'new-password' : 'current-password'}
            required
          />
        ) : null}

        {panel === 'login' ? (
          <button type="button" className="text-link" onClick={() => switchPanel('forgot')}>
            {t('auth_forgot_password')}
          </button>
        ) : null}

        {panel === 'signup' ? (
          <PasswordField
            label={t('auth_confirm_password')}
            name="confirmPassword"
            value={form.confirmPassword}
            onChange={update}
            visible={Boolean(visiblePasswords.confirmPassword)}
            onToggle={() => togglePassword('confirmPassword')}
            minLength="8"
            placeholder={t('auth_confirm_hint')}
            autoComplete="new-password"
            required
          />
        ) : null}

        {panel === 'reset' ? (
          <>
            <PasswordField
              label={t('auth_new_password')}
              name="newPassword"
              value={form.newPassword}
              onChange={update}
              visible={Boolean(visiblePasswords.newPassword)}
              onToggle={() => togglePassword('newPassword')}
              minLength="8"
              placeholder={t('auth_password_label')}
              autoComplete="new-password"
              required
            />
            <PasswordField
              label={t('auth_confirm_password')}
              name="confirmNewPassword"
              value={form.confirmNewPassword}
              onChange={update}
              visible={Boolean(visiblePasswords.confirmNewPassword)}
              onToggle={() => togglePassword('confirmNewPassword')}
              minLength="8"
              placeholder={t('auth_confirm_hint')}
              autoComplete="new-password"
              required
            />
          </>
        ) : null}

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary" disabled={busy}>
          {busy ? t('auth_wait') : getPanelAction(panel, verification.flow, t)}
        </button>

        {panel === 'verify' ? (
          <div className="auth-verify-actions">
            <button type="button" className="text-link" onClick={resendCode} disabled={busy || resendSeconds > 0}>
              {resendSeconds > 0 ? `${t('auth_resend_code')} (${resendSeconds}s)` : t('auth_resend_code')}
            </button>
            <button type="button" className="text-link" onClick={() => switchPanel('login')}>
              {t('auth_back_to_login')}
            </button>
          </div>
        ) : panel === 'signup' ? (
          <p className="auth-switch">
            {t('auth_have_account')} <button type="button" onClick={() => switchPanel('login')}>{t('login')}</button>
          </p>
        ) : panel === 'login' ? (
          <p className="auth-switch">
            {t('auth_need_account')} <button type="button" onClick={() => switchPanel('signup')}>{t('signup')}</button>
          </p>
        ) : (
          <button type="button" className="text-link" onClick={() => switchPanel('login')}>
            {t('auth_back_to_login')}
          </button>
        )}

        {!embedded ? <Link className="auth-home-link" to="/">{t('auth_back_home')}</Link> : null}
      </form>
    </section>
  );
}

function PasswordField({ label, name, value, onChange, visible, onToggle, ...inputProps }) {
  return (
    <label>
      {label}
      <span className="password-field">
        <input
          name={name}
          value={value}
          onChange={onChange}
          type={visible ? 'text' : 'password'}
          {...inputProps}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={onToggle}
          aria-label={visible ? 'Hide password' : 'Show password'}
          title={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

function validateSignup(form, t) {
  if (!isValidEmail(form.email)) throw new Error(t('auth_invalid_email'));
  if (!isStrongPassword(form.password)) throw new Error(t('auth_strong_password'));
  if (form.password !== form.confirmPassword) throw new Error(t('auth_password_mismatch'));
}

function getPanelTitle(panel, flow, t) {
  if (panel === 'signup') return t('signup');
  if (panel === 'verify') return flow === 'forgot' ? t('auth_reset_verify_title') : t('auth_verify_title');
  if (panel === 'forgot') return t('auth_forgot_title');
  if (panel === 'reset') return t('auth_reset_title');
  return t('login');
}

function getPanelAction(panel, flow, t) {
  if (panel === 'signup') return t('auth_create_account');
  if (panel === 'verify') return flow === 'forgot' ? t('auth_verify_action') : t('auth_verify_action');
  if (panel === 'forgot') return t('auth_send_code');
  if (panel === 'reset') return t('auth_update_password');
  return t('login');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function isStrongPassword(password) {
  const value = String(password || '');
  return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
}

function formatCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
