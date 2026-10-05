/**
 * 班表規則。折扣碼與信箱只在伺服器比對日曆，API 不會回傳這些欄位。
 * 人員、地點、時段沿用排班系統的設定。
 */
import type { ScheduleConfig, StudioCalendar } from "@/lib/schedule/types";

const PERIODS: ScheduleConfig["PERIODS"] = [
  { id: "am", label: "早", short: "早", start: "09:00", end: "13:30" },
  { id: "pm", label: "午", short: "午", start: "13:30", end: "18:00" },
  { id: "eve", label: "晚", short: "晚", start: "18:00", end: "22:30" },
];

function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function buildSlots(periods: ScheduleConfig["PERIODS"]): ScheduleConfig["SLOTS"] {
  const slots: ScheduleConfig["SLOTS"] = [];
  for (const period of periods) {
    for (let t = clockMinutes(period.start); t < clockMinutes(period.end); t += 30) {
      const start = fromMinutes(t);
      const end = fromMinutes(t + 30);
      slots.push({
        id: `m${start.slice(0, 2)}${start.slice(3, 5)}`,
        label: start,
        start,
        end,
        period: period.id,
        hour: Number(start.slice(0, 2)),
      });
    }
  }
  return slots;
}

const SLOTS = buildSlots(PERIODS);

function place(
  id: string,
  name: string,
  short: string,
  kind: ScheduleConfig["PLACES"][number]["kind"],
  unit: ScheduleConfig["PLACES"][number]["unit"],
  periods: string[]
): ScheduleConfig["PLACES"][number] {
  return {
    id,
    name,
    short,
    kind,
    unit,
    periods,
    slots: SLOTS.filter((slot) => periods.includes(slot.period)).map((slot) => slot.id),
  };
}

export const SCHEDULE_CONFIG: ScheduleConfig = {
  TZ_OFFSET: "+08:00",
  PEOPLE: [
    { name: "林安迪", role: "老闆（只排晚上與假日）", minOfficeDays: null },
    { name: "五吉郎", role: "小辦公室值班、跟錄", minOfficeDays: null },
    { name: "克萊", role: "", minOfficeDays: 3 },
    { name: "維尼", role: "主要週一、跟錄灃食", minOfficeDays: null },
    { name: "IVY", role: "", minOfficeDays: 3 },
  ],
  PERIODS,
  PLACES: [
    place("bigOffice", "新辦公室", "新", "office", "period", ["am", "pm"]),
    place("smallOffice", "小辦公室", "小", "office", "period", ["am", "pm"]),
    place("bigStudio", "大錄音室", "大錄", "studio", "hour", ["am", "pm", "eve"]),
    place("smallStudio", "小錄音室", "小錄", "studio", "hour", ["am", "pm", "eve"]),
    place("leave", "請假", "假", "leave", "period", ["am", "pm", "eve"]),
  ],
  SLOTS,
  FOLLOW_SHOWS: [
    { show: "灃食 食光餐桌", keywords: ["灃食", "食光餐桌"], usuallyWith: ["維尼"] },
    { show: "能量黑客", keywords: ["能量黑客", "林揚程"], codes: ["hank4"] },
    { show: "蘇心時光", keywords: ["蘇心時光"], codes: ["Gracesu4"] },
    { show: "愛莉說好室", keywords: ["愛莉說好室", "愛莉"] },
    { show: "一不小心變漂亮", keywords: ["一不小心變漂亮", "崔咪"] },
    { show: "慢慢長出來", keywords: ["慢慢長出來", "Z研"] },
    { show: "艾瑪的空中排練場", keywords: ["艾瑪的空中排練場", "蕭艾瑪", "艾瑪"] },
    { show: "JO伙闖天下", keywords: ["JO伙闖天下", "JO伙", "Jonas"] },
    { show: "Hugo陪你聊", keywords: ["Hugo陪你聊", "Hugo", "維思"] },
  ],
  OWN_SHOWS: [
    { owner: "五吉郎", show: "安迪", code: "5glan6", email: "andy@5glanpodcast.com" },
    { owner: "克萊", show: "克萊", code: "clairevip", email: "claire@sdh-corp.com" },
    { owner: "IVY", show: "歐逆", code: "", email: "ivylan231@gmail.com" },
  ],
  HOLIDAYS: [],
  RULES: {
    workdays: [1, 2, 3, 4, 5],
    followPerson: "五吉郎",
    backupPlaceId: "smallOffice",
    minStaff: { smallOffice: 1, bigOffice: 0 },
    maxStaff: {},
    mondayMeeting: {
      enabled: true,
      weekday: 1,
      start: "10:00",
      end: "11:00",
      placeId: "bigOffice",
      label: "全員會議",
      exemptBackup: true,
    },
    offHours: { periods: ["eve"], staff: ["林安迪", "五吉郎"] },
    studioBookingNeedsStaff: false,
    maxShiftsPerWeek: null,
  },
  PRESETS: [{ person: "維尼", joinCompanionShows: true }],
};

export const STUDIO_CALENDARS: StudioCalendar[] = [
  {
    name: "大錄音室",
    placeId: "bigStudio",
    color: "#2f6fed",
    icsUrl: "https://calendar.google.com/calendar/ical/sandehao%40gmail.com/public/basic.ics",
  },
  {
    name: "小錄音室",
    placeId: "smallStudio",
    color: "#d9822b",
    icsUrl: "https://calendar.google.com/calendar/ical/sdh.service0902%40gmail.com/public/basic.ics",
  },
];
