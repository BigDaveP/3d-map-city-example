import type { Alert, ReviewsState, SalesState, StaffState, Status, WeatherState } from "./types";

export function salesStatus(s: SalesState): Status {
  return s.pace >= 0.8 ? 0 : s.pace >= 0.6 ? 1 : 2;
}
export function staffStatus(s: StaffState): Status {
  const ratio = s.onDuty / s.scheduled;
  if (s.vacancies >= 3 || ratio < 0.55) return 2;
  if (s.vacancies >= 2 || s.late >= 2 || ratio < 0.75) return 1;
  return 0;
}
export function reviewsStatus(s: ReviewsState): Status {
  return s.rating >= 3.6 ? 0 : s.rating >= 3 ? 1 : 2;
}
export function weatherStatus(s: WeatherState): Status {
  if (s.condition === "orage") return 2;
  if (s.condition === "neige" || s.temp >= 33) return 1;
  return 0;
}
export function alertsStatus(alerts: readonly Alert[]): Status {
  if (alerts.some((a) => a.level === 2)) return 2;
  return alerts.length > 0 ? 1 : 0;
}
