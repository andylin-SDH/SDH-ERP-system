-- KOL 請款發票金額：紙本／電子發票上的金額，供與系統合計稽核

ALTER TABLE public."KOL發票"
  ADD COLUMN IF NOT EXISTS "KOL發票金額" text;

COMMENT ON COLUMN public."KOL發票"."KOL發票金額" IS 'KOL 開立發票上的金額（文字）；批次請款時為整張發票合計，方便與系統未稅合計對帳';

ALTER TABLE public."KOL請款批次"
  ADD COLUMN IF NOT EXISTS "KOL發票金額" text;

COMMENT ON COLUMN public."KOL請款批次"."KOL發票金額" IS '批次發票模式下，KOL 填寫的紙本／電子發票金額';
