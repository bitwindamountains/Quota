import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

// Every effect here is decorative. Reduced-motion users get the final state immediately.
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animates list changes (filter, sort, density) where the browser supports view transitions.
export function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (!doc.startViewTransition || reducedMotion()) return update();
  doc.startViewTransition(() => flushSync(update));
}

// Ambient background whose palette follows the most constrained fresh limit.
export function Aurora({ mood }: { mood: 'calm' | 'warm' | 'hot' }) {
  return <div className={'aurora ' + mood} aria-hidden="true"><i/><i/><i/></div>;
}

export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(() => reducedMotion() ? target : 0);
  const from = useRef(value);
  useEffect(() => {
    if (reducedMotion()) { from.current = target; setValue(target); return; }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const step = (time: number) => {
      const t = Math.min(1, (time - start) / duration), eased = 1 - (1 - t) ** 3;
      const next = origin + (target - origin) * eased;
      from.current = next; setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

// Counts up the numeric part of a formatted headline such as "62%" or "$18.42"; other text renders as-is.
export function AnimatedHeadline({ text }: { text: string }) {
  const match = /^(\$?)(\d+(?:\.\d+)?)(%?)$/.exec(text.replaceAll(',', ''));
  const target = match ? Number(match[2]) : 0, decimals = match?.[2].split('.')[1]?.length ?? 0;
  const value = useCountUp(target);
  if (!match) return <>{text}</>;
  return <>{match[1]}{value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{match[3]}</>;
}

// Circular gauge; the fill animates from empty on mount and eases between values.
export function Ring({ percent, tone, size = 46, stroke = 4, children }: { percent: number | null; tone: string; size?: number; stroke?: number; children?: ReactNode }) {
  const radius = (size - stroke) / 2, circumference = 2 * Math.PI * radius;
  const [shown, setShown] = useState(reducedMotion() ? percent ?? 0 : 0);
  useEffect(() => { const frame = requestAnimationFrame(() => setShown(percent ?? 0)); return () => cancelAnimationFrame(frame); }, [percent]);
  return <span className={'ring ' + tone} style={{ width: size, height: size }} aria-hidden="true">
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}/>
      {percent !== null && <circle className="ring-fill" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke}
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, shown)) / 100)}/>}
    </svg>
    <span className="ring-content">{children}</span>
  </span>;
}

// Cursor-following spotlight and a slight tilt for cards on precise pointers.
export const spotlight = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse' || reducedMotion()) return;
    const el = event.currentTarget, box = el.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
    el.style.setProperty('--mx', x * 100 + '%'); el.style.setProperty('--my', y * 100 + '%');
    el.style.setProperty('--rx', ((x - 0.5) * 4).toFixed(2) + 'deg'); el.style.setProperty('--ry', ((0.5 - y) * 4).toFixed(2) + 'deg');
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    const el = event.currentTarget;
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
  }
};

// True for a short moment after `signal` changes (not on first render).
export function usePulse(signal: string, duration = 1400) {
  const previous = useRef(signal), [active, setActive] = useState(false);
  useEffect(() => {
    if (previous.current === signal) return;
    previous.current = signal; setActive(true);
    const timer = setTimeout(() => setActive(false), duration);
    return () => clearTimeout(timer);
  }, [signal, duration]);
  return active;
}
