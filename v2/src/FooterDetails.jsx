import { useEffect, useRef, useState } from 'react';

const zone = 'America/New_York';
const DISCORD_HANDLE = '.thesxber';
const clock = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });

function CopyButton({ value, label }) {
  const [status, setStatus] = useState('');
  const mounted = useRef(false);
  const request = useRef(0);
  const timer = useRef(null);
  const valueElement = useRef(null);

  useEffect(() => {
    mounted.current = true;
    setStatus('');
    return () => {
      mounted.current = false;
      request.current += 1;
      clearTimeout(timer.current);
    };
  }, [value]);

  useEffect(() => {
    if (status !== 'manual' || !valueElement.current) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(valueElement.current);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [status]);

  async function copyValue() {
    const currentRequest = ++request.current;
    clearTimeout(timer.current);
    if (status === 'failed') {
      setStatus('manual');
      return;
    }
    setStatus('');
    try {
      await navigator.clipboard.writeText(value);
      if (!mounted.current || currentRequest !== request.current) return;
      setStatus('copied');
    } catch {
      if (!mounted.current || currentRequest !== request.current) return;
      setStatus('failed');
    }
    timer.current = setTimeout(() => {
      if (mounted.current && currentRequest === request.current) setStatus('');
    }, 2500);
  }

  const description = status === 'copied'
    ? `${label} copied. Copy ${value} again.`
    : status === 'failed'
      ? `Could not copy ${label}. Click to select ${value} for manual copying.`
      : status === 'manual'
        ? `${value} selected for manual copying. Press Control+C or Command+C to copy. Click to retry copying ${label}.`
        : `Copy ${label} ${value}`;
  return <button type="button" className="footer-copy" onClick={copyValue} title={description} aria-label={description}>
    <code>
      <span className="footer-copy-original" aria-hidden="true">{value}</span>
      <span className="footer-copy-value" ref={valueElement} role="status" aria-live="polite" aria-atomic="true" aria-label={status ? description : undefined} style={status === 'manual' ? { userSelect: 'text' } : undefined}>{status === 'copied' ? 'copied' : status === 'failed' ? 'failed' : value}</span>
    </code>
  </button>;
}

export default function FooterDetails({ email }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const zoneOffset = offset.formatToParts(now).find(part => part.type === 'timeZoneName')?.value;
  return <div className="footer-details">
    <span className="footer-discord">discord: <CopyButton value={DISCORD_HANDLE} label="Discord handle" /></span>
    <span className="footer-email">email: <CopyButton value={email} label="email address" /></span>
    <time dateTime={now.toISOString()} title={`Eastern Time — ${zone} (${zoneOffset})`} aria-label={`Eastern Time: ${clock.format(now)}, ${zoneOffset}`}>{clock.format(now)}</time>
  </div>;
}
