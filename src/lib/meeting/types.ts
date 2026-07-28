/** 週一晨會 API／前端共用型別（不含 server 依賴） */

export type MeetingTaskItem = {
  任務ID: string;
  任務: string;
  任務類型: string;
  任務負責人: string;
  到期日: string;
  備註: string;
  逾期: boolean;
};

export type MeetingProjectItem = {
  masterId: string;
  專案ID: string;
  專案名稱: string;
  專案狀態: string;
  專案類型: string;
  主責人: string;
  主責角色: string;
  執行管理員: string;
  專案管理員: string;
  協作: string;
  KOL名稱: string;
  廠商名稱: string;
  開案日期: string;
  狀態確認日期: string;
  廠商預計付款日: string;
  款項進度: string;
  專案內容: string;
  備註: string;
  未完成任務數: number;
  逾期任務數: number;
  逾期警示: string[];
  待辦任務: MeetingTaskItem[];
};

export type PersonWorkloadGroup = {
  person: string;
  進行中專案數: number;
  未完成任務數: number;
  逾期任務數: number;
  projects: MeetingProjectItem[];
};

export type MeetingSnapshot = {
  generatedAt: string;
  inProgressCount: number;
  personGroups: PersonWorkloadGroup[];
  unassignedProjects: MeetingProjectItem[];
};
