import type { Action, RoomSnapshot } from "./battle.js";
import type { SkillId, Zone } from "./identifiers.js";

interface SkillScope {
  id: SkillId;
  phase: string;
  zone: Zone | null;
}

// Used by the server and all local input paths. Host status grants no P1 override.
export function commandPermission(
  room: RoomSnapshot,
  memberId: string | undefined,
  action: Action,
  skills: readonly SkillScope[],
): "UNAUTHORIZED" | "ZONE_ONLY" | "HOST_ONLY" | "WRONG_PHASE" | null {
  const member = room.members.find((candidate) => candidate.id === memberId);
  if (!member) return "UNAUTHORIZED";
  if (action.type === "enter-zone")
    return room.battle.phase === "p1" ? null : "WRONG_PHASE";
  const skill =
    "skill" in action
      ? skills.find((candidate) => candidate.id === action.skill)
      : null;
  const zone =
    "zone" in action
      ? action.zone
      : action.type === "trigger-tiger"
        ? "tiger"
        : skill?.phase === "p1"
          ? skill.zone
          : null;
  if (zone !== null) {
    return room.battle.phase === "p1" && member.zone === zone
      ? null
      : "ZONE_ONLY";
  }
  return room.hostId === memberId ? null : "HOST_ONLY";
}

export function canUseVoice(room: RoomSnapshot, memberId: string | undefined) {
  const member = room.members.find((candidate) => candidate.id === memberId);
  return (
    !!member &&
    (room.hostId === memberId ||
      room.battle.phase === "p1" ||
      (member.zone !== null && room.battle.phase === "lobby"))
  );
}
