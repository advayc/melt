import React from 'react';

export default function Duration({ ms }) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(h + 'h');
  if (m) parts.push(m + 'm');
  if (!h && !m) parts.push(s + 's');
  return <span>{parts.join(' ')}</span>;
}
