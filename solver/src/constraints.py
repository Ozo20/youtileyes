from .models import Candidate, LoadProfile, TeachingGroup


def overlaps(first: Candidate, second: Candidate) -> bool:
   return first.start < second.end and second.start < first.end


def travel_minutes(
   from_room_id: str,
   to_room_id: str,
   travel_matrix: dict[tuple[str, str], int],
) -> int:
   if from_room_id == to_room_id:
       return 0

   return travel_matrix.get((from_room_id, to_room_id), 0)


def real_break_minutes(
   first: Candidate,
   second: Candidate,
   travel_matrix: dict[tuple[str, str], int],
   travel_consumes_break_time: bool = True,
) -> int:
   if first.end > second.start:
       return -1

   gap = second.start - first.end

   if not travel_consumes_break_time:
       return gap

   return gap - travel_minutes(
       first.room_id,
       second.room_id,
       travel_matrix,
   )


def required_break_after(
   group: TeachingGroup,
   profile: LoadProfile,
) -> int:
   if group.duration_minutes >= 90:
       return max(
           profile.min_break_minutes,
           profile.min_break_after_double_minutes,
       )

   return profile.min_break_minutes


def intervals_connected_by_insufficient_break(
   first: Candidate,
   second: Candidate,
   minimum_break: int,
   travel_matrix: dict[tuple[str, str], int],
   travel_consumes_break_time: bool,
) -> bool:
   if first.end > second.start:
       return True

   real_break = real_break_minutes(
       first,
       second,
       travel_matrix,
       travel_consumes_break_time,
   )

   return real_break < minimum_break
