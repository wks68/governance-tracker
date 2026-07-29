-- 成員管理權限收斂新增：Team.isActive（團隊啟用狀態）。
--
-- Additive、向後相容：既有團隊一律取得預設值 1（啟用），不改變任何既有資料語意，
-- 不需要回填腳本，也不影響 Team.domain 的判斷。
ALTER TABLE "Team" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
