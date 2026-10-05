/** 班表共用型別。折扣碼與信箱只留在伺服器設定，不會出現在這裡的回傳。 */

export type ScheduleClaim = {
  date: string;
  slot: string;
  place: string;
  person: string;
  /** 週一開會自動到會，不寫進資料庫 */
  auto?: boolean;
};

export type ScheduleSlot = {
  id: string;
  label: string;
  start: string;
  end: string;
  period: string;
  hour: number;
};

export type SchedulePeriod = {
  id: string;
  label: string;
  short: string;
  start: string;
  end: string;
};

export type SchedulePlace = {
  id: string;
  name: string;
  short: string;
  kind: "office" | "studio" | "leave";
  unit: "period" | "hour";
  periods: string[];
  slots: string[];
};

export type SchedulePerson = {
  name: string;
  role: string;
  minOfficeDays: number | null;
};

export type FollowShow = {
  show: string;
  keywords: string[];
  usuallyWith?: string[];
  codes?: string[];
};

export type OwnShow = {
  owner: string;
  show: string;
  code?: string;
  email?: string;
};

export type ScheduleRules = {
  workdays: number[];
  followPerson: string;
  backupPlaceId: string;
  minStaff: Record<string, number>;
  maxStaff: Record<string, number>;
  mondayMeeting: {
    enabled: boolean;
    weekday: number;
    start: string;
    end: string;
    placeId: string;
    label: string;
    exemptBackup: boolean;
  };
  offHours: { periods: string[]; staff: string[] };
  studioBookingNeedsStaff: boolean;
  maxShiftsPerWeek: number | null;
};

export type ScheduleConfig = {
  TZ_OFFSET: string;
  PEOPLE: SchedulePerson[];
  PERIODS: SchedulePeriod[];
  PLACES: SchedulePlace[];
  SLOTS: ScheduleSlot[];
  FOLLOW_SHOWS: FollowShow[];
  OWN_SHOWS: OwnShow[];
  HOLIDAYS: { date: string; name: string }[];
  RULES: ScheduleRules;
  PRESETS: { person: string; joinCompanionShows: boolean }[];
};

export type StudioCalendar = {
  name: string;
  placeId: string;
  color: string;
  icsUrl: string;
};

export type DayInfo = { workday: boolean; holiday: string; weekend: boolean };

export type BookingSlot = { date: string; slot: string };

export type ScheduleBooking = {
  calendar: string;
  placeId: string;
  color: string;
  title: string;
  start: string;
  end: string;
  kind: "own" | "follow" | "other";
  show: string;
  owner: string;
  companions: string[];
  slots: BookingSlot[];
};

export type ScheduleConflict = {
  type: string;
  severity: "error" | "warn";
  message: string;
  cells: { date: string; slot: string; place: string }[];
};

export type ScheduleStat = {
  name: string;
  role: string;
  officeDays: number;
  officeDates: string[];
  byPlace: Record<string, number>;
  studioHours: number;
  leaveSlots: number;
  required: number | null;
  need: number | null;
  adjusted: boolean;
  met: boolean | null;
};

export type MeetingCell = {
  date: string;
  slot: string;
  placeId: string;
  label: string;
  start: string;
  end: string;
  excused: string[];
};

export type ScheduleWeekPayload = {
  weekStart: string;
  dates: string[];
  dayInfo: Record<string, DayInfo>;
  config: {
    people: SchedulePerson[];
    places: SchedulePlace[];
    periods: SchedulePeriod[];
    slots: ScheduleSlot[];
    followPerson: string;
    backupPlaceId: string;
    offStaff: string[];
    mondayMeeting: { start: string; end: string; placeId: string; label: string } | null;
    presetPeople: string[];
  };
  claims: ScheduleClaim[];
  bookings: ScheduleBooking[];
  warnings: string[];
  conflicts: ScheduleConflict[];
  stats: ScheduleStat[];
  meetings: MeetingCell[];
  me: { person: string | null; canEditAnyone: boolean; canSeeAll: boolean };
};
