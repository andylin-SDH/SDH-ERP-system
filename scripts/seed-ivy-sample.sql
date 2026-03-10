-- Ivy 經紀人測試資料
-- 在 Supabase SQL Editor 執行（需先執行 001_initial_schema.sql 和 seed-users.sql）

-- 1. 確保 Ivy 存在且 role 正確
INSERT INTO users (email, name, role, dept, password, active_flag) VALUES
  ('ivyhsu@sdh-corp.com', 'Ivy', '經紀人', '經紀部', 'pass1234', true)
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  dept = EXCLUDED.dept,
  password = EXCLUDED.password,
  active_flag = EXCLUDED.active_flag;

-- 2. Ivy 負責的合作夥伴（負責經紀人填 Ivy 的 email）
INSERT INTO partners (partner_id, partner_name, partner_emails, responsible_agent)
SELECT 'KOL-01', '精算媽咪的珊迪兔', 'example1@gmail.com', 'ivyhsu@sdh-corp.com'
WHERE NOT EXISTS (SELECT 1 FROM partners WHERE partner_id = 'KOL-01');
INSERT INTO partners (partner_id, partner_name, partner_emails, responsible_agent)
SELECT 'KOL-02', '郝旭烈', 'example2@gmail.com', 'ivyhsu@sdh-corp.com'
WHERE NOT EXISTS (SELECT 1 FROM partners WHERE partner_id = 'KOL-02');
INSERT INTO partners (partner_id, partner_name, partner_emails, responsible_agent)
SELECT 'KOL-03', '張忘形', 'example3@gmail.com', 'ivyhsu@sdh-corp.com'
WHERE NOT EXISTS (SELECT 1 FROM partners WHERE partner_id = 'KOL-03');

-- 3. Ivy 負責的專案（專案BD 填 Ivy 的 email）
INSERT INTO projects (project_id, project_name, project_bd, kol_name)
SELECT 'P001', 'Podcast 合作案 A', 'ivyhsu@sdh-corp.com', '精算媽咪的珊迪兔'
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE project_id = 'P001');
INSERT INTO projects (project_id, project_name, project_bd, kol_name)
SELECT 'P002', '演講邀約案 B', 'ivyhsu@sdh-corp.com', '郝旭烈'
WHERE NOT EXISTS (SELECT 1 FROM projects WHERE project_id = 'P002');

-- 4. Ivy 負責的任務（任務負責人可填 email 或姓名 "Ivy"）
INSERT INTO tasks (project_id, task, status, task_owner)
SELECT 'P001', '確認錄音檔', '進行中', 'ivyhsu@sdh-corp.com'
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = 'P001' AND task = '確認錄音檔');
INSERT INTO tasks (project_id, task, status, task_owner)
SELECT 'P001', '安排上架時程', '待處理', 'ivyhsu@sdh-corp.com'
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = 'P001' AND task = '安排上架時程');
INSERT INTO tasks (project_id, task, status, task_owner)
SELECT 'P002', '確認演講大綱', '待處理', 'Ivy'
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = 'P002' AND task = '確認演講大綱');
