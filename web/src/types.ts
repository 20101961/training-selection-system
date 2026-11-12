export type Role = 'student' | 'mentor' | 'lab_head' | 'academic_affairs';

export interface User {
  id: number;
  username: string;
  role: Role;
  displayName: string;
  studentId: number | null;
  mentorId: number | null;
  labId: number | null;
  mustChangePassword: boolean;
}

export interface Stage {
  id: number;
  stage_no: number;
  code: string;
  name: string;
  opens_at: string;
  closes_at: string;
  status: string;
  effective: 'pending' | 'open' | 'closed';
  force_state: string | null;
}

export interface MentorStat {
  id: number;
  code: string;
  name: string;
  lab_name: string;
  title: string | null;
  quota: number;
  confirmed: number;
  remaining: number;
}

export interface Lab {
  id: number;
  code: string;
  name: string;
  description: string | null;
}

export interface Student {
  id: number;
  student_no: string;
  name: string;
  class_name: string | null;
  status: string;
}

export interface DashboardData {
  serverTime: string;
  counts: Record<string, number>;
  currentStage: { stageNo: number; name: string; code: string; effective: string; opensAt: string; closesAt: string } | null;
  stages: Stage[];
  rounds: { id: number; round_no: number; type: string; name: string; status: string }[];
  labs: Lab[];
  mentors: MentorStat[];
  recentAudit: { id: number; actor_role: string; action: string; entity_type: string | null; created_at: string }[];
  notices: { id: number; title: string; body: string | null; level: string; read_at: string | null; created_at: string }[];
}

export interface TrendsData {
  days: string[];
  submitted: { date: string; count: number }[];
  confirmed: { date: string; count: number }[];
  statusPie: { key: string; name: string; count: number }[];
}

export const ROLE_LABELS: Record<Role, string> = {
  student: '学生',
  mentor: '导师',
  lab_head: '实训室负责人',
  academic_affairs: '教务',
};