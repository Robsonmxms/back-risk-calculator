export type UserRole = "admin" | "analyst" | "user";
export type UserStatus = "active" | "disabled";

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  passwordHash?: string;
  googleSubject?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
}

export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status
  };
}
