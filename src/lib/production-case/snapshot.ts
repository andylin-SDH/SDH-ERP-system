import type { User } from "@/lib/types";
import {
  listDeliveries,
  listEpisodes,
  listMemberships,
  listPreprodTasks,
  listPrograms,
  listSessions,
  listUploads,
  listWorkOrders,
} from "./db";
import { programIdsForUser, projectWorkOrderForPerspective, resolvePerspective } from "./access";
import type { PcPerspective, PcSnapshot } from "./types";

export async function loadPcSnapshot(user: User, forced?: PcPerspective): Promise<PcSnapshot> {
  const perspective = forced ?? resolvePerspective(user);
  const scopedIds = await programIdsForUser(user, perspective);
  const programs = await listPrograms(scopedIds ? { ids: scopedIds } : undefined);
  const programIds = programs.map((p) => p.id);
  if (!programIds.length) {
    return {
      programs: [],
      episodes: [],
      preprodTasks: [],
      workOrders: [],
      deliveries: [],
      uploads: [],
      sessions: [],
      memberships: [],
      perspective,
    };
  }
  const [episodes, preprodTasks, workOrdersRaw, uploads, sessions, memberships] = await Promise.all([
    listEpisodes(programIds),
    listPreprodTasks(programIds),
    perspective === "vendor"
      ? listWorkOrders({ programIds, assigneeEmail: user.email })
      : listWorkOrders({ programIds }),
    listUploads(programIds),
    listSessions(programIds),
    listMemberships({ programIds }),
  ]);
  const workOrders = workOrdersRaw.map((wo) => projectWorkOrderForPerspective(wo, perspective) as typeof workOrdersRaw[number]);
  const woIds = workOrdersRaw.map((w) => w.id);
  const deliveries = woIds.length ? await listDeliveries(woIds) : [];
  return {
    programs,
    episodes,
    preprodTasks: perspective === "vendor" ? [] : preprodTasks,
    workOrders,
    deliveries: perspective === "kol" ? [] : deliveries,
    uploads: perspective === "vendor" ? [] : uploads,
    sessions: perspective === "vendor" ? [] : sessions,
    memberships: perspective === "internal" ? memberships : memberships.filter((m) => m.user_email === user.email.toLowerCase()),
    perspective,
  };
}
