/**
 * 使用者模組 API
 * 資料來源：Supabase（PostgreSQL）
 */

export {
  getUsers,
  getUserByEmail,
  getEmailByNameOrEmail,
  verifyCredentials,
  createUser,
  updateUser,
  type CreateUserInput,
  type UpdateUserInput,
} from "@/lib/db/users";
