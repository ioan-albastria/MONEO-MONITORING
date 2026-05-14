import { Pipe, PipeTransform } from '@angular/core';

@Pipe({ name: 'relativeTime', pure: true, standalone: false })
export class RelativeTimePipe implements PipeTransform {
  transform(isoTimestamp: string | null): string {
    if (!isoTimestamp) return 'N/A';
    const seconds = Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000);
    if (seconds < 0)     return 'just now';
    if (seconds < 90)    return `${seconds}s ago`;
    if (seconds < 5400)  return `${Math.round(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }
}
