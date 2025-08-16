interface DurationProps {
  ms: number;
}

export default function Duration({ ms }: DurationProps): JSX.Element {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (!h && !m) parts.push(s + 's');
  return <span>{parts.join(' ')}</span>;
}
