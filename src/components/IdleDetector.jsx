import { useEffect, useState } from 'react';

// Simple idle hook (renderer) based on mouse/keyboard events; could be extended to pause counting if desired
export default function useIdle(timeoutMs = 60000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer;
    const reset = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(()=>setIdle(true), timeoutMs);
    };
    ['mousemove','keydown','mousedown','wheel'].forEach(evt => window.addEventListener(evt, reset));
    reset();
    return () => {
      ['mousemove','keydown','mousedown','wheel'].forEach(evt => window.removeEventListener(evt, reset));
      clearTimeout(timer);
    };
  }, [timeoutMs]);
  return idle;
}
