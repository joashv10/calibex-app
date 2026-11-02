export type Axis = 'A' | 'B';
export type Touchpoint =
  | 'breakfast' | 'lunch' | 'afternoon' | 'post_workout' | 'dinner' | 'weekly_review';

export interface Dimension {
  dimension_id: string;
  display_name: string;
  axis: Axis;
  weight: number;
  sort_order: number;
}

export interface Item {
  item_id: string;
  dimension_id: string;
  facet: string | null;
  prompt: string;
  response_type: 'boolean' | 'ordinal' | 'chip' | 'bodymap' | 'composite' | 'swatch';
  options: string[];
  severity_map: Record<string, number>;
  is_protective: boolean;
  touchpoint: string;
  cadence: string;
  per_occurrence: boolean;
  fixed: boolean;
  event_timed: boolean;
  active: boolean;
  why: string | null; // one line on why it's asked, shown behind ⓘ
}

export interface SamplerState {
  item_id: string;
  last_shown_at: string | null;
  times_shown: number;
}

export interface ReadoutRow {
  behaviour_date: string;
  recovery_date: string | null;
  recovery_score: number | null;
  hrv_rmssd_ms: number | null;
  resting_heart_rate: number | null;
  items_answered: number;
  items_skipped: number;
}
