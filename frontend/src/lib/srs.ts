export function formatLastSeen(iso: string | null, now: Date): string {
  if (!iso) return "Not practiced yet";
  const then = new Date(iso);
  const hours = (now.getTime() - then.getTime()) / 36e5;
  if (hours < 0.5) return "Just now";
  if (hours < 20) return "Earlier today";
  if (hours < 44) return "Yesterday";
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

export function formatNextReview(iso: string | null, due: boolean, now: Date): string {
  if (due) return "Due now";
  if (!iso) return "Due now";
  const then = new Date(iso);
  const hours = (then.getTime() - now.getTime()) / 36e5;
  if (hours <= 0) return "Due now";
  if (hours < 20) return "Later today";
  if (hours < 44) return "Tomorrow";
  const days = Math.round(hours / 24);
  return `In ${days} days`;
}

export function recallLabel(pK: number): string {
  return `${Math.round(pK * 100)}% recall`;
}

export function stabilityLabel(days: number): string {
  if (days < 1) return `${Math.round(days * 24)}h memory`;
  if (days < 1.5) return "1-day memory";
  return `${days.toFixed(1)}-day memory`;
}
