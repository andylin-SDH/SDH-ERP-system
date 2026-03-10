-- 初始使用者（請依實際修改密碼）
-- 在 Supabase SQL Editor 執行

INSERT INTO users (email, name, role, dept, password, active_flag) VALUES
  ('andylin@sdh-corp.com', 'Andy', '董事長', '董事長室', 'pass1234', true),
  ('winnieliang@sdh-corp.com', '維尼', '內容企劃', '企劃部', 'pass1234', true),
  ('ivyhsu@sdh-corp.com', 'Ivy', '經紀人', '經紀部', 'pass1234', true)
ON CONFLICT (email) DO NOTHING;
