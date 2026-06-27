import type { Timestamp } from "firebase/firestore";

export type Role = "admin" | "businessOwner" | "staff" | "customer";
export type PlatformAdminRole =
  | "superAdmin"
  | "operationsManager"
  | "financeManager"
  | "supportAdmin"
  | "contentManager";

export type FirestoreRow = {
  id: string;
  [key: string]: unknown;
};

export type UserProfile = FirestoreRow & {
  email?: string;
  fullName?: string;
  phone?: string;
  role?: Role;
  adminRole?: PlatformAdminRole;
  platformAdmin?: boolean;
  businessId?: string;
  businessName?: string;
  businessServices?: string[];
  hasAuth?: boolean;
  hasProfile?: boolean;
  disabled?: boolean;
  emailVerified?: boolean | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type Metric = {
  label: string;
  value: number;
  tone: "attention" | "good" | "neutral" | "money";
};
