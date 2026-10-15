export function formatJobDates(dateStr: string | undefined): string {
  if (!dateStr) return '';

  const dates = dateStr.split(',').map(d => d.trim()).sort();
  if (dates.length === 0) return '';
  if (dates.length === 1) return formatDate(dates[0]);

  // Convert to Date objects and filter out invalid dates
  const dateObjs = dates.map(d => ({
    str: d,
    obj: new Date(d.replace(/\//g, '-')) // handle slash format if present
  })).filter(d => !isNaN(d.obj.getTime()));

  if (dateObjs.length === 0) return dateStr;

  let result = '';
  let streakStart = dateObjs[0];
  let streakEnd = dateObjs[0];
  let currentStreak = 1;

  for (let i = 1; i < dateObjs.length; i++) {
    const prev = dateObjs[i - 1];
    const curr = dateObjs[i];
    
    // Check if consecutive
    const diffTime = curr.obj.getTime() - prev.obj.getTime();
    const diffDays = diffTime / (1000 * 3600 * 24);

    if (diffDays === 1) {
      streakEnd = curr;
      currentStreak++;
    } else {
      result += formatStreak(streakStart, streakEnd, currentStreak) + ', ';
      streakStart = curr;
      streakEnd = curr;
      currentStreak = 1;
    }
  }
  
  result += formatStreak(streakStart, streakEnd, currentStreak);
  
  return result;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatStreak(start: {str: string}, end: {str: string}, streak: number): string {
  if (streak === 1) {
    return formatDate(start.str);
  } else if (streak === 2) {
    return `${formatDate(start.str)}, ${formatDate(end.str)}`;
  } else {
    return `${formatDate(start.str)}〜${formatDate(end.str)}`;
  }
}
